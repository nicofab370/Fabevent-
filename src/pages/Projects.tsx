import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead, StatusBadge, useSettings } from '../components/ui';
import { DEFAULT_PROJECT_TYPES, db, nextNumber } from '../db';
import { copyProject, shiftBetween } from '../projectOps';
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
  const [fromTemplate, setFromTemplate] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const cMap = new Map(contacts.map((c) => [c.id, c.company]));
  const templates = projects.filter((p) => p.isTemplate);
  const filtered = projects.filter((p) =>
    !!p.isTemplate === showTemplates &&
    (!status || p.status === status) &&
    [p.number, p.name, p.venue, p.clientId && cMap.get(p.clientId)].join(' ').toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead title={showTemplates ? 'Modèles de projet' : 'Projets'}>
        <button className="secondary" onClick={() => setShowTemplates(!showTemplates)}>{showTemplates ? '← Projets' : `Modèles (${templates.length})`}</button>
        {templates.length > 0 && <button className="secondary" onClick={() => setFromTemplate(true)}>+ À partir d'un modèle</button>}
        <button onClick={() => setCreating(true)}>+ Nouveau projet</button>
      </PageHead>
      {showTemplates && <div className="info">Un modèle se crée depuis un projet existant (« Enregistrer comme modèle ») : il garde salles, horaires, matériel, postes et coûts, sans rien réserver.</div>}
      <div className="card">
        <div className="toolbar">
          <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Tous statuts</option>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {filtered.length === 0 ? <Empty>{showTemplates ? 'Aucun modèle.' : 'Aucun projet.'}</Empty> : (
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
      {fromTemplate && <FromTemplateModal templates={templates} onClose={() => setFromTemplate(false)} />}
      {creating && (
        <Modal title="Nouveau projet" onClose={() => setCreating(false)}>
          <ProjectForm onDone={(p) => { setCreating(false); if (p) nav('/projets/' + p.id); }} />
        </Modal>
      )}
    </>
  );
}

/** Nouveau projet à partir d'un modèle : tout est recopié et décalé à la date choisie. */
function FromTemplateModal({ templates, onClose }: { templates: Project[]; onClose: () => void }) {
  const nav = useNavigate();
  const [tplId, setTplId] = useState(templates[0]?.id || '');
  const tpl = templates.find((t) => t.id === tplId);
  const [name, setName] = useState('');
  const [start, setStart] = useState(() => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(8, 0, 0, 0); return toLocalInput(d); });
  const [clientId, setClientId] = useState('');
  const clients = useLiveQuery(() => db.contacts.where('type').equals('client').sortBy('company'), []) || [];
  return (
    <Modal title="Nouveau projet à partir d'un modèle" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        if (!tpl) return;
        const p = await copyProject(tpl.id, { name: name.trim() || tpl.name, status: 'demande', shift: shiftBetween(tpl.start, start) });
        const client = clients.find((c) => c.id === clientId);
        if (client) await save(db.projects, { ...p, clientId: client.id, vatRegime: client.vatRegime, discount: client.discounts?.total || p.discount });
        onClose();
        nav('/projets/' + p.id);
      }}>
        <Field label="Modèle" full>
          <select value={tplId} onChange={(e) => setTplId(e.target.value)}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </Field>
        <Field label="Nom du projet" full><input value={name} placeholder={tpl?.name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Début"><input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
        <Field label="Client">
          <select value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Celui du modèle</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
          </select>
        </Field>
        <p className="muted field full" style={{ margin: 0 }}>Toutes les dates du modèle (créneaux, postes, véhicules) sont décalées pour commencer à cette date.</p>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={!tpl}>Créer le projet</button>
        </div>
      </form>
    </Modal>
  );
}
