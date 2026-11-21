import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { EmailModal } from '../components/EmailModal';
import { Field, Modal, useSettings } from '../components/ui';
import { appBaseUrl, db } from '../db';
import { mailtoUrl } from '../email';
import { fillVars, mailServer, newToken, requestLink, sendMail, templatesFor, type MailServer } from '../mailer';
import { placeAddress, placeName, projectPerson, spotOf } from '../places';
import type { Contact, CrewAssignment, CrewRequest, Person, Project, Settings, Subproject } from '../types';
import { RESERVING } from '../types';
import { buildIcs, crewCostRate, crewWindow, fmtRange, money, nowIso, patch, save } from '../utils';
import { personIssue } from './project/shared';
import { Icon, type IconName } from '../components/Icon';

/*
 * Équipe : demandes de disponibilité, confirmation et remplacement des techniciens.
 *  - « Demander les dispos » : on choisit les postes et les personnes ; chacune reçoit un mail avec un lien
 *    (page publique du serveur) où elle répond « disponible / pas disponible », poste par poste ;
 *  - sur chaque poste : à qui on a demandé, qui a répondu oui ⏳ ✓ ✗ (réponse notée à la main aussi possible) ;
 *  - un technicien attribué reçoit les détails du poste par mail (+ agenda .ics) ;
 *  - « Remplacer » : la personne n'est plus disponible → notée « pas dispo », prévenue, et on choisit quelqu'un d'autre.
 */

export type Answer = 'oui' | 'non' | 'attente';

/** Réponse d'une demande pour un poste donné. */
export function postAnswer(r: CrewRequest, crewId: string): Answer {
  if (!r.answer) return 'attente';
  const v = r.answers?.[crewId];
  return (v ?? r.answer === 'oui') ? 'oui' : 'non';
}

/** Demandes faites pour un poste (la plus récente par personne). */
export function requestsFor(crewId: string, requests: CrewRequest[]) {
  const byPerson = new Map<string, CrewRequest>();
  for (const r of requests.filter((x) => x.posts.some((p) => p.crewId === crewId)).sort((a, b) => (a.sentAt || a.createdAt).localeCompare(b.sentAt || b.createdAt))) byPerson.set(r.personId, r);
  return [...byPerson.values()].map((r) => ({ r, state: postAnswer(r, crewId) }));
}

export const ANSWER_ICON: Record<Answer, IconName> = { oui: 'check', non: 'x', attente: 'hourglass' };
export const ANSWER_LABEL: Record<Answer, string> = { oui: 'disponible', non: 'pas disponible', attente: 'demandé, pas de réponse' };

/** Lieu et adresse d'un poste (endroit du sous-projet, sinon lieu du projet). */
export function placeOf(project: Project, sp: Subproject | undefined, contacts: Contact[]) {
  const venue = contacts.find((c) => c.id === project.venueId);
  const spot = spotOf(venue, sp?.spotId || project.spotId);
  return { lieu: sp?.venue || placeName(venue, spot) || project.venue || '', adresse: placeAddress(venue, spot) };
}

const postLine = (p: { function: string; start: string; end: string; place?: string }) => `- ${p.function} : ${fmtRange(p.start, p.end)}${p.place ? ` (${p.place})` : ''}`;
const first = (name: string) => name.split(' ')[0];

/** Les postes d'un projet pourvus : leurs demandes en cours n'attendent plus de réponse. */
export async function closeFilledRequests(projectId: string) {
  const crew = new Map((await db.crew.where({ projectId }).toArray()).map((c) => [c.id, c]));
  for (const r of await db.crewRequests.where({ projectId }).toArray()) {
    if (r.closed) continue;
    // fermé quand tous ses postes sont pourvus par quelqu'un d'autre (ou supprimés)
    if (r.posts.every((p) => { const c = crew.get(p.crewId); return !c || (c.personId && c.personId !== r.personId); })) await patch(db.crewRequests, r.id, { closed: true });
  }
}

