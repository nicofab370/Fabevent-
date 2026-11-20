import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, Field, Modal, PageHead, StatusBadge } from '../components/ui';
import { CsvButton, exportCsv } from '../components/extra';
import { db } from '../db';
import type { Contact, Project, VenueComment, VenueInfo } from '../types';
import { VENUE_INFO_LABELS } from '../types';
import { fmtDate, fmtRange, nowIso, patch, uid } from '../utils';
import { ContactForm } from './Contacts';

/** Projets tenus dans un lieu (lieu enregistré, ou même nom affiché). */
export function venueProjects(venue: Contact, projects: Project[]): Project[] {
  const name = venue.company.trim().toLowerCase();
  return projects
    .filter((p) => !p.isTemplate && (p.venueId === venue.id || (!p.venueId && p.venue?.trim().toLowerCase() === name)))
    .sort((a, b) => b.start.localeCompare(a.start));
}

export function venueAddress(v: Contact) {
  return [v.address, v.postalCode, v.city].filter(Boolean).join(', ');
}

/** Ajoute un commentaire au lieu (le plus récent en premier). */
export async function addVenueComment(venueId: string, c: Omit<VenueComment, 'id' | 'at'>) {
  const v = await db.contacts.get(venueId);
  if (!v) return;
  await patch(db.contacts, venueId, { comments: [{ id: uid(), at: nowIso(), ...c }, ...(v.comments || [])] });
}

