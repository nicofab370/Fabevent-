import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, Modal, PageHead, StatusBadge } from '../components/ui';
import { db } from '../db';
import { buildReservations, fmtRange, money } from '../utils';
import { EquipmentForm } from './EquipmentList';

export default function EquipmentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const eq = useLiveQuery(() => db.equipment.get(id!), [id]);
  const all = useLiveQuery(() => db.equipment.toArray(), []) || [];
  const lines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const [editing, setEditing] = useState(false);
  if (!eq) return <p>Chargement…</p>;

  const subMap = new Map(subs.map((s) => [s.id, s]));
  const projMap = new Map(projects.map((p) => [p.id, p]));
  const allMap = new Map(all.map((e) => [e.id, e]));
  // Toutes les utilisations (y compris statuts non bloquants), avec les kits contenant cet article
  const res = buildReservations(lines, subs.map((s) => ({ ...s, status: s.status === 'annule' ? s.status : 'confirme' as const })), all)
    .filter((r) => r.equipmentId === eq.id)
    .sort((a, b) => b.start.localeCompare(a.start));
  const usedIn = all.filter((k) => k.isKit && k.kitItems.some((i) => i.equipmentId === eq.id));

  return (
    <>
      <PageHead title={eq.name}>
        <button className="secondary" onClick={() => nav('/materiel')}>← Retour</button>
        <button onClick={() => setEditing(true)}>Modifier</button>
        <button className="danger" onClick={async () => {
          if (confirm('Supprimer cet article ? Les lignes de projet existantes garderont leur désignation.')) {
            await db.equipment.delete(eq.id); nav('/materiel');
          }
        }}>Supprimer</button>
      </PageHead>
      <div className="stats">
        <div className="stat"><b>{eq.isKit ? 'Kit' : eq.quantity}</b><span>{eq.isKit ? 'composé' : 'en stock'}</span></div>
        <div className="stat"><b>{money(eq.dailyPrice)}</b><span>prix / jour HT</span></div>
        <div className="stat"><b>{money(eq.replacementValue || 0)}</b><span>valeur de remplacement</span></div>
        <div className="stat"><b>{eq.code || '—'}</b><span>référence</span></div>
      </div>
      {eq.isKit && (
        <div className="card">
          <h2>Contenu du kit</h2>
          <ul>{eq.kitItems.map((k, i) => <li key={i}>{k.qty} × <Link to={'/materiel/' + k.equipmentId}>{allMap.get(k.equipmentId)?.name || '?'}</Link></li>)}</ul>
        </div>
      )}
      {usedIn.length > 0 && (
        <div className="card"><h2>Inclus dans les kits</h2>{usedIn.map((k) => <Link key={k.id} to={'/materiel/' + k.id} style={{ marginRight: 12 }}>{k.name}</Link>)}</div>
      )}
      <div className="card">
        <h2>Planning d'utilisation</h2>
        {res.length === 0 ? <Empty>Pas encore utilisé dans un projet.</Empty> : (
          <table className="list">
            <thead><tr><th>Projet</th><th>Sous-projet</th><th>Période</th><th>Statut</th><th className="n">Qté</th></tr></thead>
            <tbody>
              {res.map((r, i) => {
                const sp = subMap.get(r.subprojectId)!;
                const p = projMap.get(r.projectId);
                return (
                  <tr key={i} className="click" onClick={() => nav('/projets/' + r.projectId)}>
                    <td>{p?.number} {p?.name}</td><td>{sp.name}</td><td>{fmtRange(sp.start, sp.end)}</td>
                    <td><StatusBadge status={sp.status} /></td><td className="n">{r.qty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {eq.notes && <div className="card"><h2>Notes</h2><p style={{ whiteSpace: 'pre-wrap' }}>{eq.notes}</p></div>}
      {editing && <Modal title="Modifier l'article" onClose={() => setEditing(false)} wide><EquipmentForm initial={eq} onDone={() => setEditing(false)} /></Modal>}
    </>
  );
}