/** Note à la main la réponse d'une personne pour un poste (téléphone, SMS…). */
export async function setManualAnswer(c: CrewAssignment, person: Person, project: Project, yes: boolean, settings: Settings) {
  const existing = (await db.crewRequests.where({ personId: person.id }).toArray()).filter((r) => r.posts.some((p) => p.crewId === c.id))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (existing) {
    const answers = { ...(existing.answers || Object.fromEntries(existing.posts.map((p) => [p.crewId, existing.answer === 'oui']))), [c.id]: yes };
    const vals = existing.posts.map((p) => !!answers[p.crewId]);
    await patch(db.crewRequests, existing.id, { answers, answer: vals.every(Boolean) ? 'oui' : vals.some(Boolean) ? 'partiel' : 'non', answeredAt: nowIso(), manual: true });
  } else {
    await save(db.crewRequests, {
      token: newToken(), personId: person.id, personName: person.name, projectId: project.id, projectName: project.name, company: settings.company.name,
      posts: [{ crewId: c.id, function: c.function, start: c.start, end: c.end }], answer: yes ? 'oui' : 'non', answers: { [c.id]: yes }, answeredAt: nowIso(), manual: true,
    } as Omit<CrewRequest, 'id' | 'createdAt' | 'updatedAt'>);
  }
}

/** Données d'un projet nécessaires aux fenêtres de l'équipe (chargées à part : utilisables partout). */
function useProjectCrew(projectId: string) {
  const project = useLiveQuery(() => db.projects.get(projectId), [projectId]);
  const subs = useLiveQuery(() => db.subprojects.where({ projectId }).toArray(), [projectId]) || [];
  const crew = useLiveQuery(() => db.crew.where({ projectId }).toArray(), [projectId]) || [];
  const allCrew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const allSubs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const people = (useLiveQuery(() => db.people.orderBy('name').toArray(), []) || []).filter((p) => !p.pending);
  const requests = useLiveQuery(() => db.crewRequests.where({ projectId }).toArray(), [projectId]) || [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) || [];
  const unavailability = useLiveQuery(() => db.unavailability.toArray(), []) || [];
  const appointments = useLiveQuery(() => db.appointments.toArray(), []) || [];
  const unav = [...unavailability, ...appointments.flatMap((a) => (a.personIds || []).map((personId) => ({ ...a, personId, reason: a.title })))];
  return { project, subs, crew, allCrew, allSubs, people, requests, contacts, unav };
}

/** La personne sait-elle occuper cette fonction (fonction principale ou compétences) ? */
const canDo = (p: Person, fn: string) => [p.role, ...(p.skills || [])].some((x) => x && x.toLowerCase() === fn.toLowerCase());

/* ======================= Demander les disponibilités ======================= */

