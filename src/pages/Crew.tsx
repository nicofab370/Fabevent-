import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Empty, Field, Modal, NumInput, PageHead, useSettings } from '../components/ui';
import { appBaseUrl, db } from '../db';
import type { Person, Unavailability } from '../types';
import { buildIcs, download, fmtRange, money, save, toLocalInput } from '../utils';

type Draft = Partial<Person> & { name: string; dailyRate: number; external: boolean };

export default function Crew() {
  const settings = useSettings();
  const people = useLiveQuery(() => db.people.orderBy('name').toArray(), []) || [];
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const [edit, setEdit] = useState<Draft | null>(null);
  const [unavFor, setUnavFor] = useState<Person | null>(null);
  const unav = useLiveQuery(() => db.unavailability.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const sMap = new Map(subs.map((s) => [s.id, s]));
  const nowS = toLocalInput(new Date());

  const assignmentsOf = (id: string) => crew
    .filter((c) => c.personId === id && sMap.get(c.subprojectId)?.status !== 'annule')
    .sort((a, b) => a.start.localeCompare(b.start));

  const exportIcs = (person: Person) => {
    const base = appBaseUrl(settings);
    const events = assignmentsOf(person.id).map((c) => {
      const p = pMap.get(c.projectId);
      const s = sMap.get(c.subprojectId);
      return { uid: c.id, title: `${c.function} — ${p?.name || ''}`, start: c.start, end: c.end, location: s?.venue || p?.venue, description: s?.name, url: `${base}#/projets/${c.projectId}` };
    });
    download(`agenda-${person.name.replace(/\s+/g, '-')}.ics`, buildIcs(`FabEvent — ${person.name}`, events), 'text/calendar;charset=utf-8');
  };

  return (
    <>
      <PageHead title="Équipe & sous-traitants">
        <button onClick={() => setEdit({ name: '', dailyRate: 0, external: false })}>+ Nouvelle personne</button>
      </PageHead>
      <div className="card">
        {people.length === 0 ? <Empty>Ajoute tes techniciens (salariés, intermittents, sous-traitants).</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Nom</th><th>Fonction</th><th>Statut</th><th>Téléphone</th><th className="n">Tarif/j</th><th>Prochaines missions</th><th /></tr></thead>
              <tbody>
                {people.map((p) => {
                  const next = assignmentsOf(p.id).filter((c) => c.end >= nowS);
                  return (
                    <tr key={p.id}>
                      <td><a href="#" onClick={(e) => { e.preventDefault(); setEdit(p); }}><strong>{p.name}</strong></a></td>
                      <td>{p.role}</td>
                      <td><span className="badge">{p.external ? 'Sous-traitant' : 'Interne'}</span></td>
                      <td>{p.phone}</td>
                      <td className="n">{money(p.dailyRate)}</td>
                      <td>{next.length === 0 ? <span className="muted">—</span> : next.slice(0, 3).map((c) => (
                        <div key={c.id} style={{ fontSize: 12 }}>{pMap.get(c.projectId)?.name} · {fmtRange(c.start, c.end)}</div>
                      ))}{next.length > 3 && <span className="muted">+{next.length - 3}</span>}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="secondary small" onClick={() => setUnavFor(p)}>Indispos{unav.filter((u) => u.personId === p.id && u.end >= nowS).length ? ` (${unav.filter((u) => u.personId === p.id && u.end >= nowS).length})` : ''}</button>{' '}
                        <button className="secondary small" onClick={() => exportIcs(p)}>Agenda .ics</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted">Le bouton « Agenda .ics » produit le planning personnel de la personne, à lui envoyer pour son agenda (Google, Apple, Outlook).</p>
      {unavFor && <UnavailabilityModal person={unavFor} list={unav.filter((u) => u.personId === unavFor.id)} onClose={() => setUnavFor(null)} />}
      {edit && (
        <Modal title={edit.id ? 'Modifier' : 'Nouvelle personne'} onClose={() => setEdit(null)}>
          <form className="form" onSubmit={async (e) => { e.preventDefault(); await save(db.people, edit as Person); setEdit(null); }}>
            <Field label="Nom *" full><input required autoFocus value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <Field label="Fonction principale"><input value={edit.role || ''} onChange={(e) => setEdit({ ...edit, role: e.target.value })} placeholder="ex. Régisseur son" /></Field>
            <Field label="Tarif facturé / jour HT (€)"><NumInput value={edit.dailyRate} onChange={(n) => setEdit({ ...edit, dailyRate: n })} /></Field>
            <Field label="Coût pour toi / jour (€)"><NumInput value={edit.costRate || 0} onChange={(n) => setEdit({ ...edit, costRate: n })} /></Field>
            <Field label="Email"><input type="email" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
            <Field label="Téléphone"><input value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} /></Field>
            <Field label=" " full><label className="check-row"><input type="checkbox" checked={edit.external} onChange={(e) => setEdit({ ...edit, external: e.target.checked })} /> Sous-traitant / freelance externe</label></Field>
            <Field label="Notes" full><textarea value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></Field>
            <div className="form-actions">
              {edit.id && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={async () => {
                if (confirm('Supprimer cette personne ? Ses postes resteront « à pourvoir ».')) {
                  await db.crew.where({ personId: edit.id }).modify({ personId: undefined });
                  await db.people.delete(edit.id!); setEdit(null);
                }
              }}>Supprimer</button>}
              <button type="button" className="secondary" onClick={() => setEdit(null)}>Annuler</button>
              <button type="submit">Enregistrer</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

function UnavailabilityModal({ person, list, onClose }: { person: Person; list: Unavailability[]; onClose: () => void }) {
  const [start, setStart] = useState(toLocalInput(new Date()).slice(0, 10) + 'T00:00');
  const [end, setEnd] = useState(toLocalInput(new Date()).slice(0, 10) + 'T23:59');
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Indisponibilités — ${person.name}`} onClose={onClose}>
      {list.length === 0 ? <Empty>Aucune indisponibilité.</Empty> : (
        <table className="list">
          <tbody>
            {list.sort((a, b) => a.start.localeCompare(b.start)).map((u) => (
              <tr key={u.id}><td>{fmtRange(u.start, u.end)}</td><td>{u.reason}</td><td><button className="ghost" onClick={() => db.unavailability.delete(u.id)} aria-label="Retirer">✕</button></td></tr>
            ))}
          </tbody>
        </table>
      )}
      <form className="form" style={{ marginTop: 12 }} onSubmit={async (e) => {
        e.preventDefault();
        if (end < start) return alert('La fin doit être après le début.');
        await save(db.unavailability, { personId: person.id, start, end, reason: reason || undefined });
        setReason('');
      }}>
        <Field label="Du"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Au"><input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
        <Field label="Motif" full><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Congés, autre prestation…" /></Field>
        <div className="form-actions"><button type="submit">+ Ajouter</button></div>
      </form>
    </Modal>
  );
}
