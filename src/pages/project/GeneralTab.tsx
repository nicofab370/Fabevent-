import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Field, Modal } from '../../components/ui';
import { DEFAULT_PROJECT_TYPES, db } from '../../db';
import { createDocument } from '../../documents';
import type { DocType, Project, ProjectStatus, Task, VatRegime } from '../../types';
import { LANG_LABELS, STATUS_LABELS, VAT_REGIME_LABELS, type Lang } from '../../types';
import { CustomFieldsEditor, TagInput } from '../../components/extra';
import { blockPeriod, fmtDate, fmtRange, patch, save, sortPeriods, uid, usageDays } from '../../utils';
import { ContactForm } from '../Contacts';
import { setProjectStatus } from './status';
import { setProjectDistance, type ProjectData } from './shared';
import { drivingRoute } from '../../geo';
import { NumInput } from '../../components/ui';
import { money } from '../../utils';

/** Champ texte enregistré à la sortie du champ (pas à chaque frappe). */
function LazyInput({ value, onSave, ...rest }: { value?: string; onSave: (v: string) => void; placeholder?: string; type?: string; required?: boolean }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value || '') && onSave(v)} {...rest} />;
}

export default function GeneralTab({ d, goTab }: { d: ProjectData; goTab: (t: string) => void }) {
  const nav = useNavigate();
  const { project, client, contacts, settings, subs, docs, conflicts, projectCrew, projectVas, lines } = d;
  const [newContact, setNewContact] = useState<'client' | 'lieu' | null>(null);
  const upd = (changes: Partial<Project>) => patch(db.projects, project.id, changes);
  const types = settings.projectTypes?.length ? settings.projectTypes : DEFAULT_PROJECT_TYPES;
  const venue = contacts.find((c) => c.id === project.venueId);
  const venueAddress = venue ? [venue.address, venue.postalCode, venue.city].filter(Boolean).join(', ') : project.venue || '';
  const depots = settings.depots || [];
  const depot = depots.find((x) => x.id === (project.depotId || depots[0]?.id));
  const origin = (depot?.street || depot?.city ? [depot.street, depot.postalCode, depot.city].filter(Boolean).join(', ') : '')
    || [settings.company.street, settings.company.postalCode, settings.company.city].filter(Boolean).join(', ') || settings.company.address?.replace(/\n/g, ', ') || '';
  const route = venueAddress ? `https://www.google.com/maps/dir/?api=1${origin ? `&origin=${encodeURIComponent(origin)}` : ''}&destination=${encodeURIComponent(venueAddress)}` : '';

  // Avancée du projet
  const quote = docs.find((x) => x.type === 'devis');
  const accepted = docs.some((x) => x.type === 'devis' && x.status === 'accepte');
  const invoice = docs.find((x) => x.type === 'facture');
  const eqLines = lines.filter((l) => l.equipmentId && !l.optional);
  const steps: { label: string; state: 'done' | 'warn' | 'todo' }[] = [
    { label: 'Devis créé', state: quote ? 'done' : 'todo' },
    { label: 'Devis accepté', state: accepted || ['confirme', 'en_cours', 'termine'].includes(project.status) ? 'done' : 'todo' },
    { label: conflicts.length ? `Matériel : ${conflicts.length} manque(s)` : 'Matériel disponible', state: !eqLines.length ? 'todo' : conflicts.length ? 'warn' : 'done' },
    { label: projectCrew.some((c) => !c.personId) ? `Équipe : ${projectCrew.filter((c) => !c.personId).length} poste(s) à pourvoir` : 'Équipe complète', state: !projectCrew.length ? 'todo' : projectCrew.some((c) => !c.personId) ? 'warn' : 'done' },
    { label: 'Transport planifié', state: projectVas.length ? 'done' : 'todo' },
    { label: 'Matériel sorti', state: eqLines.length && eqLines.every((l) => (l.outQty || 0) >= l.qty) ? 'done' : eqLines.some((l) => l.outQty) ? 'warn' : 'todo' },
    { label: 'Matériel retourné', state: eqLines.length && eqLines.every((l) => (l.inQty || 0) >= (l.outQty || l.qty)) ? 'done' : eqLines.some((l) => l.inQty) ? 'warn' : 'todo' },
    { label: 'Facturé', state: invoice ? 'done' : 'todo' },
    { label: 'Payé', state: invoice?.status === 'paye' ? 'done' : 'todo' },
  ];

  /** Changement de client : propose d'appliquer ses remises par défaut. */
  const changeClient = async (clientId?: string) => {
    const c = contacts.find((x) => x.id === clientId);
    await upd({ clientId, contactPerson: undefined });
    const eqDisc = c?.discounts?.equipment, totDisc = c?.discounts?.total;
    if (c && (eqDisc || totDisc) && confirm(`Appliquer les remises de ${c.company} (matériel ${eqDisc || 0} %, total ${totDisc || 0} %) à ce projet ?`)) {
      const fresh = await db.projects.get(project.id);
      if (fresh) await patch(db.projects, fresh.id, { discount: totDisc || 0 });
      if (eqDisc) for (const l of lines.filter((x) => x.equipmentId)) await save(db.lines, { ...l, discount: eqDisc });
    }
  };

  const generate = async (type: DocType) => nav('/documents/' + (await createDocument(project.id, type)).id);

  return (
    <>
      <div className="grid">
        <div className="card">
          <h2>Projet</h2>
          <div className="form">
            <Field label="Nom" full><LazyInput value={project.name} onSave={(v) => v.trim() && upd({ name: v.trim() })} /></Field>
            <Field label="Type de projet">
              <select value={project.typeName || ''} onChange={(e) => {
                const t = types.find((x) => x.name === e.target.value);
                upd({ typeName: e.target.value || undefined, color: project.color || t?.color });
              }}>
                <option value="">—</option>
                {types.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Statut">
              <select value={project.status} onChange={(e) => setProjectStatus(d, e.target.value as ProjectStatus)}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Numéro"><LazyInput value={project.number} onSave={(v) => v.trim() && upd({ number: v.trim() })} /></Field>
            <Field label="Couleur"><input type="color" value={project.color || '#2563eb'} onChange={(e) => upd({ color: e.target.value })} style={{ height: 36, padding: 2 }} /></Field>
            {depots.length > 1 && (
              <Field label="Dépôt (emplacement de stock)" full>
                <select value={project.depotId || depots[0].id} onChange={(e) => upd({ depotId: e.target.value })}>
                  {depots.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Référence externe (n° de commande client)" full><LazyInput value={project.externalRef} onSave={(v) => upd({ externalRef: v || undefined })} /></Field>
            <Field label="Langue des documents">
              <select value={project.language || ''} onChange={(e) => upd({ language: (e.target.value || undefined) as Lang | undefined })}>
                <option value="">Selon le client ({LANG_LABELS[client?.language || 'fr']})</option>
                {Object.entries(LANG_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label="Étiquettes"><TagInput value={project.tags} onChange={(tags) => upd({ tags })} /></Field>
            <CustomFieldsEditor entity="projet" value={project.custom} onChange={(custom) => upd({ custom })} />
          </div>
        </div>

        <div className="card">
          <h2>Client</h2>
          <div className="form">
            <Field label="Client" full>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={project.clientId || ''} onChange={(e) => changeClient(e.target.value || undefined)}>
                  <option value="">—</option>
                  {contacts.filter((c) => c.type === 'client' || c.id === project.clientId).map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
                </select>
                <button type="button" className="secondary small" onClick={() => setNewContact('client')}>+</button>
              </div>
            </Field>
            <Field label="Régime de TVA" full>
              <select value={project.vatRegime || ''} onChange={(e) => upd({ vatRegime: (e.target.value || undefined) as VatRegime | undefined })}>
                <option value="">Selon le client ({VAT_REGIME_LABELS[client?.vatRegime || 'normal']})</option>
                {Object.entries(VAT_REGIME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {client?.persons?.length ? (
              <Field label="Personne de contact" full>
                <select value={project.contactPerson || ''} onChange={(e) => upd({ contactPerson: e.target.value || undefined })}>
                  <option value="">—</option>
                  {client.persons.map((x, i) => <option key={i} value={x.name}>{x.name}{x.role ? ` (${x.role})` : ''}</option>)}
                </select>
              </Field>
            ) : null}
          </div>
          {client && (
            <dl className="kv" style={{ marginTop: 10 }}>
              {(client.address || client.city) && <><dt>Adresse</dt><dd>{[client.address, client.postalCode, client.city].filter(Boolean).join(', ')}</dd></>}
              {client.email && <><dt>Email</dt><dd><a href={`mailto:${client.email}`}>{client.email}</a></dd></>}
              {client.phone && <><dt>Téléphone</dt><dd><a href={`tel:${client.phone}`}>{client.phone}</a></dd></>}
              {(() => { const p = client.persons?.find((x) => x.name === project.contactPerson); return p && (p.email || p.phone) ? <><dt>{p.name}</dt><dd>{[p.phone, p.email].filter(Boolean).join(' · ')}</dd></> : null; })()}
              {client.vatNumber && <><dt>TVA</dt><dd>{client.vatNumber}</dd></>}
            </dl>
          )}
        </div>

        <div className="card">
          <h2>Lieu de la prestation</h2>
          <div className="form">
            <Field label="Lieu enregistré" full>
              <div style={{ display: 'flex', gap: 6 }}>
                <select value={project.venueId || ''} onChange={(e) => {
                  const v = contacts.find((c) => c.id === e.target.value);
                  upd({ venueId: e.target.value || undefined, venue: v ? v.company : project.venue });
                }}>
                  <option value="">—</option>
                  {contacts.filter((c) => c.type === 'lieu').map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
                </select>
                <button type="button" className="secondary small" onClick={() => setNewContact('lieu')}>+</button>
              </div>
            </Field>
            <Field label="Nom affiché sur les documents" full><LazyInput value={project.venue} onSave={(v) => upd({ venue: v || undefined })} /></Field>
          </div>
          {venueAddress && <p>{venueAddress}<br /><a href={route} target="_blank" rel="noreferrer">Voir l'itinéraire ↗</a></p>}
          <Distance d={d} from={origin} to={venueAddress} />
        </div>

        <div className="card">
          <h2>Avancée du projet</h2>
          <div className="progress-steps">
            {steps.map((s) => <span key={s.label} className={'step ' + s.state}>{s.state === 'done' ? '✓' : s.state === 'warn' ? '!' : '○'} {s.label}</span>)}
          </div>
          <h3 style={{ margin: '14px 0 6px' }}>Bons de livraison et feuilles d'appel</h3>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button className="secondary small" onClick={() => generate('bon_sortie')}>Bon de sortie / livraison</button>
            <button className="secondary small" onClick={() => generate('feuille_route')}>Feuille de route / d'appel</button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Planning</h2>
          <button className="secondary small" onClick={() => goTab('planning')}>Gérer le planning</button>
        </div>
        {subs.length === 0 ? <Empty>Aucune salle.</Empty> : (
          <table className="list">
            <tbody>
              {subs.map((sp) => {
                const [b0, b1] = blockPeriod(sp);
                return (
                  <tr key={sp.id}>
                    <td style={{ width: 180 }}><strong>{sp.name}</strong><div className="muted">{usageDays(sp)} j facturé(s)</div></td>
                    <td>
                      {sp.periods?.length ? (
                        <div className="periods" style={{ marginTop: 0 }}>
                          {sortPeriods(sp.periods).map((pe) => <span key={pe.id} className={'period k-' + pe.kind}><strong>{pe.name}</strong> {fmtRange(pe.start, pe.end)}</span>)}
                        </div>
                      ) : <span>Utilisation {fmtRange(sp.start, sp.end)}{(b0 !== sp.start || b1 !== sp.end) && <span className="muted"> · bloqué {fmtRange(b0, b1)}</span>}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="grid">
        <Tasks project={project} />
        <div className="card">
          <h2>Notes</h2>
          <Notes project={project} />
          <p className="muted" style={{ marginBottom: 0 }}>Visibles sur la feuille de route et le bon de sortie.</p>
        </div>
        <Files projectId={project.id} />
      </div>

      {newContact && (
        <Modal title={newContact === 'client' ? 'Nouveau client' : 'Nouveau lieu'} onClose={() => setNewContact(null)}>
          <ContactForm initial={{ type: newContact, company: '' }} onDone={(c) => {
            setNewContact(null);
            if (c) upd(newContact === 'client' ? { clientId: c.id, contactPerson: undefined } : { venueId: c.id, venue: c.company });
          }} />
        </Modal>
      )}
    </>
  );
}

function Notes({ project }: { project: Project }) {
  const [v, setV] = useState(project.notes || '');
  useEffect(() => setV(project.notes || ''), [project.notes]);
  return <textarea style={{ minHeight: 140 }} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== (project.notes || '') && patch(db.projects, project.id, { notes: v || undefined })} placeholder="Accès, contraintes du lieu, contacts sur place…" />;
}

function Tasks({ project }: { project: Project }) {
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const tasks = project.tasks || [];
  const setTasks = (t: Task[]) => patch(db.projects, project.id, { tasks: t });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="card">
      <h2>Tâches ({tasks.filter((t) => !t.done).length} à faire)</h2>
      {tasks.length === 0 && <p className="muted">Aucune tâche.</p>}
      {[...tasks].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '9').localeCompare(b.due || '9')).map((t) => (
        <div key={t.id} className={'task' + (t.done ? ' done' : '')}>
          <input type="checkbox" checked={t.done} onChange={(e) => setTasks(tasks.map((x) => (x.id === t.id ? { ...x, done: e.target.checked } : x)))} />
          <span style={{ flex: 1 }}>{t.text}</span>
          {t.due && <span className={!t.done && t.due < today ? 'avail ko' : 'muted'} style={{ fontSize: 12 }}>{fmtDate(t.due, false)}</span>}
          <button className="ghost" onClick={() => setTasks(tasks.filter((x) => x.id !== t.id))} aria-label="Supprimer">✕</button>
        </div>
      ))}
      <form className="toolbar" style={{ marginTop: 8, marginBottom: 0 }} onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        setTasks([...tasks, { id: uid(), text: text.trim(), done: false, due: due || undefined }]);
        setText(''); setDue('');
      }}>
        <input placeholder="Nouvelle tâche (ex. Envoyer plan de feu)" value={text} onChange={(e) => setText(e.target.value)} />
        <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={{ width: 150 }} />
        <button className="small" type="submit">+</button>
      </form>
    </div>
  );
}

function Files({ projectId }: { projectId: string }) {
  const files = useLiveQuery(() => db.files.where({ projectId }).toArray(), [projectId]) || [];
  const open = (f: { blob: Blob; name: string }) => {
    const url = URL.createObjectURL(f.blob);
    const a = document.createElement('a');
    a.href = url; a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  return (
    <div className="card">
      <h2>Fichiers ({files.length})</h2>
      {files.map((f) => (
        <div key={f.id} className="task">
          <a href="#" onClick={(e) => { e.preventDefault(); open(f); }} style={{ flex: 1 }}>{f.name}</a>
          <span className="muted" style={{ fontSize: 12 }}>{Math.max(1, Math.round(f.size / 1024))} Ko</span>
          <button className="ghost" onClick={() => confirm(`Supprimer ${f.name} ?`) && db.files.delete(f.id)} aria-label="Supprimer">✕</button>
        </div>
      ))}
      <label className="btn secondary" style={{ background: 'var(--soft)', color: 'var(--text)', border: '1px solid var(--border)', marginTop: 8 }}>
        + Joindre des fichiers (plans, fiches techniques, photos…)
        <input type="file" multiple hidden onChange={async (e) => {
          for (const file of Array.from(e.target.files || [])) {
            if (file.size > 25 * 1024 * 1024) { alert(`${file.name} dépasse 25 Mo.`); continue; }
            await db.files.put({ id: uid(), projectId, name: file.name, type: file.type, size: file.size, blob: file, createdAt: new Date().toISOString() });
          }
          e.target.value = '';
        }} />
      </label>
      <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>Stockés sur cet appareil avec le projet.</p>
    </div>
  );
}

/** Distance dépôt → lieu : calcul automatique (OpenStreetMap) ou saisie manuelle ; elle chiffre le transport. */
function Distance({ d, from, to }: { d: ProjectData; from: string; to: string }) {
  const { project, settings } = d;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const transport = d.projectVas.reduce((a, v) => a + (v.billable ? v.price : 0), 0);
  const compute = async () => {
    if (!from) return setMsg('Renseigne l\'adresse de ton dépôt dans Paramètres → Ma société.');
    if (!to) return setMsg('Choisis un lieu avec une adresse, ou saisis le nom du lieu.');
    setBusy(true); setMsg('');
    try {
      const r = await drivingRoute(from, to);
      await setProjectDistance(d, r.km, r.minutes);
      setMsg(r.estimated ? 'Itinéraire indisponible : estimation à vol d\'oiseau × 1,3, à vérifier.' : '');
    } catch (e) {
      setMsg('Calcul impossible : ' + (e as Error).message);
    } finally { setBusy(false); }
  };
  const h = project.travelMinutes ? `${Math.floor(project.travelMinutes / 60)} h ${String(project.travelMinutes % 60).padStart(2, '0')}` : '';
  return (
    <div className="distance">
      <div className="toolbar" style={{ alignItems: 'center', marginBottom: 4 }}>
        <span>Distance depuis le dépôt</span>
        <NumInput className="w-qty" value={project.distanceKm || 0} min={0} onChange={(n) => setProjectDistance(d, n || undefined, undefined)} />
        <span>km{h && ` · ~${h} de route`}</span>
        <button type="button" className="secondary small" disabled={busy} onClick={compute}>{busy ? 'Calcul…' : 'Calculer'}</button>
      </div>
      {msg && <p className="avail ko" style={{ margin: '4px 0' }}>{msg}</p>}
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Transport facturé : {money(transport)} HT — forfait du véhicule + km × {money(settings.pricePerKm ?? 0)}/km,
        sur {settings.defaultTrips ?? 2} aller(s)-retour(s) par défaut (réglable par véhicule dans « Équipe & transport »).
      </p>
    </div>
  );
}
