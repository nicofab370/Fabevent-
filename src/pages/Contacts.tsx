import { useNavigate } from 'react-router-dom';
import { ContactLookup } from '../components/ContactLookup';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Empty, Field, Modal, PageHead, NumInput, useSettings } from '../components/ui';
import { settingsMoments } from '../invoicing';
import { db } from '../db';
import type { Contact, ContactPerson, ContactType, Department, DiscountPart, PostalAddress } from '../types';
import { DISCOUNT_PARTS } from '../types';
import { PeppolSearch } from '../components/PeppolSearch';
import { MailHistory } from './EmailsPage';
import { deptOf, withPersonIds } from '../places';
import { CONTACT_TYPES, LANG_LABELS, VAT_REGIME_LABELS, type Lang, type VatRegime } from '../types';
import { CsvButton, CustomFieldsEditor, exportCsv, TagInput, Tags } from '../components/extra';
import { suggestRegime } from '../payment';
import { save, uid } from '../utils';
import { Icon } from '../components/Icon';
import { BulkBar, BulkSet, SelectAllTh, SelectTd, useSelection } from '../components/Selection';

type Draft = Partial<Contact> & { type: ContactType; company: string };

/** Adresse secondaire (postale, facturation) : vide = identique à l'adresse principale. */
function AddressBlock({ label, value, onChange }: { label: string; value?: PostalAddress; onChange: (v?: PostalAddress) => void }) {
  const [open, setOpen] = useState(!!value?.address);
  const v = value || {};
  const upd = (k: keyof PostalAddress, x: string) => { const n = { ...v, [k]: x || undefined }; onChange(Object.values(n).some(Boolean) ? n : undefined); };
  return (
    <Field label={label} full>
      <label className="check-row"><input type="checkbox" checked={!open} onChange={(e) => { setOpen(!e.target.checked); if (e.target.checked) onChange(undefined); }} /> Identique à l'adresse principale</label>
      {open && (
        <div className="addr-grid">
          <input aria-label={`${label} : rue et numéro`} placeholder="Rue et numéro" value={v.address || ''} onChange={(e) => upd('address', e.target.value)} />
          <input aria-label={`${label} : code postal`} placeholder="Code postal" value={v.postalCode || ''} onChange={(e) => upd('postalCode', e.target.value)} />
          <input aria-label={`${label} : ville`} placeholder="Ville" value={v.city || ''} onChange={(e) => upd('city', e.target.value)} />
          <input aria-label={`${label} : pays`} placeholder="Pays" value={v.country || ''} onChange={(e) => upd('country', e.target.value)} />
        </div>
      )}
    </Field>
  );
}

