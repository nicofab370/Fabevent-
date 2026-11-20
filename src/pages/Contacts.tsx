import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Empty, Field, Modal, PageHead } from '../components/ui';
import { db } from '../db';
import type { Contact, ContactType } from '../types';
import { CONTACT_TYPES } from '../types';
import { save } from '../utils';

type Draft = Partial<Contact> & { type: ContactType; company: string };

export function ContactForm({ initial, onDone }: { initial?: Draft; onDone: (c?: Contact) => void }) {
  const [c, setC] = useState<Draft>(initial || { type: 'client', company: '' });
  const set = (k: keyof Contact, v: string) => setC({ ...c, [k]: v });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    onDone(await save(db.contacts, c as Contact));
  };
  return (
    <form className="form" onSubmit={submit}>
      <Field label="Société / Nom *"><input required value={c.company} onChange={(e) => set('company', e.target.value)} autoFocus /></Field>
      <Field label="Type">
        <select value={c.type} onChange={(e) => set('type', e.target.value)}>
          {Object.entries(CONTACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Prénom"><input value={c.firstName || ''} onChange={(e) => set('firstName', e.target.value)} /></Field>
      <Field label="Nom"><input value={c.lastName || ''} onChange={(e) => set('lastName', e.target.value)} /></Field>
      <Field label="Email"><input type="email" value={c.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
      <Field label="Téléphone"><input value={c.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
      <Field label="Adresse" full><input value={c.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>
      <Field label="Code postal"><input value={c.postalCode || ''} onChange={(e) => set('postalCode', e.target.value)} /></Field>
      <Field label="Ville"><input value={c.city || ''} onChange={(e) => set('city', e.target.value)} /></Field>
      <Field label="N° TVA"><input value={c.vatNumber || ''} onChange={(e) => set('vatNumber', e.target.value)} /></Field>
      <Field label="SIRET"><input value={c.siret || ''} onChange={(e) => set('siret', e.target.value)} /></Field>
      <Field label="Notes" full><textarea value={c.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={() => onDone()}>Annuler</button>
        <button type="submit">Enregistrer</button>
      </div>
    </form>
  );
}

export default function Contacts() {
  const contacts = useLiveQuery(() => db.contacts.orderBy('company').toArray(), []) || [];
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const filtered = contacts.filter((c) =>
    (!type || c.type === type) &&
    [c.company, c.firstName, c.lastName, c.email, c.city].join(' ').toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead title="Contacts">
        <button onClick={() => setEdit({ type: 'client', company: '' })}>+ Nouveau contact</button>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Tous les types</option>
            {Object.entries(CONTACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {filtered.length === 0 ? <Empty>Aucun contact.</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Nom</th><th>Type</th><th>Contact</th><th>Email</th><th>Téléphone</th><th>Ville</th></tr></thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="click" onClick={() => setEdit(c)}>
                    <td><strong>{c.company}</strong></td>
                    <td><span className="badge">{CONTACT_TYPES[c.type]}</span></td>
                    <td>{[c.firstName, c.lastName].filter(Boolean).join(' ')}</td>
                    <td>{c.email}</td>
                    <td>{c.phone}</td>
                    <td>{c.city}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && (
        <Modal title={edit.id ? 'Modifier le contact' : 'Nouveau contact'} onClose={() => setEdit(null)}>
          <ContactForm initial={edit} onDone={() => setEdit(null)} />
          {edit.id && (
            <div style={{ marginTop: 12 }}>
              <button className="danger small" onClick={async () => {
                if (confirm('Supprimer ce contact ?')) { await db.contacts.delete(edit.id!); setEdit(null); }
              }}>Supprimer</button>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
