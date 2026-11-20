import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead, StatusBadge, useSettings } from '../components/ui';
import { DEFAULT_PROJECT_TYPES, db, nextNumber } from '../db';
import type { Project, ProjectStatus } from '../types';
import { STATUS_LABELS } from '../types';
import { fmtRange, save, toLocalInput } from '../utils';
import { ContactForm } from './Contacts';

type Draft = Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'number'> & Partial<Project>;

export function ProjectForm({ initial, onDone }: { initial?: Draft; onDone: (p?: Project) => void }) {
  const today = new Date();
  today.setHours(8, 0, 0, 0);
  const end = new Date(today);
  end.setHours(23, 0);
  const [p, setP] = useState<Draft>(initial || { name: '', status: 'demande', start: toLocalInput(today), end: toLocalInput(end), discount: 0 });
  const [newClient, setNewClient] = useState(false);
  const settings = useSettings();
  const types = settings.projectTypes?.length ? settings.projectTypes : DEFAULT_PROJECT_TYPES;
  const clients = useLiveQuery(() => db.contacts.orderBy('company').toArray(), []) || [];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setP({ ...p, [k]: v });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (p.end < p.start) return alert('La fin doit être après le début.');
    const isNew = !p.id;
    const number = p.number || (await nextNumber('P'));
    // nouveau projet : régime de TVA et remise globale par défaut du client
    const client = isNew && p.clientId ? clients.find((c) => c.id === p.clientId) : undefined;
    const saved = await save(db.projects, {
      ...p, number, vatRegime: p.vatRegime ?? client?.vatRegime, discount: p.discount || client?.discounts?.total || 0,
    } as Project);
    if (isNew) {
      // Un premier sous-projet est créé automatiquement
      await save(db.subprojects, { projectId: saved.id, name: 'Principal', venue: saved.venue, status: saved.status, start: saved.start, end: saved.end, order: 0 });
    }
    onDone(saved);
  };

  if (newClient) {
    return <ContactForm onDone={(c) => { setNewClient(false); if (c) set('clientId', c.id); }} />;
  }

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Nom du projet *" full><input required autoFocus value={p.name} onChange={(e) => set('name', e.target.value)} /></Field>
      <Field label="Client">
        <div style={{ display: 'flex', gap: 6 }}>
          <select value={p.clientId || ''} onChange={(e) => set('clientId', e.target.value || undefined)}>
            <option value="">—</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </select>
          <button type="button" className="secondary small" onClick={() => setNewClient(true)}>+</button>
        </div>
      </Field>
      {(() => {
        const persons = clients.find((c) => c.id === p.clientId)?.persons || [];
        return persons.length > 0 ? (
          <Field label="Interlocuteur">
            <select value={p.contactPerson || ''} onChange={(e) => set('contactPerson', e.target.value || undefined)}>
              <option value="">—</option>
              {persons.map((x, i) => <option key={i} value={x.name}>{x.name}{x.role ? ` (${x.role})` : ''}</option>)}
            </select>
          </Field>
        ) : null;
      })()}
      <Field label="Type de projet">
        <select value={p.typeName || ''} onChange={(e) => setP({ ...p, typeName: e.target.value || undefined, color: types.find((t) => t.name === e.target.value)?.color })}>
          <option value="">—</option>
          {types.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="Statut">
        <select value={p.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Début"><input type="datetime-local" required value={p.start} onChange={(e) => set('start', e.target.value)} /></Field>
      <Field label="Fin"><input type="datetime-local" required value={p.end} onChange={(e) => set('end', e.target.value)} /></Field>
      <Field label="Lieu"><input value={p.venue || ''} onChange={(e) => set('venue', e.target.value)} /></Field>
      <Field label="Remise globale (%)"><NumInput value={p.discount} onChange={(n) => set('discount', n)} /></Field>
      <Field label="Notes (visibles sur feuille de route / bon de sortie)" full><textarea value={p.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={() => onDone()}>Annuler</button>
        <button type="submit">Enregistrer</button>
      </div>
    </form>
  );
}

export default function Projects() {
  const nav = useNavigate();
  const projects = useLiveQuery(() => db.projects.orderBy('start').reverse().toArray(), []) || [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) || [];
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const cMap = new Map(contacts.map((c) => [c.id, c.company]));
  const filtered = projects.filter((p) =>
    (!status || p.status === status) &&
    [p.number, p.name, p.venue, p.clientId && cMap.get(p.clientId)].join(' ').toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead title="Projets"><button onClick={() => setCreating(true)}>+ Nouveau projet</button></PageHead>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous statuts</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {filtered.length === 0 ? <Empty>Aucun projet.</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>N°</th><th>Projet</th><th>Type</th><th>Client</th><th>Dates</th><th>Lieu</th><th>Statut</th></tr></thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.id} className="click" onClick={() => nav('/projets/' + p.id)}>
                    <td className="muted">{p.number}</td>
                    <td><span className="color-dot" style={{ background: p.color || 'var(--border)' }} /><strong>{p.name}</strong></td>
                    <td className="muted">{p.typeName}</td>
                    <td>{p.clientId && cMap.get(p.clientId)}</td>
                    <td>{fmtRange(p.start, p.end)}</td>
                    <td>{p.venue}</td>
                    <td><StatusBadge status={p.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && (
        <Modal title="Nouveau projet" onClose={() => setCreating(false)}>
          <ProjectForm onDone={(p) => { setCreating(false); if (p) nav('/projets/' + p.id); }} />
        </Modal>
      )}
    </>
  );
}