export function AskModal({ projectId, crewIds, onClose }: { projectId: string; crewIds: string[]; onClose: () => void }) {
  const settings = useSettings();
  const d = useProjectCrew(projectId);
  const [posts, setPosts] = useState<Set<string>>(new Set(crewIds));
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const tpl = templatesFor(settings, 'dispo')[0];
  const [subject, setSubject] = useState(tpl.subject);
  const [body, setBody] = useState(tpl.body);
  const [server, setServer] = useState<MailServer | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ person: Person; ok: boolean; msg: string; mailto?: string }[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => { mailServer().then(setServer); }, []);
  if (!d.project) return null;
  const project = d.project;
  const subMap = new Map(d.subs.map((s) => [s.id, s]));
  const open = d.crew.filter((c) => (!c.personId || crewIds.includes(c.id)) && RESERVING.includes(subMap.get(c.subprojectId)?.status || 'annule'))
    .sort((a, b) => a.start.localeCompare(b.start));
  const chosen = open.filter((c) => posts.has(c.id));
  const fns = Array.from(new Set(chosen.map((c) => c.function)));
  const issueOn = (p: Person) => chosen.map((c) => personIssue(p.id, c.start, c.end, c.id, d.allCrew, d.allSubs, d.unav)).find(Boolean) || '';
  const asked = (p: Person) => chosen.map((c) => requestsFor(c.id, d.requests).find((x) => x.r.personId === p.id)?.state).filter(Boolean) as Answer[];
  const qn = q.trim().toLowerCase();
  const people = d.people.filter((p) => !qn || `${p.name} ${p.role || ''} ${(p.skills || []).join(' ')}`.toLowerCase().includes(qn))
    .map((p) => ({ p, skill: fns.some((f) => canDo(p, f)), issue: issueOn(p), asked: asked(p) }))
    .sort((a, b) => Number(b.skill) - Number(a.skill) || Number(!!a.issue) - Number(!!b.issue) || Number(a.asked.includes('non')) - Number(b.asked.includes('non')) || a.p.name.localeCompare(b.p.name));
  const placeFor = (c: CrewAssignment) => placeOf(project, subMap.get(c.subprojectId), d.contacts);
  const varsFor = (p: Person, link: string) => {
    const pl = chosen.map((c) => ({ function: c.function, start: c.start, end: c.end, place: subMap.get(c.subprojectId)?.name }));
    const pr = placeFor(chosen[0]);
    return { prenom: first(p.name), projet: project.name, lieu: pr.lieu, adresse: pr.adresse, dates: fmtRange(project.start, project.end), societe: settings.company.name, postes: pl.map(postLine).join('\n'), lien: link };
  };

  const send = async () => {
    setBusy(true);
    const out: NonNullable<typeof results> = [];
    const canSend = !!server?.ok;
    for (const id of picked) {
      const p = d.people.find((x) => x.id === id)!;
      const token = newToken();
      const link = canSend ? requestLink(token) : '';
      const pl = chosen.map((c) => ({ crewId: c.id, function: c.function, start: c.start, end: c.end, place: [subMap.get(c.subprojectId)?.name, placeFor(c).lieu].filter(Boolean).join(' · ') }));
      await save(db.crewRequests, {
        token, personId: p.id, personName: p.name, projectId: project.id, projectName: project.name, company: settings.company.name,
        venue: placeFor(chosen[0]).lieu || undefined, posts: pl, sentAt: nowIso(),
      } as Omit<CrewRequest, 'id' | 'createdAt' | 'updatedAt'>);
      const vars = varsFor(p, link || '(réponds-moi par retour de mail ou par téléphone)');
      const m = { to: p.email || '', subject: fillVars(subject, vars), body: fillVars(body, vars) };
      if (!p.email) { out.push({ person: p, ok: false, msg: `pas d'adresse email${p.phone ? ` — appelle au ${p.phone}` : ''} (réponse à noter à la main)` }); continue; }
      if (canSend) {
        try { await sendMail({ ...m, replyTo: settings.company.email }, []); out.push({ person: p, ok: true, msg: 'mail envoyé avec le lien de réponse' }); }
        catch (e) { out.push({ person: p, ok: false, msg: (e as Error).message, mailto: mailtoUrl(m) }); }
      } else out.push({ person: p, ok: false, msg: 'à envoyer avec ta messagerie (réponse à noter à la main)', mailto: mailtoUrl(m) });
    }
    setResults(out);
    setBusy(false);
  };

  if (results) return (
    <Modal title="Demandes envoyées" onClose={onClose}>
      <table className="list"><tbody>{results.map((r) => (
        <tr key={r.person.id}><td><strong>{r.person.name}</strong></td><td className={r.ok ? 'avail ok' : 'muted'}>{r.ok && <Icon name="check" />}{r.msg}</td>
          <td>{r.mailto && <a className="button-link" href={r.mailto} onClick={() => undefined}><Icon name="mail" />Ouvrir le mail</a>}</td></tr>
      ))}</tbody></table>
      <p className="muted">Les réponses s'affichent sur chaque poste : <Icon name="hourglass" /> en attente, <Icon name="check" /> disponible, <Icon name="x" /> pas disponible.{!server?.ok && ' Sans serveur d\'envoi, note les réponses à la main en touchant le nom sur le poste.'}</p>
      <div className="form-actions"><button onClick={onClose}>Terminé</button></div>
    </Modal>
  );

  return (
    <Modal title={`Demander les disponibilités — ${project.name}`} onClose={onClose} wide>
      <div className="ask-grid">
        <div>
          <h3 style={{ marginTop: 0 }}>1. Postes</h3>
          {open.length === 0 ? <p className="muted">Aucun poste à pourvoir.</p> : open.map((c) => (
            <label key={c.id} className="check-row ask-post">
              <input type="checkbox" checked={posts.has(c.id)} onChange={(e) => { const n = new Set(posts); if (e.target.checked) n.add(c.id); else n.delete(c.id); setPosts(n); }} />
              <span><b>{c.function}</b> <span className="muted">{fmtRange(c.start, c.end)} · {subMap.get(c.subprojectId)?.name}</span></span>
            </label>
          ))}
        </div>
        <div>
          <h3 style={{ marginTop: 0 }}>2. À qui ? <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>{picked.size} choisie(s)</span></h3>
          <input type="search" placeholder="Rechercher un nom, une fonction…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher un technicien" />
          <div className="ask-people">
            {people.map(({ p, skill, issue, asked: a }) => (
              <label key={p.id} className={'check-row ask-person' + (issue ? ' busy' : '')}>
                <input type="checkbox" checked={picked.has(p.id)} onChange={(e) => { const n = new Set(picked); if (e.target.checked) n.add(p.id); else n.delete(p.id); setPicked(n); }} aria-label={`Demander à ${p.name}`} />
                <span><b>{p.name}</b> <span className="muted">{[p.role, ...(p.skills || []).filter((s) => s !== p.role)].filter(Boolean).join(', ')}</span>
                  <span className="ask-tags">
                    {skill && <span className="tag small"><Icon name="check" />{fns.find((f) => canDo(p, f))}</span>}
                    {issue && <span className="tag small warn">{issue}</span>}
                    {a.map((s, i) => <span key={i} className={'tag small ans-' + s}><Icon name={ANSWER_ICON[s]} />déjà {s === 'attente' ? 'demandé' : ANSWER_LABEL[s]}</span>)}
                    {!p.email && <span className="tag small">pas d'email</span>}
                    <span className="muted">{crewCostRate({ rateUnit: chosen[0]?.rateUnit, function: chosen[0]?.function }, p) ? money(crewCostRate({ rateUnit: chosen[0]?.rateUnit, function: chosen[0]?.function }, p)) : ''}</span>
                  </span></span>
              </label>
            ))}
          </div>
        </div>
      </div>
      <h3>3. Message</h3>
      <Field label="Objet" full><input value={subject} onChange={(e) => setSubject(e.target.value)} aria-label="Objet de la demande" /></Field>
      <Field label="Texte (les {variables} sont remplacées pour chaque personne)" full><textarea style={{ minHeight: 150 }} value={body} onChange={(e) => setBody(e.target.value)} aria-label="Texte de la demande" /></Field>
      <p className="muted" style={{ margin: '4px 0' }}>{server === null ? 'Vérification de l\'envoi…' : server.ok
        ? 'Chacun reçoit son propre lien {lien} : il répond « disponible / pas disponible » en un clic, poste par poste. Sa réponse arrive ici toute seule.'
        : `Envoi direct indisponible (${server.error}) : les mails s'ouvriront dans ta messagerie, sans lien de réponse ; tu noteras les réponses à la main.`}</p>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>Annuler</button>
        <button type="button" disabled={busy || !chosen.length || !picked.size} onClick={send}>{busy ? 'Envoi…' : `Demander à ${picked.size} personne(s) pour ${chosen.length} poste(s)`}</button>
      </div>
    </Modal>
  );
}

