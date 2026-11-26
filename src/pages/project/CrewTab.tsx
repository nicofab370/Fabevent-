import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, Modal, NumInput, StatusBadge, useSettings } from '../../components/ui';
import { mailServer, replyAddress, sendMail, type MailServer } from '../../mailer';
import { mailtoUrl } from '../../email';
import { CostCell, PersonSelect, type CrewContext } from '../crewAssign';
import { EmailModal } from '../../components/EmailModal';
import { appBaseUrl, db } from '../../db';
import type { CrewAssignment, CrewPreset, Person, Subproject, VehicleAssignment } from '../../types';
import { RESERVING } from '../../types';
import { blockPeriod, buildIcs, crewAmount, crewCostProfile, fmtHours, crewWindow, functionRate, daysBetween, download, fmtRange, money, overlaps, round2, save, sortPeriods, patch, uid } from '../../utils';
import { personIssue, type ProjectData } from './shared';
import { PostRequests, useCrewDialogs } from '../crewRequests';
import { useLiveQuery } from 'dexie-react-hooks';
import { perKmFor, tripKm, vehiclePrice } from '../../geo';
import { Icon } from '../../components/Icon';

/** Onglet Équipe & transport : postes et véhicules par salle et par créneau, puis affectation. */
export default function CrewTab({ d }: { d: ProjectData }) {
  const { project, projectCrew, people, settings } = d;
  const [mailPerson, setMailPerson] = useState<Person | null>(null);
  /** inclure les postes provisoires dans le planning envoyé */
  const [withProv, setWithProv] = useState(false);
  const [sendAll, setSendAll] = useState(false);
  const [mode, setModeState] = useState<CrewMode>(() => { try { return (localStorage.getItem('fab.crewMode') as CrewMode) || 'postes'; } catch { return 'postes'; } });
  const setMode = (m: CrewMode) => { setModeState(m); try { localStorage.setItem('fab.crewMode', m); } catch { /* sans stockage */ } };
  const requests = useLiveQuery(() => db.crewRequests.where({ projectId: project.id }).toArray(), [project.id]) || [];
  const ctx: CrewContext = { people, allCrew: d.crew, subs: d.av.subs, unav: d.unav, catalogue: settings.crewFunctions || [], requests };
  const cd = useCrewDialogs();
  const pMap = new Map(people.map((p) => [p.id, p]));
  const subMap = new Map(d.subs.map((s) => [s.id, s]));
  const assigned = people.filter((p) => projectCrew.some((c) => c.personId === p.id));
  const open = projectCrew.filter((c) => !c.personId && subMap.get(c.subprojectId)?.status !== 'annule');
  const provisional = projectCrew.filter((c) => c.final === false).length;
  /** heures prestées par une personne sur le projet (trajet compris), et ses heures sup. selon son forfait */
  const hoursOf = (p: Person) => projectCrew.filter((c) => c.personId === p.id && subMap.get(c.subprojectId)?.status !== 'annule').reduce((t, c) => {
    const a = crewAmount(c, settings, project.travelMinutes, crewCostProfile(c, p));
    return { worked: t.worked + a.worked, over: t.over + a.costOvertime, est: t.est || a.estimated, posts: t.posts + 1 };
  }, { worked: 0, over: 0, est: false, posts: 0 });
  const totalHours = projectCrew.filter((c) => subMap.get(c.subprojectId)?.status !== 'annule')
    .reduce((t, c) => t + crewAmount(c, settings, project.travelMinutes, crewCostProfile(c, c.personId ? people.find((x) => x.id === c.personId) : undefined)).worked, 0);

  /** postes d'une personne ; finalOnly = ce qu'elle a le droit de voir (planification finale) */
  const schedule = (p: Person, finalOnly = false) => projectCrew
    .filter((c) => c.personId === p.id && (!finalOnly || c.final !== false))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((c) => {
      const sp = subMap.get(c.subprojectId);
      const pe = sp?.periods?.find((x) => x.id === c.periodId);
      const [a, b] = crewWindow(c, project.travelMinutes);
      return { c, sp, a, b, label: `${fmtRange(a, b)} — ${c.function} · ${sp?.name}${pe ? ` (${pe.name})` : ''}${a !== c.start ? ' (trajet inclus)' : ''}` };
    });

  /** postes envoyés : la planification finale, et les provisoires si demandé */
  const toSend = (p: Person) => schedule(p, !withProv);
  /** ligne du planning, avec ce qui a changé depuis le dernier envoi */
  const lineOf = (i: ReturnType<typeof schedule>[number], wasSent: boolean) => {
    const ch = changeOf(i.c);
    const prov = i.c.final === false ? ' (provisoire)' : '';
    if (ch) return `- MODIFIÉ : ${i.label}${prov} — avant : ${fmtRange(i.c.sent!.start, i.c.sent!.end)}`;
    if (wasSent && !i.c.sent) return `- NOUVEAU : ${i.label}${prov}`;
    return `- ${i.label}${prov}`;
  };
  const planningMail = (p: Person) => {
    const items = toSend(p);
    const wasSent = items.some((i) => i.c.sent);
    const changed = items.some((i) => changeOf(i.c)) || (wasSent && items.some((i) => !i.c.sent));
    const prov = items.some((i) => i.c.final === false);
    const body = `Bonjour ${p.name.split(' ')[0]},\n\n${changed ? 'Ton planning a changé' : 'Voici ton planning'}${prov ? ' (encore provisoire en partie)' : ''} pour « ${project.name} »${project.venue ? ` (${project.venue})` : ''} :\n\n${items.map((i) => lineOf(i, wasSent)).join('\n')}\n\nLe fichier agenda joint (.ics) ajoute ces horaires à ton calendrier.\n\n${project.notes ? project.notes + '\n\n' : ''}Merci de me confirmer ta disponibilité.\n${settings.company.name}`;
    return { to: p.email || '', subject: `${changed ? 'Planning modifié' : prov ? 'Planning provisoire' : 'Planning'} — ${project.name}`, body };
  };
  /** retient les horaires envoyés, pour signaler ensuite les changements */
  const markSent = async (p: Person) => {
    const at = new Date().toISOString();
    for (const i of toSend(p)) await patch(db.crew, i.c.id, { sent: { at, start: i.c.start, end: i.c.end, final: i.c.final !== false } });
  };
  const sendPlanning = (p: Person) => {
    if (!toSend(p).length) return alert(`Aucun poste final pour ${p.name} : coche « inclure les postes provisoires » ou passe ses postes en « final ».`);
    setMailPerson(p);
  };
  const icsText = (p: Person) => {
    const base = appBaseUrl(settings);
    return buildIcs(`${project.name} — ${p.name}`, toSend(p).map(({ c, sp, a, b }) => ({
      uid: c.id, title: `${c.function} — ${project.name}`, start: a, end: b, location: sp?.venue || project.venue, description: sp?.name, url: `${base}#/projets/${project.id}`,
    })));
  };
  const icsName = (p: Person) => `${project.number}-${p.name.replace(/\s+/g, '-')}.ics`;
  const icsFor = (p: Person) => download(icsName(p), icsText(p), 'text/calendar;charset=utf-8');

  return (
    <>
      <div className="tabs crew-modes" role="tablist">
        <button role="tab" className={mode === 'postes' ? 'on' : ''} onClick={() => setMode('postes')}>1. Postes à prévoir ({projectCrew.length})</button>
        <button role="tab" className={mode === 'attribution' ? 'on' : ''} onClick={() => setMode('attribution')}>2. Attribution des techniciens{open.length ? ` (${open.length} à pourvoir)` : ''}</button>
      </div>
      {mode === 'postes' ? (
        <div className="info">
          Prévois d'abord les <strong>postes</strong> dont le projet a besoin (fonction, nombre, créneau, tarif client) et le transport.
          Les techniciens s'attribuent ensuite dans l'onglet « 2. Attribution », ou pour tous les projets dans le menu <Link to="/attribution">Attribution</Link>.
        </div>
      ) : (
      <div className="card">
        <h2>Planification du personnel</h2>
        <div className="stats" style={{ marginBottom: 8 }}>
          <div className="stat"><b>{projectCrew.length}</b><span>postes</span></div>
          <div className="stat"><b style={{ color: open.length ? 'var(--danger)' : 'var(--ok)' }}>{open.length}</b><span>à pourvoir</span></div>
          <div className="stat"><b>{assigned.length}</b><span>personnes affectées</span></div>
          <div className="stat"><b style={{ color: provisional ? 'var(--accent)' : undefined }}>{provisional}</b><span>postes provisoires</span></div>
          <div className="stat"><b>{fmtHours(totalHours)}</b><span>heures prestées</span></div>
        </div>
        <div className="toolbar planning-send">
          {provisional > 0 && <button className="secondary small" onClick={async () => { for (const c of projectCrew.filter((x) => x.final === false)) await save(db.crew, { ...c, final: true }); }}>Rendre toute la planification finale</button>}
          <label className="check-row"><input type="checkbox" checked={withProv} onChange={(e) => setWithProv(e.target.checked)} /> Inclure les postes provisoires dans le planning envoyé</label>
          {assigned.length > 0 && <button className="small" onClick={() => setSendAll(true)}><Icon name="send" />Envoyer le planning{withProv ? ' (provisoire)' : ''} à tous ({assigned.length})</button>}
        </div>
        {assigned.length === 0 ? <Empty>Personne n'est encore affecté. Crée des postes dans les sous-projets ci-dessous, puis choisis qui les occupe.</Empty> : (
          <table className="list cards-sm">
            <tbody>
              {assigned.map((p) => (
                <tr key={p.id}>
                  <td style={{ width: 200 }}><strong>{p.name}</strong><div className="muted">{p.role}{p.external ? ' · externe' : ''}</div>
                    {(() => { const h = hoursOf(p); return (
                      <div className="crew-hours" title={`Heures prestées sur le projet, trajet compris${h.est ? ' (estimées pour les postes à la journée sur plusieurs jours)' : ''}`}>
                        <Icon name="clock" />{h.est ? '≈ ' : ''}{fmtHours(h.worked)}{h.over ? <span className="avail ko"> dont {fmtHours(h.over)} sup.</span> : null}
                        <span className="muted"> · {h.posts} poste{h.posts > 1 ? 's' : ''}</span>
                      </div>
                    ); })()}
                  </td>
                  <td>{schedule(p).map((i) => {
                    const ch = changeOf(i.c);
                    return (
                      <div key={i.c.id} style={{ fontSize: 12 }} className={ch ? 'sched-changed' : ''}>{i.label}{i.c.final === false && <span className="badge st-option" style={{ marginLeft: 4 }}>provisoire</span>}
                        {ch && <div className="sched-diff"><Icon name="warning" />Changé depuis l'envoi du {new Date(i.c.sent!.at).toLocaleDateString('fr-FR')} : {ch}</div>}
                        {!i.c.sent && schedule(p).some((x) => x.c.sent) && <div className="sched-diff"><Icon name="plus" />Nouveau poste, pas encore envoyé</div>}</div>
                    );
                  })}</td>
                  <td className="sched-state">{sentState(schedule(p))}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="secondary small" onClick={() => sendPlanning(p)}>Envoyer le planning</button>{' '}
                    <button className="secondary small" onClick={() => icsFor(p)}>.ics</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}
      {mode === 'attribution' && open.length > 0 && (
        <div className="toolbar"><button onClick={() => cd.askProject(project.id, open.map((c) => c.id))}><Icon name="send" />Demander les dispos pour les {open.length} poste(s) à pourvoir</button></div>
      )}
      {mode === 'postes' && <TravelTime d={d} used={d.projectCrew.some((c) => c.travel)} />}
      {d.subs.map((sp) => <RoomCrew key={sp.id} d={d} sp={sp} pMap={pMap} mode={mode} ctx={ctx} actionsFor={cd.forPost} />)}
      {cd.dialogs}
      {sendAll && <SendPlanningAll people={assigned} withProv={withProv} items={toSend} mail={planningMail} ics={(p) => ({ name: icsName(p), text: icsText(p) })} onSent={markSent} onClose={() => setSendAll(false)} />}
      {mailPerson && (
        <EmailModal initial={planningMail(mailPerson)} onClose={() => setMailPerson(null)} kind="planning" onSent={() => markSent(mailPerson)}
          vars={{ prenom: mailPerson.name.split(' ')[0], projet: project.name, lieu: project.venue, societe: settings.company.name, postes: (() => { const it = toSend(mailPerson); const w = it.some((i) => i.c.sent); return it.map((i) => lineOf(i, w)).join('\n'); })(), dates: fmtRange(project.start, project.end) }}
          prepare={async () => [{ name: icsName(mailPerson), type: 'text/calendar', blob: new Blob([icsText(mailPerson)], { type: 'text/calendar;charset=utf-8' }) }]} />
      )}
    </>
  );
}

type CrewMode = 'postes' | 'attribution';

/** Temps de trajet du projet (aller) : ajouté avant et après les postes cochés « Trajet ». */
function TravelTime({ d, used }: { d: ProjectData; used: boolean }) {
  const m = d.project.travelMinutes || 0;
  return (
    <div className={'toolbar travel-time' + (used && !m ? ' warn' : '')}>
      <Icon name="truck" />
      <span>Trajet depuis le dépôt</span>
      <NumInput className="w-qty" value={m} min={0} aria-label="Temps de trajet en minutes" onChange={(n) => patch(db.projects, d.project.id, { travelMinutes: n || undefined })} />
      <span>min (aller), ajouté avant et après les postes cochés « Trajet »</span>
      {used && !m && <span className="avail ko">Indique le temps de trajet, ou calcule la distance dans l'onglet Général.</span>}
    </div>
  );
}

function RoomCrew({ d, sp, pMap, mode, ctx, actionsFor }: { d: ProjectData; sp: Subproject; pMap: Map<string, Person>; mode: CrewMode; ctx: CrewContext; actionsFor: (c: CrewAssignment) => { onAsk: () => void; onReplace: () => void; onDetails: () => void } }) {
  const [addQty, setAddQty] = useState(1);
  const [addFn, setAddFn] = useState('');
  const [addPeriod, setAddPeriod] = useState('');
  const [addTravel, setAddTravel] = useState(false);
  const periods = sortPeriods(sp.periods || []);
  const [bStart, bEnd] = blockPeriod(sp);
  const crew = d.projectCrew.filter((c) => c.subprojectId === sp.id).sort((a, b) => a.start.localeCompare(b.start));
  const openHere = sp.status === 'annule' ? [] : crew.filter((c) => !c.personId);
  /** coût client prévu des postes du sous-projet (facturés) */
  const plannedClient = crew.reduce((a, c) => a + (c.billable ? crewAmount(c, d.settings, d.project.travelMinutes, 0).billed : 0), 0);
  const presets = d.settings.crewPresets || [];
  const [presetId, setPresetId] = useState('');
  const vas = d.projectVas.filter((v) => v.subprojectId === sp.id);
  const subMap = new Map(d.av.subs.map((s) => [s.id, s]));
  const updCrew = (c: CrewAssignment, changes: Partial<CrewAssignment>) => patch(db.crew, c.id, changes);
  const catalogue = d.settings.crewFunctions || [];
  const defaultFn = catalogue[0]?.name || 'Technicien';
  const updVa = (v: VehicleAssignment, patch: Partial<VehicleAssignment>) => save(db.vehicleAssignments, { ...v, ...patch });
  const vMap = new Map(d.vehicles.map((x) => [x.id, x]));
  /** modification qui change le prix : on le recalcule (forfait × jours + km × €/km) */
  const updVaPriced = (v: VehicleAssignment, patch: Partial<VehicleAssignment>) => {
    const next = { ...v, ...patch };
    return save(db.vehicleAssignments, { ...next, price: vehiclePrice(next, vMap.get(next.vehicleId), d.settings) });
  };
  const vehicleBusy = (v: VehicleAssignment) => d.vas.some((o) => o.id !== v.id && o.vehicleId === v.vehicleId &&
    RESERVING.includes(subMap.get(o.subprojectId)?.status || 'annule') && overlaps(o.start, o.end, v.start, v.end));
  const slot = (periodId: string | undefined) => {
    const pe = periods.find((x) => x.id === periodId);
    return pe ? { periodId: pe.id, start: pe.start, end: pe.end } : { periodId: undefined, start: bStart, end: bEnd };
  };
  const PeriodSelect = ({ value, onChange }: { value?: string; onChange: (v?: string) => void }) => (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">Tout le sous-projet</option>
      {periods.map((pe) => <option key={pe.id} value={pe.id}>{pe.name}</option>)}
    </select>
  );

  return (
    <div className="sub">
      <div className="sub-head">
        <h3>{sp.name} <StatusBadge status={sp.status} />{openHere.length > 0 && <span className="open-badge"><Icon name="warning" />{openHere.length} poste(s) sans technicien</span>}</h3>
        <span className="muted">{fmtRange(bStart, bEnd)}</span>
      </div>
      <div className="sub-body">
        <h3 style={{ marginBottom: 6 }}>{mode === 'postes' ? 'Postes à prévoir' : 'Attribution des techniciens'}</h3>
        {crew.length === 0 && mode === 'attribution' && <Empty>Aucun poste prévu : ajoute-les d'abord dans « 1. Postes à prévoir ».</Empty>}
        {crew.length > 0 && mode === 'postes' && (
          <div className="table-wrap">
            <table className="list crew-posts cards-sm">
              <thead><tr><th>Fonction</th>{periods.length > 0 && <th>Créneau</th>}<th>Début</th><th>Fin</th><th className="n" title="Heures prestées par le technicien, trajet compris">Heures</th><th>Unité</th><th title="Prix facturé au client pour la fonction">Tarif client</th><th title="Ajouter le temps de trajet du projet avant et après">Trajet</th><th>Facturé</th><th className="n">Total client</th><th>Technicien</th><th /></tr></thead>
              <tbody>
                {crew.map((c) => {
                  const person = c.personId ? pMap.get(c.personId) : undefined;
                  const a = crewAmount(c, d.settings, d.project.travelMinutes, crewCostProfile(c, person));
                  return (
                    <tr key={c.id} className={c.personId ? '' : 'post-open'}>
                      <td>
                        <input value={c.function} list="fonctions" aria-label="Fonction" onChange={(e) => {
                          const fn = e.target.value;
                          const rate = functionRate(fn, c.rateUnit, catalogue);
                          updCrew(c, { function: fn, ...(rate != null && catalogue.some((f) => f.name.toLowerCase() === fn.trim().toLowerCase()) ? { rate } : {}) });
                        }} />
                      </td>
                      {periods.length > 0 && <td><PeriodSelect value={c.periodId} onChange={(v) => updCrew(c, slot(v))} /></td>}
                      <td><input type="datetime-local" value={c.start} onChange={(e) => updCrew(c, { start: e.target.value, periodId: undefined })} /></td>
                      <td><input type="datetime-local" value={c.end} onChange={(e) => updCrew(c, { end: e.target.value, periodId: undefined })} /></td>
                      <td className="n nowrap"><HoursCell a={a} travel={!!c.travel && !!d.project.travelMinutes} /></td>
                      <td>
                        <select value={c.rateUnit || 'jour'} onChange={(e) => {
                          const unit = e.target.value as 'jour' | 'heure';
                          updCrew(c, { rateUnit: unit, rate: functionRate(c.function, unit, catalogue, person) ?? c.rate, cost: undefined });
                        }}>
                          <option value="jour">/ jour</option><option value="heure">/ heure</option>
                        </select>
                      </td>
                      <td><NumInput className="w-price" value={c.rate} onChange={(n) => updCrew(c, { rate: n })} aria-label="Tarif client" /></td>
                      <td><input type="checkbox" checked={!!c.travel} aria-label="Trajet" title={d.project.travelMinutes ? `${d.project.travelMinutes} min avant et après` : 'Indique le temps de trajet au-dessus du tableau'} onChange={(e) => updCrew(c, { travel: e.target.checked })} /></td>
                      <td><input type="checkbox" checked={c.billable} onChange={(e) => updCrew(c, { billable: e.target.checked })} /></td>
                      <td className="n">{money(a.billed)}{a.unit === 'heure' && <div className="muted" style={{ fontSize: 11 }}>{a.hours} h{a.overtime ? ` dont ${a.overtime} h sup.` : ''}</div>}</td>
                      <td>{person ? <span>{person.name}{c.final === false && <span className="badge st-option" style={{ marginLeft: 4 }}>provisoire</span>}</span> : <span className="open-flag"><Icon name="warning" />À pourvoir</span>}</td>
                      <td className="nowrap">
                        <button className="ghost small" title="Dupliquer le poste" aria-label="Dupliquer le poste" onClick={() => save(db.crew, { ...c, id: '', createdAt: '', personId: undefined, cost: undefined })}><Icon name="copy" /></button>
                        <button className="ghost" onClick={() => db.crew.delete(c.id)} aria-label="Retirer"><Icon name="x" /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {crew.length > 0 && mode === 'attribution' && (
          <div className="table-wrap">
            <table className="list crew-assign cards-sm">
              <thead><tr><th>Poste</th><th>Horaires</th><th>Technicien</th><th title="Ce que te coûte la personne affectée">Coût</th><th title="Final : visible du technicien (agenda, planning envoyé). Provisoire : pas encore communiqué.">Final</th><th className="n">Total client</th><th className="n">Marge</th></tr></thead>
              <tbody>
                {crew.map((c) => {
                  const person = c.personId ? pMap.get(c.personId) : undefined;
                  const a = crewAmount(c, d.settings, d.project.travelMinutes, crewCostProfile(c, person));
                  const margin = (c.billable ? a.billed : 0) - a.cost;
                  const pe = periods.find((x) => x.id === c.periodId);
                  return (
                    <tr key={c.id} className={c.personId ? '' : 'post-open'}>
                      <td>{!c.personId && <span className="open-flag"><Icon name="warning" />À pourvoir</span>}<strong>{c.function}</strong>{pe && <div className="muted">{pe.name}</div>}</td>
                      <td className="nowrap">{fmtRange(c.start, c.end)}<div><HoursCell a={a} travel={!!c.travel && !!d.project.travelMinutes} /></div></td>
                      <td><PersonSelect c={c} ctx={ctx} /><PostRequests c={c} people={ctx.people} requests={ctx.requests || []} {...actionsFor(c)} /></td>
                      <td className="nowrap"><CostCell c={c} person={person} /></td>
                      <td><input type="checkbox" aria-label="Planification finale" checked={c.final !== false} onChange={(e) => updCrew(c, { final: e.target.checked })} /></td>
                      <td className="n">{c.billable ? money(a.billed) : <span className="muted">non facturé</span>}</td>
                      <td className="n">{!c.personId && c.cost == null ? <span className="muted">à pourvoir</span> : <><span className={'avail ' + (margin < 0 ? 'ko' : 'ok')}>{money(round2(margin))}</span><div className="muted" style={{ fontSize: 11 }}>coût {money(a.cost)}{a.costOvertime ? ` dont ${a.costOvertime} h sup.` : ''}</div></>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {crew.length > 0 && (() => {
          const all = crew.map((c) => crewAmount(c, d.settings, d.project.travelMinutes, crewCostProfile(c, c.personId ? pMap.get(c.personId) : undefined)));
          const worked = all.reduce((t, a) => t + a.worked, 0), over = all.reduce((t, a) => t + a.costOvertime, 0);
          return (
            <p className="muted crew-total"><Icon name="clock" />Total prévu : <strong>{all.some((a) => a.estimated) ? '≈ ' : ''}{fmtHours(worked)}</strong> prestées sur {crew.length} poste{crew.length > 1 ? 's' : ''}
              {over > 0 && <>, dont <span className="avail ko">{fmtHours(over)} sup.</span></>}</p>
          );
        })()}
        {mode === 'postes' && (
          <form className="toolbar add-posts" style={{ marginTop: 8 }} onSubmit={async (e) => {
            e.preventDefault();
            const fn = addFn.trim() || defaultFn;
            const n = Math.max(1, Math.min(50, Math.round(addQty || 1)));
            for (let i = 0; i < n; i++) {
              await save(db.crew, { projectId: sp.projectId, subprojectId: sp.id, function: fn, ...slot(addPeriod || undefined), rate: functionRate(fn, 'jour', catalogue) || 0, billable: true, final: !!d.settings.crewFinalByDefault, travel: addTravel || undefined });
            }
          }}>
            <datalist id="fonctions">{catalogue.map((f) => <option key={f.name} value={f.name} />)}</datalist>
            <NumInput className="w-qty" value={addQty} onChange={setAddQty} aria-label="Nombre de postes" />
            <span>×</span>
            <input list="fonctions" value={addFn} onChange={(e) => setAddFn(e.target.value)} placeholder={defaultFn} aria-label="Fonction à ajouter" style={{ maxWidth: 200 }} />
            {periods.length > 0 && (
              <select value={addPeriod} onChange={(e) => setAddPeriod(e.target.value)} aria-label="Créneau des postes" style={{ width: 'auto' }}>
                <option value="">Tout le sous-projet</option>
                {periods.map((pe) => <option key={pe.id} value={pe.id}>{pe.name}</option>)}
              </select>
            )}
            <label className="check-row" title="Ajouter le temps de trajet avant et après"><input type="checkbox" checked={addTravel} onChange={(e) => setAddTravel(e.target.checked)} /> Trajet</label>
            <button type="submit" className="small">+ Ajouter les postes</button>
          </form>
        )}
        {mode === 'postes' && (
          <div className="toolbar crew-presets">
            <select value={presetId} onChange={(e) => setPresetId(e.target.value)} aria-label="Liste de postes préétablie" style={{ width: 'auto' }}>
              <option value="">{presets.length ? 'Liste de postes préétablie…' : 'Aucune liste de postes enregistrée'}</option>
              {presets.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.posts.reduce((a, x) => a + x.qty, 0)} poste(s)</option>)}
            </select>
            <button type="button" className="secondary small" disabled={!presetId} onClick={async () => {
              const pr = presets.find((x) => x.id === presetId);
              if (!pr) return;
              for (const it of pr.posts) {
                // créneau : le premier du même type (montage, prestation…), sinon tout le sous-projet
                const pe = it.periodKind ? periods.find((x) => x.kind === it.periodKind) : undefined;
                for (let i = 0; i < Math.max(1, it.qty); i++) {
                  await save(db.crew, { projectId: sp.projectId, subprojectId: sp.id, function: it.function, ...slot(pe?.id), rate: it.rate, rateUnit: it.rateUnit, billable: true, final: !!d.settings.crewFinalByDefault });
                }
              }
              setPresetId('');
            }}><Icon name="plus" />Ajouter cette liste</button>
            {crew.length > 0 && <button type="button" className="ghost small" onClick={async () => {
              const name = prompt('Nom de la liste de postes (ex. Équipe son conférence) :', sp.name)?.trim();
              if (!name) return;
              const groups = new Map<string, CrewPreset['posts'][number]>();
              for (const c of crew) {
                const kind = periods.find((x) => x.id === c.periodId)?.kind;
                const k = [c.function, c.rate, c.rateUnit || 'jour', kind || ''].join('|');
                const g = groups.get(k);
                if (g) g.qty++; else groups.set(k, { function: c.function, qty: 1, rate: c.rate, rateUnit: c.rateUnit, periodKind: kind });
              }
              const s2 = await db.settings.get('main');
              if (s2) await db.settings.put({ ...s2, crewPresets: [...(s2.crewPresets || []).filter((x) => x.name !== name), { id: uid(), name, posts: [...groups.values()] }] });
              alert(`Liste « ${name} » enregistrée : ${crew.length} poste(s). Elle est proposée dans chaque projet.`);
            }}><Icon name="copy" />Enregistrer ces postes comme liste</button>}
            <span className="muted planned-client">Coût client prévu : <strong>{money(round2(plannedClient))}</strong> HT{openHere.length > 0 && <> · dont {openHere.length} poste(s) à pourvoir</>}</span>
          </div>
        )}

        {mode === 'postes' && <h3 style={{ margin: '16px 0 6px' }}>Transport</h3>}
        {mode !== 'postes' ? null : d.vehicles.length === 0 ? <Empty>Ajoute d'abord tes véhicules dans le menu Véhicules.</Empty> : (
          <>
            {vas.length > 0 && (
              <div className="table-wrap">
                <table className="list cards-sm">
                  <thead><tr><th>Véhicule</th>{periods.length > 0 && <th>Créneau</th>}<th>Chauffeur</th><th>Début</th><th>Fin</th><th title="Allers-retours">A/R</th><th>Km</th><th>€/km</th><th>Prix HT</th><th>Facturé</th><th /></tr></thead>
                  <tbody>
                    {vas.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <select value={v.vehicleId} onChange={(e) => updVaPriced(v, { vehicleId: e.target.value, perKm: undefined })}>
                            {d.vehicles.map((x) => <option key={x.id} value={x.id}>{x.name}{x.plate ? ` (${x.plate})` : ''}</option>)}
                          </select>
                          {vehicleBusy(v) && <div className="avail ko">Déjà réservé ailleurs</div>}
                        </td>
                        {periods.length > 0 && <td><PeriodSelect value={v.periodId} onChange={(p) => updVaPriced(v, slot(p))} /></td>}
                        <td>
                          <select value={v.driverId || ''} onChange={(e) => updVa(v, { driverId: e.target.value || undefined })}>
                            <option value="">—</option>
                            {d.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </td>
                        <td><input type="datetime-local" value={v.start} onChange={(e) => updVaPriced(v, { start: e.target.value, periodId: undefined })} /></td>
                        <td><input type="datetime-local" value={v.end} onChange={(e) => updVaPriced(v, { end: e.target.value, periodId: undefined })} /></td>
                        <td><NumInput className="w-qty" step="1" min={0} value={v.trips ?? d.settings.defaultTrips ?? 2} onChange={(n) => updVaPriced(v, { trips: n, ...(v.kmManual ? {} : { km: tripKm(d.project.distanceKm, n) }) })} /></td>
                        <td>
                          <NumInput className="w-qty" min={0} value={v.km ?? 0} onChange={(n) => updVaPriced(v, { km: n, kmManual: true })} />
                          {v.kmManual && <button className="ghost small" title="Recalculer depuis la distance du projet" onClick={() => updVaPriced(v, { kmManual: false, km: tripKm(d.project.distanceKm, v.trips ?? d.settings.defaultTrips ?? 2) })} aria-label="Recalculer les km"><Icon name="reset" /></button>}
                        </td>
                        <td><NumInput className="w-qty" min={0} value={perKmFor(v, vMap.get(v.vehicleId), d.settings)} onChange={(n) => updVaPriced(v, { perKm: n })} /></td>
                        <td><NumInput className="w-price" value={v.price} aria-label={`Prix facturé pour ${vMap.get(v.vehicleId)?.name || 'le véhicule'}`} title="Prix du transport facturé au client" onChange={(n) => updVa(v, { price: n })} /></td>
                        <td><input type="checkbox" checked={v.billable} onChange={(e) => updVa(v, { billable: e.target.checked })} /></td>
                        <td><button className="ghost" onClick={() => db.vehicleAssignments.delete(v.id)} aria-label="Retirer"><Icon name="x" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button className="small" style={{ marginTop: 8 }} onClick={() => {
              const veh = d.vehicles[0];
              const trips = d.settings.defaultTrips ?? 2;
              const va = { projectId: sp.projectId, subprojectId: sp.id, vehicleId: veh.id, ...slot(undefined), trips, km: tripKm(d.project.distanceKm, trips), billable: true };
              save(db.vehicleAssignments, { ...va, price: vehiclePrice(va, veh, d.settings) });
            }}>+ Véhicule</button>
          </>
        )}
      </div>
    </div>
  );
}

const hhmm = (s: string) => s.slice(11, 16);
const dayOf = (s: string) => s.slice(0, 10);
/** Ce qui a changé dans les horaires d'un poste depuis l'envoi du planning (vide si rien). */
export function changeOf(c: CrewAssignment): string {
  if (!c.sent) return '';
  const parts: string[] = [];
  const fmt = (o: string, n: string) => (dayOf(o) === dayOf(n) ? `${hhmm(o)} → ${hhmm(n)}` : `${fmtRange(o, o).split(' → ')[0]} → ${fmtRange(n, n).split(' → ')[0]}`);
  if (c.sent.start !== c.start) parts.push(`début ${fmt(c.sent.start, c.start)}`);
  if (c.sent.end !== c.end) parts.push(`fin ${fmt(c.sent.end, c.end)}`);
  if (!parts.length && c.sent.final !== (c.final !== false)) parts.push(c.final !== false ? 'devenu final' : 'repassé provisoire');
  return parts.join(' · ');
}

/** État de l'envoi du planning d'une personne : jamais envoyé, à jour, ou changé depuis. */
function sentState(items: { c: CrewAssignment }[]) {
  const sent = items.filter((i) => i.c.sent);
  if (!sent.length) return <span className="muted">Pas encore envoyé</span>;
  const changed = items.filter((i) => changeOf(i.c) || (!i.c.sent && i.c.final !== false)).length;
  const last = sent.map((i) => i.c.sent!.at).sort().slice(-1)[0];
  return changed
    ? <span className="sched-warn"><Icon name="warning" />{changed} changement(s) depuis l'envoi — à renvoyer</span>
    : <span className="avail ok"><Icon name="check" />Envoyé le {new Date(last).toLocaleDateString('fr-FR')}{sent.some((i) => !i.c.sent!.final) ? ' (provisoire)' : ''}</span>;
}

/** Envoi du planning à toutes les personnes planifiées (direct par le serveur, sinon via la messagerie). */
function SendPlanningAll({ people, withProv, items, mail, ics, onSent, onClose }: {
  people: Person[]; withProv: boolean; items: (p: Person) => { c: CrewAssignment }[];
  mail: (p: Person) => { to: string; subject: string; body: string }; ics: (p: Person) => { name: string; text: string };
  onSent: (p: Person) => Promise<void>; onClose: () => void;
}) {
  const settings = useSettings();
  const [server, setServer] = useState<MailServer | null>(null);
  const [pick, setPick] = useState<Set<string>>(() => new Set(people.filter((p) => p.email && items(p).length).map((p) => p.id)));
  const [res, setRes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  /** un seul email pour tous, avec un agenda .ics par personne, plutôt qu'un mail à chacun */
  const [oneMail, setOneMail] = useState(false);
  useEffect(() => { mailServer().then(setServer); }, []);
  return (
    <Modal title={`Envoyer le planning${withProv ? ' (postes provisoires compris)' : ''}`} onClose={onClose}>
      <p className="muted" style={{ marginTop: 0 }}>Chacun reçoit ses horaires et son agenda (.ics). Les horaires changés depuis le dernier envoi sont signalés « MODIFIÉ ».</p>
      <table className="list"><tbody>{people.map((p) => {
        const n = items(p).length, ch = items(p).filter((i) => changeOf(i.c) || !i.c.sent).length;
        return (
          <tr key={p.id}>
            <td><label className="check-row"><input type="checkbox" disabled={!p.email || !n} checked={pick.has(p.id)} aria-label={`Envoyer à ${p.name}`}
              onChange={(e) => { const x = new Set(pick); if (e.target.checked) x.add(p.id); else x.delete(p.id); setPick(x); }} /> <b>{p.name}</b></label></td>
            <td className="muted">{!p.email ? 'pas d\'email' : !n ? 'aucun poste final' : `${n} poste(s)${ch ? ` · ${ch} changement(s)` : ''}`}</td>
            <td>{res[p.id] ? <span className={res[p.id].startsWith('Envoy') ? 'avail ok' : 'muted'}>{res[p.id]}</span>
              : server && !server.ok && pick.has(p.id) ? <a className="button-link" href={mailtoUrl(mail(p))} onClick={() => { onSent(p); setRes((r) => ({ ...r, [p.id]: 'Ouvert dans ta messagerie' })); }}><Icon name="mail" />Ouvrir</a> : null}</td>
          </tr>
        );
      })}</tbody></table>
      {server && !server.ok && <p className="muted">Envoi direct indisponible ({server.error}) : ouvre chaque mail dans ta messagerie (l'agenda .ics n'est pas joint).</p>}
      {server?.ok && pick.size > 1 && (
        <label className="check-row" title="Un seul email avec tous les destinataires ; chacun reçoit son propre agenda .ics en pièce jointe">
          <input type="checkbox" checked={oneMail} onChange={(e) => setOneMail(e.target.checked)} /> Un seul email commun (un agenda .ics par personne)
        </label>
      )}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onClose}>Fermer</button>
        {server?.ok && <button type="button" disabled={busy || !pick.size} onClick={async () => {
          setBusy(true);
          const sel = people.filter((x) => pick.has(x.id) && x.email);
          if (oneMail && sel.length > 1) {
            try {
              const drafts = sel.map((p) => mail(p));
              const files = sel.map((p) => { const f = ics(p); return { name: f.name, type: 'text/calendar', blob: new Blob([f.text], { type: 'text/calendar;charset=utf-8' }) }; });
              await sendMail({ to: drafts.map((b) => b.to).filter(Boolean).join(', '), subject: drafts[0].subject, body: drafts.map((b, i) => `— ${sel[i].name} —\n${b.body}`).join('\n\n'), replyTo: replyAddress(settings) }, files);
              for (const p of sel) { await onSent(p); setRes((r) => ({ ...r, [p.id]: 'Envoyé (mail commun)' })); }
            } catch (e) { for (const p of sel) setRes((r) => ({ ...r, [p.id]: (e as Error).message })); }
            setBusy(false);
            return;
          }
          for (const p of sel) {
            try {
              const f = ics(p);
              await sendMail({ ...mail(p), replyTo: replyAddress(settings) }, [{ name: f.name, type: 'text/calendar', blob: new Blob([f.text], { type: 'text/calendar;charset=utf-8' }) }]);
              await onSent(p);
              setRes((r) => ({ ...r, [p.id]: 'Envoyé' }));
            } catch (e) { setRes((r) => ({ ...r, [p.id]: (e as Error).message })); }
          }
          setBusy(false);
        }}>{busy ? 'Envoi…' : oneMail ? `Envoyer 1 email à ${pick.size} personne(s)` : `Envoyer à ${pick.size} personne(s)`}</button>}
      </div>
    </Modal>
  );
}

/** heures prestées d'un poste : « 12 h », dont heures sup. (selon le forfait du technicien), trajet compris */
function HoursCell({ a, travel }: { a: ReturnType<typeof crewAmount>; travel: boolean }) {
  return (
    <span className="hours-cell" title={`${a.estimated ? 'Estimation : même horaire chaque jour. ' : ''}${travel ? 'Trajet aller et retour compris.' : ''}`}>
      <strong>{a.estimated ? '≈ ' : ''}{fmtHours(a.worked)}</strong>
      {a.costOvertime > 0 && <span className="avail ko hours-sub">dont {fmtHours(a.costOvertime)} sup.</span>}
      {travel && <span className="muted hours-sub">trajet compris</span>}
    </span>
  );
}
