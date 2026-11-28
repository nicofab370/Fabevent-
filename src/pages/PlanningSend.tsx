/**
 * Partage groupé du planning des techniciens (page Équipe) : une période, des projets, des personnes ;
 * un point marque ceux dont le planning a changé depuis le dernier envoi, et dans le mail
 * une astérisque précède les lignes nouvelles ou modifiées.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { mailtoUrl } from '../email';
import { db } from '../db';
import { mailServer, replyAddress, sendMail } from '../mailer';
import type { CrewAssignment, Person, Project, Subproject } from '../types';
import { crewWindow, fmtRange, toLocalInput } from '../utils';
import { Field, Modal, useSettings } from '../components/ui';

export interface PlanLine { key: string; text: string }

/** Lignes du planning d'une personne sur une période (postes finals, et provisoires si demandé). */
export function planningLines(personId: string, crew: CrewAssignment[], projects: Map<string, Project>, subs: Map<string, Subproject>, from: string, to: string, withProv: boolean, projectIds?: string[]): PlanLine[] {
  return crew
    .filter((c) => c.personId === personId && (withProv || c.final !== false) && subs.get(c.subprojectId)?.status !== 'annule' && c.start < to && from < c.end && (!projectIds?.length || projectIds.includes(c.projectId)))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((c) => {
      const p = projects.get(c.projectId), sp = subs.get(c.subprojectId);
      const [a, b] = crewWindow(c, p?.travelMinutes);
      const text = `${fmtRange(a, b)} | ${p?.number || ''} ${p?.name || ''}${sp && sp.name !== 'Principal' ? ` · ${sp.name}` : ''} | ${c.function}${sp?.venue || p?.venue ? ` | ${sp?.venue || p?.venue}` : ''}${c.final === false ? ' (provisoire)' : ''}`;
      return { key: c.id, text };
    });
}

/** Lignes nouvelles ou modifiées par rapport au dernier envoi. */
export const changedLines = (lines: PlanLine[], last?: { lines: string[] }) => (last ? lines.filter((l) => !last.lines.includes(l.text)) : lines);

