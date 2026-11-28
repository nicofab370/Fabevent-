/**
 * Vérification rapide de disponibilité (sablier), sur toutes les pages : un article et une période
 * → quantité disponible, projets qui bloquent l'article et alternatives.
 * La période est la période de planification (préparation → retour), comme les réservations.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAvailability } from '../data';
import { db } from '../db';
import { availableQty, fmtRange, toLocalInput } from '../utils';
import { Icon } from './Icon';
import { Field, Modal } from './ui';

function Checker({ onClose }: { onClose: () => void }) {
  const av = useAvailability();
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const [q, setQ] = useState('');
  const [eqId, setEqId] = useState('');
  const [from, setFrom] = useState(() => toLocalInput(new Date()).slice(0, 10) + 'T08:00');
  const [to, setTo] = useState(() => toLocalInput(new Date(Date.now() + 86400000)).slice(0, 10) + 'T20:00');
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return [];
    return av.equipment.filter((e) => !e.archived && !e.accessoryOnly && [e.name, e.code, e.brand, e.model, e.barcode, ...(e.extraCodes || [])].join(' ').toLowerCase().includes(t)).slice(0, 8);
  }, [q, av.equipment]);
  const eq = av.equipment.find((e) => e.id === eqId);
  const ok = !!eq && from && to && to > from;
  const avail = ok ? availableQty(eq!, av.equipment, av.res, from, to) : 0;
  const blocking = ok ? av.res.filter((r) => r.equipmentId === eq!.id && r.qty > 0 && r.start < to && from < r.end) : [];
  const byProject = new Map<string, number>();
  for (const r of blocking) byProject.set(r.projectId || r.source, (byProject.get(r.projectId || r.source) || 0) + r.qty);
  return (
    <Modal title="Vérifier la disponibilité" onClose={onClose}>
      <div className="form">
        <Field label="Article" full>
          <input autoFocus value={q} placeholder="Nom, code, code-barres…" onChange={(e) => { setQ(e.target.value); setEqId(''); }} />
        </Field>
        {!eq && matches.length > 0 && (
          <ul className="pick-list full">
            {matches.map((e) => <li key={e.id}><button type="button" className="link-btn" onClick={() => { setEqId(e.id); setQ(e.name); }}>{e.name}{e.code ? <span className="muted"> · {e.code}</span> : null}</button></li>)}
          </ul>
        )}
        <Field label="Disponible de"><input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="jusqu'au"><input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
      </div>
      {eq && !ok && <p className="muted">La fin doit être après le début.</p>}
      {eq && ok && (
        <div className="quick-avail">
          <p className={'avail-big ' + (avail > 0 ? 'ok' : 'ko')}><strong>{avail > 0 ? `${avail} disponible(s)` : avail === 0 ? 'Aucun disponible' : `Manque de ${-avail}`}</strong> sur {eq.quantity} en stock — {fmtRange(from, to)}</p>
          {byProject.size > 0 && (
            <>
              <h3>Déjà pris sur la période</h3>
              <ul>
                {[...byProject].map(([id, qty]) => {
                  const p = pMap.get(id);
                  return <li key={id}>{p ? <Link to={'/projets/' + p.id} onClick={onClose}>{p.number} {p.name}</Link> : id === 'reparation' ? 'En réparation' : id === 'transfert' ? 'Transfert vers un autre dépôt' : id} : {qty}</li>;
                })}
              </ul>
            </>
          )}
          {(eq.alternatives || []).length > 0 && (
            <>
              <h3>Alternatives</h3>
              <ul>
                {eq.alternatives!.map((id) => av.equipment.find((x) => x.id === id)).filter(Boolean).map((a) => (
                  <li key={a!.id}><Link to={'/materiel/' + a!.id} onClick={onClose}>{a!.name}</Link> : {availableQty(a!, av.equipment, av.res, from, to)} disponible(s)</li>
                ))}
              </ul>
            </>
          )}
          <p><Link to={'/materiel/' + eq.id} onClick={onClose}>Ouvrir la fiche de l'article</Link></p>
        </div>
      )}
    </Modal>
  );
}

export function QuickAvailability({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={'ghost' + (compact ? '' : ' side-tool')} aria-label="Vérifier la disponibilité d'un article" title="Vérifier la disponibilité d'un article" onClick={() => setOpen(true)}>
        <Icon name="hourglass" />{!compact && <span>Disponibilité</span>}
      </button>
      {open && <Checker onClose={() => setOpen(false)} />}
    </>
  );
}
