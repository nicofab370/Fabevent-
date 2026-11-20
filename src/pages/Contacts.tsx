import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Empty, Field, Modal, PageHead, NumInput, useSettings } from '../components/ui';
import { db } from '../db';
import type { Contact, ContactPerson, ContactType } from '../types';
import { CONTACT_TYPES, LANG_LABELS, VAT_REGIME_LABELS, type Lang, type VatRegime } from '../types';
import { CsvButton, CustomFieldsEditor, exportCsv, TagInput, Tags } from '../components/extra';
import { suggestRegime } from '../payment';
import { save } from '../utils';

type Draft = Partial<Contact> & { type: ContactType; company: string };

export function ContactForm({ initial, onDone }: { initial?: Draft; onDone: (c?: Contact) => void }) {
  const settings = useSettings();
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
      <Field label="N° d'entreprise / SIRET"><input value={c.siret || ''} onChange={(e) => set('siret', e.target.value)} /></Field>
      <Field label="Pays"><input value={c.country || ''} onChange={(e) => set('country', e.target.value)} placeholder="BE, FR…" /></Field>
      <Field label="Identifiant Peppol"><input value={c.peppolId || ''} onChange={(e) => set('peppolId', e.target.value)} placeholder="0208:0123456789" /></Field>
      {(c.type === 'client' || c.vatRegime) && (
        <>
          <Field label="Régime de TVA par défaut">
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={c.vatRegime || 'normal'} onChange={(e) => setC({ ...c, vatRegime: e.target.value === 'normal' ? undefined : e.target.value as VatRegime })}>
                {Object.entries(VAT_REGIME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <button type="button" className="secondary small" title="Déduire du pays et du n° de TVA"
                onClick={() => { const r = suggestRegime(c.country, c.vatNumber, settings.company.country || 'BE'); setC({ ...c, vatRegime: r === 'normal' ? undefined : r }); }}>Auto</button>
            </div>
          </Field>
          <Field label="Remises par défaut (%)">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="check-row">Matériel <NumInput className="w-qty" value={c.discounts?.equipment || 0} onChange={(n) => setC({ ...c, discounts: { ...c.discounts, equipment: n || undefined } })} /></label>
              <label className="check-row">Total <NumInput className="w-qty" value={c.discounts?.total || 0} onChange={(n) => setC({ ...c, discounts: { ...c.discounts, total: n || undefined } })} /></label>
            </div>
          </Field>
        </>
      )}
      <div className="field full">
        <span>Interlocuteurs</span>
        {(c.persons || []).map((x, i) => {
          const upd = (k: keyof ContactPerson, v: string) => setC({ ...c, persons: (c.persons || []).map((y, j) => (j === i ? { ...y, [k]: v } : y)) });
          return (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 6, marginBottom: 6 }}>
              <input placeholder="Nom" value={x.name} onChange={(e) => upd('name', e.target.value)} />
              <input placeholder="Fonction" value={x.role || ''} onChange={(e) => upd('role', e.target.value)} />
              <input placeholder="Email" value={x.email || ''} onChange={(e) => upd('email', e.target.value)} />
              <input placeholder="Téléphone" value={x.phone || ''} onChange={(e) => upd('phone', e.target.value)} />
              <button type="button" className="ghost" onClick={() => setC({ ...c, persons: (c.persons || []).filter((_, j) => j !== i) })} aria-label="Retirer">✕</button>
            </div>
          );
        })}
        <div><button type="button" className="secondary small" onClick={() => setC({ ...c, persons: [...(c.persons || []), { name: '' }] })}>+ Interlocuteur</button></div>
      </div>
      <Field label="Langue des documents">
        <select value={c.language || 'fr'} onChange={(e) => setC({ ...c, language: e.target.value === 'fr' ? undefined : e.target.value as Lang })}>
          {Object.entries(LANG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="Étiquettes"><TagInput value={c.tags} onChange={(tags) => setC({ ...c, tags })} /></Field>
      <CustomFieldsEditor entity="contact" value={c.custom} onChange={(custom) => setC({ ...c, custom })} />
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
  const [tag, setTag] = useState('');
  const allTags = Array.from(new Set(contacts.flatMap((c) => c.tags || []))).sort();
  const filtered = contacts.filter((c) =>
    (!type || c.type === type) &&
    (!tag || c.tags?.includes(tag)) &&
    [c.company, c.firstName, c.lastName, c.email, c.city, ...(c.tags || [])].join(' ').toLowerCase().includes(q.toLowerCase()));
  const csv = () => exportCsv('contacts.csv', ['Société / nom', 'Type', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Adresse', 'CP', 'Ville', 'Pays', 'N° TVA', 'Peppol', 'Étiquettes'],
    filtered.map((c) => [c.company, CONTACT_TYPES[c.type], c.firstName, c.lastName, c.email, c.phone, c.address, c.postalCode, c.city, c.country, c.vatNumber, c.peppolId, (c.tags || []).join(', ')]));

  return (
    <>
      <PageHead title="Contacts">
        <CsvButton onClick={csv} />
        <button onClick={() => setEdit({ type: 'client', company: '' })}>+ Nouveau contact</button>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">Tous les types</option>
            {Object.entries(CONTACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {allTags.length > 0 && (
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">Toutes étiquettes</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
        {filtered.length === 0 ? <Empty>Aucun contact.</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Nom</th><th>Type</th><th>Contact</th><th>Email</th><th>Téléphone</th><th>Ville</th></tr></thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="click" onClick={() => setEdit(c)}>
                    <td><strong>{c.company}</strong> <Tags tags={c.tags} /></td>
                    <td><span className="badge">{CONTACT_TYPES[c.type]}</span></td>
                    <td>{[c.firstName, c.lastName].filter(Boolean).join(' ')}{c.persons?.length ? <span className="muted"> +{c.persons.length} interlocuteur(s)</span> : null}</td>
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