/* ======================= Détails du poste (technicien confirmé) ======================= */

export function DetailsMail({ projectId, personId, onClose }: { projectId: string; personId: string; onClose: () => void }) {
  const settings = useSettings();
  const d = useProjectCrew(projectId);
  const person = useLiveQuery(() => db.people.get(personId), [personId]);
  if (!d.project || !person) return null;
  const project = d.project;
  const subMap = new Map(d.subs.map((s) => [s.id, s]));
  const mine = d.crew.filter((c) => c.personId === personId).sort((a, b) => a.start.localeCompare(b.start));
  const client = d.contacts.find((c) => c.id === project.clientId);
  const contactP = projectPerson(client, project);
  const venue = d.contacts.find((c) => c.id === project.venueId);
  const onSite = (venue?.persons || []).find((p) => p.phone) || contactP;
  const pr = placeOf(project, subMap.get(mine[0]?.subprojectId || ''), d.contacts);
  const lines = mine.map((c) => { const [a, b] = crewWindow(c, project.travelMinutes); return postLine({ function: c.function, start: a, end: b, place: subMap.get(c.subprojectId)?.name }) + (a !== c.start ? ' — trajet inclus' : ''); });
  const vars = {
    prenom: first(person.name), projet: project.name, lieu: pr.lieu, adresse: pr.adresse, dates: fmtRange(project.start, project.end), societe: settings.company.name,
    postes: lines.join('\n') + (project.notes ? `\n\nInfos : ${project.notes}` : ''), contact: onSite ? `${onSite.name}${onSite.phone ? ' — ' + onSite.phone : ''}` : '',
  };
  const t = templatesFor(settings, 'confirmation')[0];
  const ics = () => {
    const base = appBaseUrl(settings);
    return buildIcs(`${project.name} — ${person.name}`, mine.map((c) => {
      const [a, b] = crewWindow(c, project.travelMinutes);
      return { uid: c.id, title: `${c.function} — ${project.name}`, start: a, end: b, location: pr.adresse || pr.lieu, description: subMap.get(c.subprojectId)?.name, url: `${base}#/projets/${project.id}` };
    }));
  };
  return (
    <EmailModal kind="confirmation" vars={vars} onClose={onClose}
      initial={{ to: person.email || '', subject: fillVars(t.subject, vars), body: fillVars(t.body, vars) }}
      prepare={async () => [{ name: `${project.number}-${person.name.replace(/\s+/g, '-')}.ics`, type: 'text/calendar', blob: new Blob([ics()], { type: 'text/calendar;charset=utf-8' }) }]}
      onSent={async () => { for (const c of mine) await patch(db.crew, c.id, { detailsSentAt: nowIso(), final: true }); }} />
  );
}