/** Liste des lieux : recherche, nombre de projets, commentaires. */
export default function Venues() {
  const nav = useNavigate();
  const venues = useLiveQuery(() => db.contacts.where({ type: 'lieu' }).sortBy('company'), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const list = venues.filter((v) => [v.company, v.city, v.address, ...(v.comments || []).map((c) => c.text), ...Object.values(v.venueInfo || {})]
    .join(' ').toLowerCase().includes(q.toLowerCase()));
  const csv = () => exportCsv('lieux.csv', ['Lieu', 'Adresse', 'Code postal', 'Ville', 'Téléphone', ...Object.values(VENUE_INFO_LABELS), 'Projets', 'Commentaires'],
    list.map((v) => [v.company, v.address, v.postalCode, v.city, v.phone, ...(Object.keys(VENUE_INFO_LABELS) as (keyof VenueInfo)[]).map((k) => v.venueInfo?.[k]),
      venueProjects(v, projects).length, (v.comments || []).map((c) => `${fmtDate(c.at)} : ${c.text}`).join(' | ')]));

  return (
    <>
      <PageHead title="Lieux">
        <CsvButton onClick={csv} />
        <button onClick={() => setCreating(true)}>+ Nouveau lieu</button>
      </PageHead>
      <div className="info">
        Salles, hôtels, parcs… avec leurs infos pratiques (accès, électricité, contact sur place) et les commentaires laissés au fil des projets.
        La recherche porte aussi sur les commentaires (ex. « 63 A », « quai »).
      </div>
      <div className="card">
        <div className="toolbar"><input placeholder="Rechercher un lieu, une ville, un commentaire…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        {list.length === 0 ? <Empty>Aucun lieu.</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Lieu</th><th>Ville</th><th className="n">Projets</th><th>Dernier projet</th><th>Dernier commentaire</th></tr></thead>
              <tbody>
                {list.map((v) => {
                  const ps = venueProjects(v, projects);
                  const last = v.comments?.[0];
                  const alerts = (v.comments || []).filter((c) => c.important).length;
                  return (
                    <tr key={v.id} className="click" onClick={() => nav('/lieux/' + v.id)}>
                      <td><strong>{v.company}</strong>{alerts > 0 && <span className="badge st-annule" style={{ marginLeft: 6 }}>⚠ {alerts}</span>}</td>
                      <td>{v.city}</td>
                      <td className="n">{ps.length}</td>
                      <td>{ps[0] ? `${ps[0].name} · ${fmtDate(ps[0].start)}` : <span className="muted">—</span>}</td>
                      <td className="muted">{last ? `${fmtDate(last.at)} — ${last.text.length > 70 ? last.text.slice(0, 70) + '…' : last.text}` : '—'}
                        {(v.comments?.length || 0) > 1 && ` (+${v.comments!.length - 1})`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && (
        <Modal title="Nouveau lieu" onClose={() => setCreating(false)}>
          <ContactForm initial={{ type: 'lieu', company: '' }} onDone={(c) => { setCreating(false); if (c) nav('/lieux/' + c.id); }} />
        </Modal>
      )}
    </>
  );
}

/** Fiche d'un lieu. */
export function VenueDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const venue = useLiveQuery(() => db.contacts.get(id!), [id]);
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const [editing, setEditing] = useState(false);
  if (!venue) return <p>Chargement…</p>;
  const ps = venueProjects(venue, projects);
  const addr = venueAddress(venue);

  return (
    <>
      <PageHead title={venue.company}>
        <Link to="/lieux"><button className="secondary">← Lieux</button></Link>
        <button className="secondary" onClick={() => setEditing(true)}>Modifier les coordonnées</button>
      </PageHead>
      <div className="grid">
        <div className="card">
          <h2>Coordonnées</h2>
          <dl className="kv">
            {addr && <><dt>Adresse</dt><dd>{addr}<br /><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addr)}`} target="_blank" rel="noreferrer">Voir sur la carte ↗</a></dd></>}
            {venue.phone && <><dt>Téléphone</dt><dd><a href={`tel:${venue.phone}`}>{venue.phone}</a></dd></>}
            {venue.email && <><dt>Email</dt><dd><a href={`mailto:${venue.email}`}>{venue.email}</a></dd></>}
            {(venue.persons || []).map((p, i) => <Fragmentless key={i} dt={p.name} dd={[p.role, p.phone, p.email].filter(Boolean).join(' · ')} />)}
          </dl>
          <h2 style={{ marginTop: 16 }}>Infos pratiques</h2>
          <VenueInfoForm venue={venue} />
        </div>
        <div className="card">
          <h2>Commentaires ({venue.comments?.length || 0})</h2>
          <VenueComments venue={venue} projects={projects} />
        </div>
      </div>
      <div className="card">
        <h2>Projets dans ce lieu ({ps.length})</h2>
        {ps.length === 0 ? <Empty>Aucun projet pour l'instant.</Empty> : (
          <table className="list">
            <tbody>
              {ps.map((p) => (
                <tr key={p.id} className="click" onClick={() => nav('/projets/' + p.id)}>
                  <td className="muted">{p.number}</td><td><strong>{p.name}</strong></td><td>{fmtRange(p.start, p.end)}</td><td><StatusBadge status={p.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <Modal title="Modifier le lieu" onClose={() => setEditing(false)}>
          <ContactForm initial={venue} onDone={() => setEditing(false)} />
        </Modal>
      )}
    </>
  );
}

function Fragmentless({ dt, dd }: { dt: string; dd: string }) {
  return <><dt>{dt}</dt><dd>{dd || '—'}</dd></>;
}

function VenueInfoForm({ venue }: { venue: Contact }) {
  const [info, setInfo] = useState<VenueInfo>(venue.venueInfo || {});
  useEffect(() => setInfo(venue.venueInfo || {}), [venue.venueInfo]);
  const keys = Object.keys(VENUE_INFO_LABELS) as (keyof VenueInfo)[];
  const saveInfo = () => {
    const clean = Object.fromEntries(keys.filter((k) => info[k]?.trim()).map((k) => [k, info[k]!.trim()])) as VenueInfo;
    if (JSON.stringify(clean) !== JSON.stringify(venue.venueInfo || {})) patch(db.contacts, venue.id, { venueInfo: Object.keys(clean).length ? clean : undefined });
  };
  return (
    <div className="form">
      {keys.map((k) => (
        <Field key={k} label={VENUE_INFO_LABELS[k]} full>
          <textarea style={{ minHeight: 48 }} value={info[k] || ''} onChange={(e) => setInfo({ ...info, [k]: e.target.value })} onBlur={saveInfo} />
        </Field>
      ))}
      <p className="muted" style={{ margin: 0 }}>Ces infos s'impriment sur la feuille de route et le bon de sortie des projets de ce lieu.</p>
    </div>
  );
}

/** Commentaires d'un lieu : ajout (lié au projet en cours s'il y en a un), alerte, impression, suppression. */
export function VenueComments({ venue, projects, projectId }: { venue: Contact; projects: Pick<Project, 'id' | 'name'>[]; projectId?: string }) {
  const [text, setText] = useState('');
  const [important, setImportant] = useState(false);
  const [onRoadmap, setOnRoadmap] = useState(false);
  const pName = new Map(projects.map((p) => [p.id, p.name]));
  const comments = venue.comments || [];
  const upd = (cid: string, c: Partial<VenueComment>) => patch(db.contacts, venue.id, { comments: comments.map((x) => (x.id === cid ? { ...x, ...c } : x)) });
  return (
    <div className="venue-comments">
      <form onSubmit={async (e) => {
        e.preventDefault();
        if (!text.trim()) return;
        await addVenueComment(venue.id, { text: text.trim(), projectId, important: important || undefined, onRoadmap: onRoadmap || undefined });
        setText(''); setImportant(false); setOnRoadmap(false);
      }}>
        <textarea placeholder="Ex. quai de déchargement fermé après 18 h, demander le badge à l'accueil" value={text} onChange={(e) => setText(e.target.value)} style={{ minHeight: 60 }} />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
          <label className="check-row"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Important (alerte sur les projets)</label>
          <label className="check-row"><input type="checkbox" checked={onRoadmap} onChange={(e) => setOnRoadmap(e.target.checked)} /> Sur la feuille de route</label>
          <span style={{ flex: 1 }} />
          <button type="submit" className="small" disabled={!text.trim()}>Ajouter le commentaire</button>
        </div>
      </form>
      {comments.length === 0 ? <p className="muted">Aucun commentaire.</p> : comments.map((c) => (
        <div key={c.id} className="comment" style={{ borderTop: '1px solid var(--border)', padding: '8px 0' }}>
          <div className="muted" style={{ fontSize: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            {fmtDate(c.at)}{c.projectId && pName.get(c.projectId) && <> · <Link to={'/projets/' + c.projectId}>{pName.get(c.projectId)}</Link></>}
            {c.important && <span className="badge st-annule">⚠ important</span>}
            {c.onRoadmap && <span className="badge">feuille de route</span>}
            <span style={{ flex: 1 }} />
            <button className="ghost small" onClick={() => upd(c.id, { important: !c.important || undefined })}>{c.important ? 'Retirer l\'alerte' : 'Alerte'}</button>
            <button className="ghost small" onClick={() => upd(c.id, { onRoadmap: !c.onRoadmap || undefined })}>{c.onRoadmap ? 'Ne plus imprimer' : 'Imprimer'}</button>
            <button className="ghost small" aria-label="Supprimer le commentaire" onClick={() => confirm('Supprimer ce commentaire ?') && patch(db.contacts, venue.id, { comments: comments.filter((x) => x.id !== c.id) })}>✕</button>
          </div>
          <div style={{ whiteSpace: 'pre-wrap' }}>{c.text}</div>
        </div>
      ))}
    </div>
  );
}
