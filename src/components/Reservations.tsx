import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db';
import type { Equipment } from '../types';
import { StatusBadge } from './ui';
import { fmtDate, fmtRange, overlaps, type Reservation } from '../utils';

/*
 * Qui d'autre utilise ce matériel pendant la même période ? (autres projets, réparations, transferts)
 * Pour un kit, ce sont les réservations de ses composants.
 */

export interface OtherUse extends Reservation { equipmentName: string }

export function otherUses(eq: Equipment, equipment: Equipment[], res: Reservation[], start: string, end: string, projectId?: string): OtherUse[] {
  const ids = eq.isKit && eq.kitItems.length ? eq.kitItems.map((k) => k.equipmentId) : [eq.id];
  const name = new Map(equipment.map((e) => [e.id, e.name]));
  return res
    .filter((r) => ids.includes(r.equipmentId) && r.qty > 0 && overlaps(r.start, r.end, start, end) && !(projectId && r.projectId === projectId && r.source === 'projet'))
    .map((r) => ({ ...r, equipmentName: name.get(r.equipmentId) || '' }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** quantité utilisée ailleurs (pour l'article lui-même ; pour un kit, le total des composants) */
export const usedElsewhere = (uses: OtherUse[]) => uses.reduce((a, r) => a + r.qty, 0);

const SOURCE: Record<Reservation['source'], string> = { projet: '', reparation: 'En réparation', souslocation: 'Sous-location', transfert: 'Transfert' };

/** liste des autres utilisations, avec un lien vers chaque projet */
export function OtherUsesList({ uses, kit }: { uses: OtherUse[]; kit?: boolean }) {
  const ids = Array.from(new Set(uses.map((u) => u.projectId).filter(Boolean)));
  const projects = useLiveQuery(() => db.projects.bulkGet(ids), [ids.join('|')]) || [];
  const byId = new Map(projects.filter(Boolean).map((p) => [p!.id, p!]));
  if (!uses.length) return <p className="muted other-uses-empty">Réservé nulle part ailleurs sur cette période.</p>;
  return (
    <ul className="other-uses">
      {uses.map((u, i) => {
        const p = u.projectId ? byId.get(u.projectId) : undefined;
        return (
          <li key={u.lineId + i}>
            <strong className="ou-qty">{u.qty} ×</strong>
            {kit && <span className="muted">{u.equipmentName} · </span>}
            {p ? <Link to={'/projets/' + p.id}>{p.number} {p.name}</Link> : <span>{SOURCE[u.source] || 'Autre'}</span>}
            {p && <StatusBadge status={p.status} />}
            {u.source === 'projet' && !u.firm && <span className="muted"> (option)</span>}
            <span className="muted ou-dates">{u.end.startsWith('9999') ? `depuis le ${fmtDate(u.start, false)}` : fmtRange(u.start, u.end)}</span>
          </li>
        );
      })}
    </ul>
  );
}