/* ======================= Remplacer un technicien ======================= */

export function ReplaceModal({ crewId, onClose, onAsk }: { crewId: string; onClose: () => void; onAsk: (crewIds: string[]) => void }) {
  const settings = useSettings();
  const c = useLiveQuery(() => db.crew.get(crewId), [crewId]);
  const d = useProjectCrew(c?.projectId || '');
  const [step, setStep] = useState<'why' | 'who'>('why');
  const [old, setOld] = useState<Person | null>(null);
  const [markNo, setMarkNo] = useState(true);
  const [notify, setNotify] = useState(true);
  const [cancelMail, setCancelMail] = useState(false);
  const [details, setDetails] = useState<string | null>(null);
  if (!c || !d.project) return null;
  const project = d.project;
  const person = old || d.people.find((p) => p.id === c.personId);
  const subMap = new Map(d.subs.map((s) => [s.id, s]));
  const asked = requestsFor(c.id, d.requests);
  const cands = d.people.filter((p) => p.id !== person?.id)
    .map((p) => ({ p, issue: personIssue(p.id, c.start, c.end, c.id, d.allCrew, d.allSubs, d.unav), ans: asked.find((x) => x.r.personId === p.id)?.state }))
    .sort((a, b) => Number(b.ans === 'oui') - Number(a.ans === 'oui') || Number(b.p && canDo(b.p, c.function)) - Number(canDo(a.p, c.function)) || Number(!!a.issue) - Number(!!b.issue) || Number(a.ans === 'non') - Number(b.ans === 'non') || a.p.name.localeCompare(b.p.name));
  const vars = person ? { prenom: first(person.name), projet: project.name, societe: settings.company.name, postes: postLine({ function: c.function, start: c.start, end: c.end, place: subMap.get(c.subprojectId)?.name }), lieu: project.venue } : {};
  const tA = templatesFor(settings, 'annulation')[0];

  if (cancelMail && person) return (
    <EmailModal kind="annulation" vars={vars} onClose={() => setCancelMail(false)}
      initial={{ to: person.email || '', subject: fillVars(tA.subject, vars), body: fillVars(tA.body, vars) }} prepare={async () => []} />
  );
  if (details) return <DetailsMail projectId={project.id} personId={details} onClose={() => { setDetails(null); onClose(); }} />;

  return (
    <Modal title={`Remplacer — ${c.function}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>{project.name} · {subMap.get(c.subprojectId)?.name} · {fmtRange(c.start, c.end)}</p>
      {step === 'why' && person ? (
        <>
          <p><b>{person.name}</b> n'est plus disponible pour ce poste ?</p>
          <label className="check-row"><input type="checkbox" checked={markNo} onChange={(e) => setMarkNo(e.target.checked)} /> Le noter « pas disponible » (il ne sera plus proposé en premier pour ce poste)</label>
          {person.email && <label className="check-row"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Le prévenir par mail que le poste ne le concerne plus</label>}
          <div className="form-actions">
            <button type="button" className="secondary" onClick={onClose}>Annuler</button>
            <button type="button" onClick={async () => {
              if (markNo) await setManualAnswer(c, person, project, false, settings);
              await patch(db.crew, c.id, { personId: undefined, cost: undefined, detailsSentAt: undefined });
              setOld(person);
              setStep('who');
              if (notify && person.email) setCancelMail(true);
            }}>Retirer {first(person.name)} et choisir quelqu'un d'autre</button>
          </div>
        </>
      ) : (
        <>
          {old && <div className="flash ok">{old.name} retiré du poste{markNo ? ' (noté pas disponible)' : ''}.</div>}
          <p style={{ marginBottom: 4 }}><b>Qui le remplace ?</b> Ceux qui ont répondu « disponible » d'abord.</p>
          <div className="ask-people">
            {cands.map(({ p, issue, ans }) => (
              <div key={p.id} className={'replace-row' + (issue ? ' busy' : '')}>
                <span><b>{p.name}</b> <span className="muted">{p.role}</span>
                  {ans && <span className={'tag small ans-' + ans}><Icon name={ANSWER_ICON[ans]} />{ANSWER_LABEL[ans]}</span>}
                  {issue && <span className="tag small warn">{issue}</span>}</span>
                <button type="button" className="small" onClick={async () => {
                  await patch(db.crew, c.id, { personId: p.id, cost: undefined });
                  await closeFilledRequests(project.id);
                  setDetails(p.id);
                }}>Attribuer</button>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={() => { onClose(); onAsk([c.id]); }}>Demander les dispos…</button>
            <button type="button" className="secondary" onClick={onClose}>Laisser à pourvoir</button>
          </div>
        </>
      )}
    </Modal>
  );
}

/* ======================= Cellule « Technicien » d'un poste ======================= */

/**
 * Sous le choix du technicien : les demandes faites pour ce poste (⏳ ✓ ✗, réponse notable à la main),
 * et les actions : demander les dispos, remplacer, envoyer les détails.
 */
export function PostRequests({ c, people, requests, onAsk, onReplace, onDetails }: {
  c: CrewAssignment; people: Person[]; requests: CrewRequest[];
  onAsk: () => void; onReplace: () => void; onDetails: () => void;
}) {
  const settings = useSettings();
  const list = requestsFor(c.id, requests);
  const [menu, setMenu] = useState<string | null>(null);
  const pMap = new Map(people.map((p) => [p.id, p]));
  return (
    <div className="post-req">
      {list.length > 0 && (
        <div className="req-chips">
          {list.map(({ r, state }) => (
            <span key={r.id} className="req-wrap">
              <button type="button" className={'req-chip ans-' + state + (c.personId === r.personId ? ' cur' : '')} title={`${r.personName} : ${ANSWER_LABEL[state]}${r.note ? ` — « ${r.note} »` : ''}${r.manual ? ' (noté à la main)' : ''}`}
                onClick={() => setMenu(menu === r.id ? null : r.id)}><Icon name={ANSWER_ICON[state]} />{first(r.personName)}{r.note && <Icon name="chat" title="a laissé un mot" />}</button>
              {menu === r.id && (
                <span className="req-menu">
                  {r.note && <span className="muted">« {r.note} »</span>}
                  {state === 'oui' && !c.personId && <button type="button" className="small" onClick={async () => { setMenu(null); await patch(db.crew, c.id, { personId: r.personId, cost: undefined }); await closeFilledRequests(c.projectId); onDetails(); }}>Attribuer {first(r.personName)}</button>}
                  {state !== 'oui' && pMap.get(r.personId) && <button type="button" className="secondary small" onClick={async () => { setMenu(null); const p = await db.projects.get(c.projectId); if (p) await setManualAnswer(c, pMap.get(r.personId)!, p, true, settings); }}>Noter : disponible</button>}
                  {state !== 'non' && pMap.get(r.personId) && <button type="button" className="secondary small" onClick={async () => { setMenu(null); const p = await db.projects.get(c.projectId); if (p) await setManualAnswer(c, pMap.get(r.personId)!, p, false, settings); }}>Noter : pas disponible</button>}
                  {r.sentAt && <span className="muted">demandé le {new Date(r.sentAt).toLocaleDateString('fr-FR')}</span>}
                </span>
              )}
            </span>
          ))}
        </div>
      )}
      <div className="req-actions">
        {!c.personId && <button type="button" className="ghost small" onClick={onAsk}><Icon name="send" />Demander les dispos</button>}
        {c.personId && <button type="button" className="ghost small" onClick={onReplace} title="La personne n'est plus disponible : la remplacer"><Icon name="swap" />Remplacer</button>}
        {c.personId && <button type="button" className="ghost small" onClick={onDetails} title="Envoyer les détails du poste (lieu, horaires, contact, agenda)"><Icon name="mail" />{c.detailsSentAt ? `Détails envoyés le ${new Date(c.detailsSentAt).toLocaleDateString('fr-FR')}` : 'Envoyer les détails'}</button>}
      </div>
    </div>
  );
}

/** Fenêtres de l'équipe (demande, remplacement, détails), pilotées depuis n'importe quelle liste de postes. */
export function useCrewDialogs() {
  const [ask, setAsk] = useState<{ projectId: string; crewIds: string[] } | null>(null);
  const [replace, setReplace] = useState<string | null>(null);
  const [details, setDetails] = useState<{ projectId: string; personId: string } | null>(null);
  const dialogs = (
    <>
      {ask && <AskModal projectId={ask.projectId} crewIds={ask.crewIds} onClose={() => setAsk(null)} />}
      {replace && <ReplaceModal crewId={replace} onClose={() => setReplace(null)} onAsk={(ids) => db.crew.get(ids[0]).then((c) => c && setAsk({ projectId: c.projectId, crewIds: ids }))} />}
      {details && <DetailsMail projectId={details.projectId} personId={details.personId} onClose={() => setDetails(null)} />}
    </>
  );
  /** props prêtes pour PostRequests */
  const forPost = (c: CrewAssignment) => ({
    onAsk: () => setAsk({ projectId: c.projectId, crewIds: [c.id] }),
    onReplace: () => setReplace(c.id),
    onDetails: () => db.crew.get(c.id).then((x) => x?.personId && setDetails({ projectId: x.projectId, personId: x.personId })),
  });
  return { dialogs, forPost, askProject: (projectId: string, crewIds: string[]) => setAsk({ projectId, crewIds }) };
}