export function ContactForm({ initial, onDone }: { initial?: Draft; onDone: (c?: Contact) => void }) {
  const settings = useSettings();
  const [c, setC] = useState<Draft>(initial || { type: 'client', company: '' });
  const folders = useLiveQuery(async () => Array.from(new Set((await db.contacts.toArray()).map((x) => x.folder).filter((f): f is string => !!f))).sort(), []) || [];
  const set = (k: keyof Contact, v: string) => setC({ ...c, [k]: v });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    onDone(await save(db.contacts, withPersonIds(c) as Contact));
  };
  return (
    <form className="form" onSubmit={submit}>
      <Field label="Société / Nom *"><input required value={c.company} onChange={(e) => set('company', e.target.value)} autoFocus /></Field>
      <Field label="Type">
        <select value={c.type} onChange={(e) => set('type', e.target.value)}>
          {Object.entries(CONTACT_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <ContactLookup c={c} setC={setC} />
      <Field label="Prénom"><input value={c.firstName || ''} onChange={(e) => set('firstName', e.target.value)} /></Field>
      <Field label="Nom"><input value={c.lastName || ''} onChange={(e) => set('lastName', e.target.value)} /></Field>
      <Field label="Email"><input type="email" value={c.email || ''} onChange={(e) => set('email', e.target.value)} /></Field>
      <Field label="Téléphone"><input value={c.phone || ''} onChange={(e) => set('phone', e.target.value)} /></Field>
      <Field label="Email 2"><input type="email" value={c.email2 || ''} onChange={(e) => set('email2', e.target.value)} /></Field>
      <Field label="Téléphone 2"><input value={c.phone2 || ''} onChange={(e) => set('phone2', e.target.value)} /></Field>
      <Field label="Site internet"><input value={c.website || ''} onChange={(e) => set('website', e.target.value)} placeholder="https://…" /></Field>
      <Field label="Adresse" full><input value={c.address || ''} onChange={(e) => set('address', e.target.value)} /></Field>
      <Field label="Code postal"><input value={c.postalCode || ''} onChange={(e) => set('postalCode', e.target.value)} /></Field>
      <Field label="Ville"><input value={c.city || ''} onChange={(e) => set('city', e.target.value)} /></Field>
      <Field label="N° TVA"><input value={c.vatNumber || ''} onChange={(e) => set('vatNumber', e.target.value)} /></Field>
      <Field label="N° d'entreprise / SIRET"><input value={c.siret || ''} onChange={(e) => set('siret', e.target.value)} /></Field>
      <Field label="Pays"><input value={c.country || ''} onChange={(e) => set('country', e.target.value)} placeholder="BE, FR…" /></Field>
      <Field label="Identifiant Peppol">
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={c.peppolId || ''} onChange={(e) => set('peppolId', e.target.value)} placeholder="0208:0123456789" />
          <PeppolSearch c={c} onFound={(id) => set('peppolId', id)} />
        </div>
      </Field>
      <AddressBlock label="Adresse postale" value={c.postalAddress} onChange={(postalAddress) => setC({ ...c, postalAddress })} />
      <AddressBlock label="Adresse de facturation" value={c.billingAddress} onChange={(billingAddress) => setC({ ...c, billingAddress })} />
      <Field label="IBAN"><input value={c.iban || ''} onChange={(e) => set('iban', e.target.value)} /></Field>
      <Field label="BIC"><input value={c.bic || ''} onChange={(e) => set('bic', e.target.value)} /></Field>
      <Field label="N° en comptabilité"><input value={c.accountingCode || ''} onChange={(e) => set('accountingCode', e.target.value)} /></Field>
      {c.type === 'client' && <Field label="N° de bon de commande (repris sur ses projets)"><input value={c.purchaseNumber || ''} onChange={(e) => set('purchaseNumber', e.target.value)} /></Field>}
      {c.type === 'lieu' && (
        <Field label="Depuis le dépôt">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label className="check-row"><NumInput className="w-qty" value={c.distanceKm || 0} onChange={(n) => setC({ ...c, distanceKm: n || undefined })} /> km</label>
            <label className="check-row"><NumInput className="w-qty" value={c.travelMinutes || 0} onChange={(n) => setC({ ...c, travelMinutes: n || undefined })} /> min de trajet</label>
          </div>
        </Field>
      )}
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
              {(Object.keys(DISCOUNT_PARTS) as DiscountPart[]).filter((k) => k !== 'materiel').map((k) => (
                <label key={k} className="check-row">{DISCOUNT_PARTS[k]} <NumInput className="w-qty" value={c.partDiscounts?.[k] || 0}
                  onChange={(n) => { const pd = { ...(c.partDiscounts || {}) }; if (n) pd[k] = n; else delete pd[k]; setC({ ...c, partDiscounts: Object.keys(pd).length ? pd : undefined }); }} /></label>
              ))}
            </div>
          </Field>
          <Field label={`Assurance du matériel (%, défaut ${settings.insurancePct || 0} %)`}>
            <NumInput className="w-qty" value={c.insurancePct ?? 0} onChange={(n) => setC({ ...c, insurancePct: n || undefined })} />
          </Field>
        </>
      )}
      {c.type !== 'lieu' && <PeopleEditor c={c} setC={setC} />}
      <Field label="Langue des documents">
        <select value={c.language || 'fr'} onChange={(e) => setC({ ...c, language: e.target.value === 'fr' ? undefined : e.target.value as Lang })}>
          {Object.entries(LANG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      {c.type === 'client' && (
        <>
          <Field label={`Délai de paiement (jours, défaut ${settings.paymentDays})`}>
            <input type="number" min={0} value={c.paymentDays ?? ''} placeholder={String(settings.paymentDays)} onChange={(e) => setC({ ...c, paymentDays: e.target.value === '' ? undefined : parseInt(e.target.value) || 0 })} />
          </Field>
          <Field label="Moments de facturation par défaut">
            <select multiple size={Math.min(3, settingsMoments(settings).length)} style={{ height: 'auto' }} value={c.moments || []} title="Ctrl + clic pour en choisir plusieurs (3 au plus)"
              onChange={(e) => { const moments = [...e.target.selectedOptions].map((o) => o.value).slice(0, 3); setC({ ...c, moments: moments.length ? moments : undefined }); }}>
              {settingsMoments(settings).map((m) => <option key={m.id} value={m.id}>{m.name} ({m.percent} %)</option>)}
            </select>
          </Field>
        </>
      )}
      <Field label="Étiquettes"><TagInput value={c.tags} onChange={(tags) => setC({ ...c, tags })} /></Field>
      <CustomFieldsEditor entity="contact" value={c.custom} onChange={(custom) => setC({ ...c, custom })} />
      <Field label="Dossier"><input value={c.folder || ''} list="contact-folders" onChange={(e) => set('folder', e.target.value)} placeholder="Clients réguliers, Fournisseurs son…" /></Field>
      <datalist id="contact-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
      <Field label="Notes" full><textarea value={c.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
      <Field label="Avertissement (affiché en évidence quand on choisit ce contact)" full>
        <textarea value={c.warning || ''} onChange={(e) => set('warning', e.target.value)} placeholder="Ex. : paie toujours en retard, exiger un acompte" />
      </Field>
      {c.type === 'client' && (
        <Field label="Note ajoutée à chaque nouveau projet de ce client" full>
          <textarea value={c.autoProjectNote || ''} onChange={(e) => set('autoProjectNote', e.target.value)} placeholder="Ex. : badge d'accès à demander 10 jours avant, livraison par le quai B" />
        </Field>
      )}
      {c.id && <div className="field full"><MailHistory contactId={c.id} email={c.email} /></div>}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={() => onDone()}>Annuler</button>
        <button type="submit">Enregistrer</button>
      </div>
    </form>
  );
}

export default function Contacts() {
  const nav = useNavigate();
  const contacts = useLiveQuery(() => db.contacts.orderBy('company').toArray(), []) || [];
  const [q, setQ] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('q') || '');
  const [type, setType] = useState('');
  const [edit, setEdit] = useState<Draft | null>(null);
  const [tag, setTag] = useState('');
  const [folder, setFolder] = useState('');
  const allTags = Array.from(new Set(contacts.flatMap((c) => c.tags || []))).sort();
  const allFolders = Array.from(new Set(contacts.map((c) => c.folder).filter((f): f is string => !!f))).sort();
  const filtered = contacts.filter((c) =>
    (!type || c.type === type) &&
    (!folder || c.folder === folder) &&
    (!tag || c.tags?.includes(tag)) &&
    [c.company, c.firstName, c.lastName, c.email, c.city, ...(c.tags || []), ...(c.persons || []).flatMap((p) => [p.name, p.email, p.phone]), ...(c.departments || []).map((d) => d.name)]
      .join(' ').toLowerCase().includes(q.toLowerCase()));
  // personne trouvée par la recherche : on l'indique sous la société
  const matchOf = (c: Contact) => {
    if (!q.trim() || c.company.toLowerCase().includes(q.toLowerCase())) return '';
    const p = (c.persons || []).find((x) => [x.name, x.email, x.phone].join(' ').toLowerCase().includes(q.toLowerCase()));
    if (p) return `→ ${p.name}${deptOf(c, p.departmentId) ? ` (${deptOf(c, p.departmentId)!.name})` : ''}`;
    const d = (c.departments || []).find((x) => x.name.toLowerCase().includes(q.toLowerCase()));
    return d ? `→ service ${d.name}` : '';
  };
  const sel = useSelection(filtered.map((c) => c.id));
  const csv = (list = filtered) => exportCsv('contacts.csv', ['Société / nom', 'Type', 'Prénom', 'Nom', 'Email', 'Téléphone', 'Adresse', 'CP', 'Ville', 'Pays', 'N° TVA', 'Peppol', 'Étiquettes'],
    list.map((c) => [c.company, CONTACT_TYPES[c.type], c.firstName, c.lastName, c.email, c.phone, c.address, c.postalCode, c.city, c.country, c.vatNumber, c.peppolId, (c.tags || []).join(', ')]));

  return (
    <>
      <PageHead title="Contacts">
        <CsvButton onClick={() => csv()} />
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
          {allFolders.length > 0 && (
            <select value={folder} onChange={(e) => setFolder(e.target.value)} aria-label="Dossier">
              <option value="">Tous les dossiers</option>
              {allFolders.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
        </div>
        <BulkBar sel={sel} noun="contact(s)">
          <BulkSet label="Ranger dans le dossier" options={[...allFolders.map((f) => [f, f] as [string, string]), ['__new', 'Nouveau dossier…'], ['__none', 'Sans dossier']]} onApply={async (f) => {
            const name = f === '__new' ? prompt('Nom du dossier :')?.trim() : f === '__none' ? '' : f;
            if (name === undefined || name === null) return;
            for (const id of sel.ids) await db.contacts.update(id, { folder: name || undefined, updatedAt: new Date().toISOString() });
          }} />
          <BulkSet label="Changer le type" options={Object.entries(CONTACT_TYPES)} onApply={async (t) => {
            for (const id of sel.ids) await db.contacts.update(id, { type: t as ContactType, updatedAt: new Date().toISOString() });
          }} />
          <button className="secondary small" onClick={() => csv(filtered.filter((c) => sel.has(c.id)))}>Exporter (CSV)</button>
          <button className="danger small" onClick={() => deleteContacts(sel.ids).then((n) => n && sel.clear())}>Supprimer</button>
        </BulkBar>
        {filtered.length === 0 ? <Empty>Aucun contact.</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><SelectAllTh sel={sel} /><th>Nom</th><th>Type</th><th>Contact</th><th>Email</th><th>Téléphone</th><th>Ville</th></tr></thead>
              <tbody>
                {filtered.map((c) => (
                  <tr key={c.id} className="click" onClick={() => (c.type === 'lieu' ? nav('/lieux/' + c.id) : setEdit(c))}>
                    <SelectTd sel={sel} id={c.id} label={c.company} />
                    <td><strong>{c.company}</strong> <Tags tags={c.tags} />{matchOf(c) && <div className="muted" style={{ fontSize: 12 }}>{matchOf(c)}</div>}</td>
                    <td><span className="badge">{CONTACT_TYPES[c.type]}</span></td>
                    <td>{[c.firstName, c.lastName].filter(Boolean).join(' ')}{c.persons?.length ? <span className="muted"> +{c.persons.length} interlocuteur(s)</span> : null}{c.departments?.length ? <span className="muted"> · {c.departments.length} service(s)</span> : null}</td>
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
        <Modal title={edit.id ? 'Modifier le contact' : 'Nouveau contact'} onClose={() => setEdit(null)} wide>
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

/**
 * Services et interlocuteurs d'une société : chaque service a ses coordonnées (qui remplacent celles
 * de la société sur les documents) et ses personnes ; une personne peut changer de service.
 */
export const DEFAULT_SALUTATIONS = ['Madame', 'Monsieur', 'Madame, Monsieur', 'Cher client'];

function PeopleEditor({ c, setC }: { c: Draft; setC: (c: Draft) => void }) {
  const settings = useSettings();
  const salutations = settings.salutations?.length ? settings.salutations : DEFAULT_SALUTATIONS;
  const persons = c.persons || [];
  const depts = c.departments || [];
  const setPersons = (ps: ContactPerson[]) => setC({ ...c, persons: ps });
  const updP = (i: number, k: keyof ContactPerson, v: string) => setPersons(persons.map((y, j) => (j === i ? { ...y, [k]: v || undefined } : y)));
  const updD = (id: string, k: keyof Department, v: string) => setC({ ...c, departments: depts.map((d) => (d.id === id ? { ...d, [k]: v || undefined } : d)) });
  const row = (x: ContactPerson, i: number) => (
    <div key={x.id || i} className="person-row" style={{ display: 'grid', gridTemplateColumns: 'auto 1.2fr 1fr 1.2fr 1fr auto auto', gap: 6, marginBottom: 6 }}>
      <select title="Formule d'appel" aria-label="Formule d'appel" value={x.title || ''} onChange={(e) => updP(i, 'title', e.target.value)} style={{ width: 'auto' }}>
        <option value="">Formule</option>
        {salutations.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      <input placeholder="Nom" value={x.name} onChange={(e) => updP(i, 'name', e.target.value)} />
      <input placeholder="Fonction" value={x.role || ''} onChange={(e) => updP(i, 'role', e.target.value)} />
      <input placeholder="Email" value={x.email || ''} onChange={(e) => updP(i, 'email', e.target.value)} />
      <input placeholder="Téléphone" value={x.phone || ''} onChange={(e) => updP(i, 'phone', e.target.value)} />
      {depts.length > 0 ? (
        <select title="Service" value={x.departmentId || ''} onChange={(e) => updP(i, 'departmentId', e.target.value)} style={{ width: 'auto' }}>
          <option value="">Sans service</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.name || 'Service'}</option>)}
        </select>
      ) : <span />}
      <button type="button" className="ghost" onClick={() => setPersons(persons.filter((_, j) => j !== i))} aria-label="Retirer l'interlocuteur"><Icon name="x" /></button>
    </div>
  );
  const addPerson = (departmentId?: string) => setPersons([...persons, { id: uid(), name: '', departmentId }]);
  const loose = persons.map((x, i) => [x, i] as const).filter(([x]) => !x.departmentId || !depts.some((d) => d.id === x.departmentId));
  return (
    <div className="field full people-editor">
      <span>Services et interlocuteurs</span>
      <p className="muted" style={{ margin: '0 0 6px' }}>
        Plusieurs services d'une même société peuvent te contacter : crée un service (Communication, RH…), puis ses personnes.
        Sur un projet, tu choisiras directement la personne ou le service.
      </p>
      {loose.map(([x, i]) => row(x, i))}
      {depts.map((d) => (
        <div key={d.id} className="dept-box" style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 8, margin: '8px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 1fr auto', gap: 6, marginBottom: 6 }}>
            <input placeholder="Nom du service" value={d.name} onChange={(e) => updD(d.id, 'name', e.target.value)} style={{ fontWeight: 600 }} />
            <input placeholder="Email du service (factures…)" value={d.email || ''} onChange={(e) => updD(d.id, 'email', e.target.value)} />
            <input placeholder="Téléphone" value={d.phone || ''} onChange={(e) => updD(d.id, 'phone', e.target.value)} />
            <button type="button" className="ghost" aria-label="Supprimer le service" title="Supprimer le service (ses personnes restent, sans service)"
              onClick={() => setC({ ...c, departments: depts.filter((x) => x.id !== d.id), persons: persons.map((x) => (x.departmentId === d.id ? { ...x, departmentId: undefined } : x)) })}><Icon name="x" /></button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 6, marginBottom: 6 }}>
            <input placeholder="Adresse du service (si différente de la société)" value={d.address || ''} onChange={(e) => updD(d.id, 'address', e.target.value)} />
            <input placeholder="Code postal" value={d.postalCode || ''} onChange={(e) => updD(d.id, 'postalCode', e.target.value)} />
            <input placeholder="Ville" value={d.city || ''} onChange={(e) => updD(d.id, 'city', e.target.value)} />
          </div>
          {persons.map((x, i) => [x, i] as const).filter(([x]) => x.departmentId === d.id).map(([x, i]) => row(x, i))}
          <button type="button" className="secondary small" onClick={() => addPerson(d.id)}>+ Personne dans {d.name || 'ce service'}</button>
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button" className="secondary small" onClick={() => addPerson()}>+ Interlocuteur</button>
        <button type="button" className="secondary small" onClick={() => setC({ ...c, departments: [...depts, { id: uid(), name: '' }] })}>+ Service</button>
      </div>
      {(depts.length > 0 || persons.length > 0) && (
        <div className="billing-to" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', marginTop: 10 }}>
          <strong style={{ fontSize: 13 }}>Factures adressées à</strong>
          {depts.length > 0 && (
            <select aria-label="Service de facturation" title="Les factures, acomptes, avoirs et rappels sont adressés à ce service (adresse et email), quel que soit le service du projet"
              value={c.billingDepartmentId || ''} onChange={(e) => setC({ ...c, billingDepartmentId: e.target.value || undefined, billingPersonId: undefined })} style={{ width: 'auto' }}>
              <option value="">Le service du projet</option>
              {depts.map((d) => <option key={d.id} value={d.id}>{d.name || 'Service'}</option>)}
            </select>
          )}
          <select aria-label="Contact de facturation" title="Imprimé « À l'attention de » sur les factures ; son email est proposé en premier à l'envoi"
            value={c.billingPersonId || ''} onChange={(e) => setC({ ...c, billingPersonId: e.target.value || undefined })} style={{ width: 'auto' }}>
            <option value="">L'interlocuteur du projet</option>
            {persons.filter((x) => x.id && x.name && (!c.billingDepartmentId || x.departmentId === c.billingDepartmentId)).map((x) => <option key={x.id} value={x.id}>{x.name}{x.role ? ` (${x.role})` : ''}</option>)}
          </select>
        </div>
      )}
    </div>
  );
}

/**
 * Suppression de plusieurs contacts (clients, fournisseurs, lieux) : ceux qui servent encore
 * (client ou lieu d'un projet, fournisseur d'une sous-location, société d'un technicien) sont gardés.
 * Renvoie le nombre de contacts supprimés.
 */
export async function deleteContacts(ids: string[]): Promise<number> {
  const set = new Set(ids);
  const [projects, subrentals, people, costs] = await Promise.all([db.projects.toArray(), db.subrentals.toArray(), db.people.toArray(), db.costs.toArray()]);
  const used = new Set([
    ...projects.flatMap((p) => [p.clientId, p.venueId]), ...subrentals.map((s) => s.supplierId), ...people.map((p) => p.contactId), ...costs.map((c) => c.supplierId),
  ].filter((x): x is string => !!x && set.has(x)));
  const ok = ids.filter((id) => !used.has(id));
  if (!ok.length) { alert(`Les ${ids.length} contact(s) sélectionnés servent encore (projets, sous-locations, équipe) : rien n'est supprimé.`); return 0; }
  if (!confirm(`Supprimer ${ok.length} contact(s) ?` + (used.size ? `\n${used.size} contact(s) encore utilisés dans des projets, sous-locations ou l'équipe sont gardés.` : ''))) return 0;
  await db.contacts.bulkDelete(ok);
  return ok.length;
}