export function PlanningSend({ people, onClose }: { people: Person[]; onClose: () => void }) {
  const settings = useSettings();
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const sMap = new Map(subs.map((s) => [s.id, s]));
  const [from, setFrom] = useState(toLocalInput(new Date()).slice(0, 10));
  const [to, setTo] = useState(toLocalInput(new Date(Date.now() + 30 * 86400000)).slice(0, 10));
  const [withProv, setWithProv] = useState(false);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const f = from + 'T00:00', t = to + 'T23:59';
  const inRange = projects.filter((p) => !p.isTemplate && crew.some((c) => c.projectId === p.id && c.personId && c.start < t && f < c.end)).sort((a, b) => a.start.localeCompare(b.start));
  const rows = people.map((p) => {
    const lines = planningLines(p.id, crew, pMap, sMap, f, t, withProv, projectIds);
    return { p, lines, changed: changedLines(lines, p.lastPlanning) };
  }).filter((r) => r.lines.length);
  const sel = chosen ?? rows.map((r) => r.p.id);
  const bodyOf = (r: (typeof rows)[number]) => {
    const ch = new Set(r.changed.map((l) => l.key));
    const mark = !!r.p.lastPlanning;
    return [
      `Bonjour ${r.p.name.split(' ')[0]},`, '',
      `Voici ton planning du ${fmtRange(f, t).replace(/ \d\d:\d\d/g, '')} :`, '',
      ...r.lines.map((l) => `${mark && ch.has(l.key) ? '* ' : '- '}${l.text}`), '',
      ...(mark && ch.size ? ['* = nouveau ou modifié par rapport au précédent email', ''] : []),
      ...(text.trim() ? [text.trim(), ''] : []),
      settings.company.name,
    ].join('\n');
  };
  const send = async () => {
    setBusy(true);
    const srv = await mailServer();
    const out: string[] = [];
    for (const r of rows.filter((x) => sel.includes(x.p.id))) {
      const m = { to: r.p.email || '', subject: `Planning — ${settings.company.name}`, body: bodyOf(r) };
      if (!m.to) { out.push(`${r.p.name} : pas d'email`); continue; }
      try {
        if (srv.ok) await sendMail({ ...m, replyTo: replyAddress(settings) }, [], { kind: 'planning', personId: r.p.id });
        else window.open(mailtoUrl(m), '_blank');
        await db.people.update(r.p.id, { lastPlanning: { at: new Date().toISOString(), lines: r.lines.map((l) => l.text) } });
        out.push(`${r.p.name} : ${srv.ok ? 'envoyé' : 'ouvert dans ta messagerie'}`);
      } catch (e) { out.push(`${r.p.name} : ${(e as Error).message}`); }
    }
    setResult(out);
    setBusy(false);
  };
  return (
    <Modal title="Partager le planning" onClose={onClose} wide>
      <div className="form">
        <Field label="Du"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="Au"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Projets (aucun coché = tous)" full>
          <div className="chips">
            {inRange.map((p) => (
              <label key={p.id} className="check-row"><input type="checkbox" checked={projectIds.includes(p.id)} onChange={(e) => setProjectIds(e.target.checked ? [...projectIds, p.id] : projectIds.filter((x) => x !== p.id))} /> {p.number} {p.name}</label>
            ))}
            {!inRange.length && <span className="muted">Aucun projet avec du personnel sur la période.</span>}
          </div>
        </Field>
        <Field label=" " full><label className="check-row"><input type="checkbox" checked={withProv} onChange={(e) => setWithProv(e.target.checked)} /> Inclure les postes provisoires</label></Field>
      </div>
      <table className="list no-sort">
        <thead><tr><th /><th>Personne</th><th>Postes</th><th>Depuis le dernier envoi</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.p.id}>
              <td><input type="checkbox" aria-label={`Envoyer à ${r.p.name}`} checked={sel.includes(r.p.id)} onChange={(e) => setChosen(e.target.checked ? [...sel, r.p.id] : sel.filter((x) => x !== r.p.id))} /></td>
              <td>{r.changed.length > 0 && <span className="dot-changed" title="Planning modifié depuis le dernier envoi" aria-label="modifié" />} <strong>{r.p.name}</strong>{!r.p.email && <div className="muted">pas d'email</div>}</td>
              <td>{r.lines.length}</td>
              <td>{!r.p.lastPlanning ? <span className="muted">jamais envoyé</span> : r.changed.length ? <span className="avail ko">{r.changed.length} ligne(s) nouvelle(s) ou modifiée(s)</span> : <span className="avail ok">inchangé (envoyé le {new Date(r.p.lastPlanning.at).toLocaleDateString('fr-BE')})</span>}</td>
              <td><button className="secondary small" onClick={() => setPreview(bodyOf(r))}>Aperçu</button></td>
            </tr>
          ))}
          {!rows.length && <tr><td colSpan={5} className="muted">Personne n'a de poste sur cette période.</td></tr>}
        </tbody>
      </table>
      <Field label="Texte ajouté à chaque mail" full><textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="Ex. : rendez-vous au dépôt 30 min avant" /></Field>
      {preview && <pre className="mail-preview">{preview}</pre>}
      <div className="toolbar" style={{ marginTop: 10 }}>
        <button disabled={busy || !sel.some((id) => rows.some((r) => r.p.id === id))} onClick={send}>{busy ? 'Envoi…' : `Envoyer à ${sel.filter((id) => rows.some((r) => r.p.id === id)).length} personne(s)`}</button>
      </div>
      {result.length > 0 && <ul>{result.map((x) => <li key={x}>{x}</li>)}</ul>}
    </Modal>
  );
}
