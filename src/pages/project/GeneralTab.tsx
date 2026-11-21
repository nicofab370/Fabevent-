import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Field, Modal } from '../../components/ui';
import { DEFAULT_PROJECT_TYPES, db } from '../../db';
import { createDocument } from '../../documents';
import type { Contact, DocType, Project, ProjectNote, ProjectStatus, Task, VatRegime } from '../../types';
import { CONFIRMED, LANG_LABELS, STATUS_LABELS, VENUE_INFO_LABELS, type VenueInfo, VAT_REGIME_LABELS, type Lang } from '../../types';
import { CustomFieldsEditor, TagInput } from '../../components/extra';
import { blockPeriod, fmtDate, fmtRange, patch, save, sortPeriods, uid, usageDays } from '../../utils';
import { ContactForm } from '../Contacts';
import { VenueComments } from '../Venues';
import { ContactPicker } from '../../components/ContactPicker';
import { deptOf, ownAddress, placeAddress, placeName, projectPerson, spotOf } from '../../places';
import { setProjectStatus } from './status';
import { setProjectDistance, type ProjectData } from './shared';
import { drivingRoute } from '../../geo';
import { NumInput } from '../../components/ui';
import { money } from '../../utils';
import { Icon } from '../../components/Icon';

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
  /** modification rapide du client ou du lieu choisi, sans quitter le projet */
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const upd = (changes: Partial<Project>) => patch(db.projects, project.id, changes);
  const types = settings.projectTypes?.length ? settings.projectTypes : DEFAULT_PROJECT_TYPES;
  const venue = contacts.find((c) => c.id === project.venueId);
  const dept = deptOf(client, project.departmentId);
  const person = projectPerson(client, project);
  const spot = spotOf(venue, project.spotId);
  const venueAddress = venue ? placeAddress(venue, spot) : project.venue || '';
  const depots = settings.depots || [];
  const depot = depots.find((x) => x.id === (project.depotId || depots[0]?.id));
  const depotAddress = depot?.street || depot?.city ? [depot.street, depot.postalCode, depot.city].filter(Boolean).join(', ') : '';
  // distance calculée depuis le dépôt de base du projet ; à défaut, depuis l'adresse de la société
  const origin = depotAddress || [settings.company.street, settings.company.postalCode, settings.company.city].filter(Boolean).join(', ') || settings.company.address?.replace(/\n/g, ', ') || '';
  const originLabel = depotAddress ? `${depot!.name} — ${depotAddress}` : origin ? `adresse de la société (${origin}) : renseigne l'adresse du dépôt dans Paramètres` : '';
  const route = venueAddress ? `https://www.google.com/maps/dir/?api=1${origin ? `&origin=${encodeURIComponent(origin)}` : ''}&destination=${encodeURIComponent(venueAddress)}` : '';

  // Avancée du projet
  const quote = docs.find((x) => x.type === 'devis');
  const accepted = docs.some((x) => x.type === 'devis' && x.status === 'accepte');
  const invoice = docs.find((x) => x.type === 'facture');
  const eqLines = lines.filter((l) => l.equipmentId && !l.optional);
  const steps: { label: string; state: 'done' | 'warn' | 'todo' }[] = [
    { label: 'Devis créé', state: quote ? 'done' : 'todo' },
    { label: 'Devis accepté', state: accepted || CONFIRMED.includes(project.status) ? 'done' : 'todo' },
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
    await upd({ clientId, contactPerson: undefined, contactPersonId: undefined, departmentId: undefined });
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
                <button type="button" className="secondary small" title="Nouveau client" onClick={() => setNewContact('client')}>+</button>
                {client && <button type="button" className="secondary small" title="Modifier ce client" aria-label="Modifier le client" onClick={() => setEditContact(client)}><Icon name="edit" /></button>}
              </div>
            </Field>
            <Field label="Régime de TVA" full>
              <select value={project.vatRegime || ''} onChange={(e) => upd({ vatRegime: (e.target.value || undefined) as VatRegime | undefined })}>
                <option value="">Selon le client ({VAT_REGIME_LABELS[client?.vatRegime || 'normal']})</option>
                {Object.entries(VAT_REGIME_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {client && (
              <Field label="Service / interlocuteur" full>
                <ContactPicker client={client} value={project} onChange={(v) => upd(v)} />
              </Field>
            )}
          </div>
          {client && (
            <dl className="kv" style={{ marginTop: 10 }}>
              {(client.address || client.city) && <><dt>Adresse</dt><dd>{[client.address, client.postalCode, client.city].filter(Boolean).join(', ')}</dd></>}
              {client.email && <><dt>Email</dt><dd><a href={`mailto:${client.email}`}>{client.email}</a></dd></>}
              {client.phone && <><dt>Téléphone</dt><dd><a href={`tel:${client.phone}`}>{client.phone}</a></dd></>}
              {dept && <><dt>Service</dt><dd>{dept.name}{[dept.phone, dept.email].some(Boolean) && <span className="muted"> · {[dept.phone, dept.email].filter(Boolean).join(' · ')}</span>}
                {(dept.address || dept.city) && <div className="muted">{[dept.address, dept.postalCode, dept.city].filter(Boolean).join(', ')}</div>}</dd></>}
              {person && (person.email || person.phone) ? <><dt>{person.name}</dt><dd>{person.phone && <a href={`tel:${person.phone}`}>{person.phone}</a>}{person.phone && person.email && ' · '}{person.email && <a href={`mailto:${person.email}`}>{person.email}</a>}</dd></> : null}
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
                  upd({ venueId: e.target.value || undefined, spotId: undefined, venue: v ? v.company : project.venue });
                }}>
                  <option value="">—</option>
                  {contacts.filter((c) => c.type === 'lieu').map((c) => <option key={c.id} value={c.id}>{c.company}</option>)}
                </select>
                <button type="button" className="secondary small" title="Nouveau lieu" onClick={() => setNewContact('lieu')}>+</button>
                {venue && <button type="button" className="secondary small" title="Modifier ce lieu" aria-label="Modifier le lieu" onClick={() => setEditContact(venue)}><Icon name="edit" /></button>}
              </div>
            </Field>
            {venue && (
              <Field label="Endroit" full>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select aria-label="Endroit" value={project.spotId || ''} onChange={(e) => {
                    const sp = spotOf(venue, e.target.value);
                    upd({ spotId: sp?.id, venue: placeName(venue, sp) });
                  }}>
                    <option value="">{venue.spots?.length ? 'Tout le lieu / pas précisé' : 'Aucun endroit enregistré'}</option>
                    {(venue.spots || []).map((x) => <option key={x.id} value={x.id}>{x.name}{ownAddress(x) ? ` — ${placeAddress(venue, x)}` : ''}</option>)}
                  </select>
                  <button type="button" className="secondary small" title="Nouvel endroit dans ce lieu" onClick={async () => {
                    const name = prompt(`Nouvel endroit dans « ${venue.company} » (ex. Bâtiment B, Scène acoustique) :`)?.trim();
                    if (!name) return;
                    const address = prompt('Adresse de cet endroit (laisser vide si c\'est celle du lieu) :')?.trim() || undefined;
                    const sp = { id: uid(), name, address };
                    const fresh = await db.contacts.get(venue.id);
                    await patch(db.contacts, venue.id, { spots: [...(fresh?.spots || []), sp] });
                    await upd({ spotId: sp.id, venue: placeName(venue, sp) });
                  }}>+</button>
                </div>
              </Field>
            )}
            <Field label="Nom affiché sur les documents" full><LazyInput value={project.venue} onSave={(v) => upd({ venue: v || undefined })} /></Field>
          </div>
          {venueAddress && <p>{venueAddress}<br /><a href={route} target="_blank" rel="noreferrer">Voir l'itinéraire <Icon name="external" /></a></p>}
          <Distance d={d} from={origin} to={venueAddress} fromLabel={originLabel} />
          {venue && (
            <>
              {venue.venueInfo && Object.keys(venue.venueInfo).length > 0 && (
                <dl className="kv" style={{ marginTop: 10 }}>
                  {(Object.keys(VENUE_INFO_LABELS) as (keyof VenueInfo)[]).filter((k) => venue.venueInfo?.[k]).map((k) => (
                    <Fragment key={k}><dt>{VENUE_INFO_LABELS[k]}</dt><dd style={{ whiteSpace: 'pre-wrap' }}>{venue.venueInfo![k]}</dd></Fragment>
                  ))}
                </dl>
              )}
              <h3 style={{ marginBottom: 4 }}>Commentaires sur le lieu <Link to={'/lieux/' + venue.id} className="muted" style={{ fontSize: 12, fontWeight: 400 }}>fiche du lieu <Icon name="external" /></Link></h3>
              <VenueComments venue={venue} projects={[project]} projectId={project.id} />
            </>
          )}
        </div>

        <div className="card">
          <h2>Avancée du projet</h2>
          <div className="progress-steps">
            {steps.map((s) => <span key={s.label} className={'step ' + s.state}><Icon name={s.state === 'done' ? 'check' : s.state === 'warn' ? 'warning' : 'circle'} />{s.label}</span>)}
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
        {subs.length === 0 ? <Empty>Aucun sous-projet.</Empty> : (
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
          <NoteList project={project} />
        </div>
        <Files projectId={project.id} />
      </div>

      {editContact && (
        <Modal title={editContact.type === 'lieu' ? `Modifier le lieu — ${editContact.company}` : `Modifier — ${editContact.company}`} onClose={() => setEditContact(null)}>
          <ContactForm initial={editContact} onDone={(c) => {
            setEditContact(null);
            // le nom du lieu est aussi gardé sur le projet (documents)
            if (c && c.id === project.venueId && c.company !== project.venue) upd({ venue: c.company });
          }} />
          <p className="muted" style={{ marginBottom: 0 }}>Interlocuteurs, services{editContact.type === 'lieu' ? ', endroits et infos pratiques' : ''} : <Link to={editContact.type === 'lieu' ? '/lieux/' + editContact.id : '/contacts'}>{editContact.type === 'lieu' ? 'fiche complète du lieu' : 'Contacts'}</Link>.</p>
        </Modal>
      )}
      {newContact && (
        <Modal title={newContact === 'client' ? 'Nouveau client' : 'Nouveau lieu'} onClose={() => setNewContact(null)}>
          <ContactForm initial={{ type: newContact, company: '' }} onDone={(c) => {
            setNewContact(null);
            if (c) upd(newContact === 'client' ? { clientId: c.id, contactPerson: undefined, contactPersonId: undefined, departmentId: undefined } : { venueId: c.id, venue: c.company });
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

const NOTE_DOCS: [DocType, string][] = [['devis', 'Devis'], ['facture', 'Facture'], ['bon_sortie', 'Bon de sortie'], ['feuille_route', 'Feuille de route']];

/** Notes supplémentaires, chacune imprimée sur les documents choisis (ou interne si aucun). */
function NoteList({ project }: { project: Project }) {
  const list = project.noteList || [];
  const set = (noteList: ProjectNote[]) => patch(db.projects, project.id, { noteList: noteList.length ? noteList : undefined });
  return (
    <div style={{ marginTop: 12 }}>
      {list.map((n, i) => {
        const upd = (c: Partial<ProjectNote>) => set(list.map((x, j) => (j === i ? { ...x, ...c } : x)));
        return (
          <div key={n.id} className="note-item" style={{ borderTop: '1px solid var(--line)', paddingTop: 8, marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <LazyInput value={n.title} onSave={(title) => upd({ title })} placeholder="Titre (ex. Accès au site)" />
              <button className="ghost" onClick={() => set(list.filter((_, j) => j !== i))} aria-label="Supprimer la note"><Icon name="x" /></button>
            </div>
            <LazyText value={n.text} onSave={(text) => upd({ text })} />
            <div className="muted" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
              Imprimer sur :
              {NOTE_DOCS.map(([t, label]) => (
                <label key={t} className="check-row"><input type="checkbox" checked={n.on.includes(t)} onChange={(e) => upd({ on: e.target.checked ? [...n.on, t] : n.on.filter((x) => x !== t) })} /> {label}</label>
              ))}
              {!n.on.length && <em>note interne</em>}
            </div>
          </div>
        );
      })}
      <button className="secondary small" style={{ marginTop: 8 }} onClick={() => set([...list, { id: uid(), title: '', text: '', on: ['devis'] }])}>+ Note pour les documents</button>
    </div>
  );
}

function LazyText({ value, onSave }: { value?: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value || '');
  useEffect(() => setV(value || ''), [value]);
  return <textarea style={{ minHeight: 60, marginTop: 6 }} value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== (value || '') && onSave(v)} placeholder="Texte de la note" />;
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
          <button className="ghost" onClick={() => setTasks(tasks.filter((x) => x.id !== t.id))} aria-label="Supprimer"><Icon name="x" /></button>
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
          <button className="ghost" onClick={() => confirm(`Supprimer ${f.name} ?`) && db.files.delete(f.id)} aria-label="Supprimer"><Icon name="x" /></button>
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
function Distance({ d, from, to, fromLabel }: { d: ProjectData; from: string; to: string; fromLabel: string }) {
  const { project, settings } = d;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const transport = d.projectVas.reduce((a, v) => a + (v.billable ? v.price : 0), 0);
  const compute = async () => {
    if (!from) return setMsg('Renseigne l\'adresse de ton dépôt dans Paramètres → Dépôts.');
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
      <p className="muted" style={{ margin: '0 0 2px', fontSize: 12 }}>Départ : {fromLabel || <span className="avail ko">aucune adresse de dépôt (Paramètres → Dépôts)</span>}</p>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        Transport facturé : {money(transport)} HT — forfait du véhicule + km × {money(settings.pricePerKm ?? 0)}/km,
        sur {settings.defaultTrips ?? 2} aller(s)-retour(s) par défaut (réglable par véhicule dans « Équipe & transport »).
      </p>
    </div>
  );
}
