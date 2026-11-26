import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db';
import type { Equipment } from '../types';
import { StatusBadge } from './ui';
import { fmtDate, fmtRange, isFixedKit, isVirtualKit, overlaps, type Reservation } from '../utils';

/*
 * Qui d'autre utilise ce matériel pendant la même période ? (autres projets, réparations, transferts)
 * Pour un kit, ce sont les réservations de ses composants.
 */

/**
 * Où est le matériel sur la période :
 * ici = autre ligne du même sous-projet ; sousprojet = autre sous-projet de ce projet ;
 * option = projet pas encore confirmé ; reserve = projet confirmé (ou réservé à la main) ;
 * autre = réparation, transfert sortant.
 */
type UseKind = 'ici' | 'sousprojet' | 'option' | 'reserve' | 'autre';
const USE_KINDS: UseKind[] = ['ici', 'sousprojet', 'option', 'reserve', 'autre'];
const USE_LABEL: Record<UseKind, string> = {
  ici: 'Ailleurs dans ce sous-projet',
  sousprojet: 'Dans un autre sous-projet de ce projet',
  option: 'En option dans un autre projet',
  reserve: 'Réservé (confirmé) dans un autre projet',
  autre: 'Réparation, transfert',
};
/** libellé court d'une pastille : « 3 en option ailleurs » */
const USE_SHORT: Record<UseKind, string> = { ici: 'autre ligne', sousprojet: 'autre sous-projet', option: 'en option ailleurs', reserve: 'réservé ailleurs', autre: 'réparation / transfert' };

export interface OtherUse extends Reservation { equipmentName: string; kind: UseKind }

/** toutes les utilisations de l'article (ou des composants d'un kit) sur la période, sauf la ligne `lineId` */
export function projectUses(eq: Equipment, equipment: Equipment[], res: Reservation[], start: string, end: string,
  ctx: { projectId?: string; subprojectId?: string; lineId?: string; depot?: string } = {}): OtherUse[] {
  const ids = isVirtualKit(eq) ? eq.kitItems.map((k) => k.equipmentId) : [eq.id];
  const byId = new Map(equipment.map((e) => [e.id, e]));
  return res
    .filter((r) => ids.includes(r.equipmentId) && r.qty > 0 && overlaps(r.start, r.end, start, end) && (!ctx.lineId || r.lineId !== ctx.lineId)
      // stock par dépôt : seules comptent les réservations du dépôt du projet
      && (!ctx.depot || !byId.get(r.equipmentId)?._stock || !r.depotId || r.depotId === ctx.depot))
    .map((r) => ({
      ...r,
      equipmentName: byId.get(r.equipmentId)?.name || '',
      kind: (r.source !== 'projet' ? 'autre' : ctx.projectId && r.projectId === ctx.projectId ? (r.subprojectId === ctx.subprojectId ? 'ici' : 'sousprojet') : r.firm ? 'reserve' : 'option') as UseKind,
    }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/** quantités par type d'utilisation */
export function usesByKind(uses: OtherUse[]): Record<UseKind, number> {
  const out = { ici: 0, sousprojet: 0, option: 0, reserve: 0, autre: 0 };
  for (const u of uses) out[u.kind] += u.qty;
  return out;
}

/** pastilles « 2 autre sous-projet · 3 en option ailleurs · 1 réservé ailleurs » ; clic = détail */
export function UseChips({ uses, onOpen, label }: { uses: OtherUse[]; onOpen: () => void; label: string }) {
  const k = usesByKind(uses);
  const shown = USE_KINDS.filter((x) => k[x] > 0);
  if (!shown.length) return null;
  return (
    <button type="button" className="link-btn use-chips" onClick={onOpen} aria-label={`Où est ${label} sur la période`} title="Voir le détail : dans ce projet, en option ou réservé ailleurs">
      {shown.map((x) => <span key={x} className={'use-chip uk-' + x}>{k[x]} {USE_SHORT[x]}</span>)}
    </button>
  );
}

/**
 * Détail de la disponibilité : stock, cette ligne, ce projet (autres lignes, autres sous-projets),
 * autres projets (en option / réservé), réparations et transferts, disponible ; puis la liste avec les liens.
 */
export function UsageBreakdown({ eq, uses, stock, here, avail, hereLabel = 'cette ligne' }: { eq: Equipment; uses: OtherUse[]; stock?: number; here?: number; avail: number; hereLabel?: string }) {
  const k = usesByKind(uses);
  const rows: [string, number | undefined, string][] = [
    ['Stock' + (isVirtualKit(eq) ? ' (kit : selon les composants)' : isFixedKit(eq) ? ' (caisses montées)' : ''), isVirtualKit(eq) ? undefined : stock, ''],
    ...(here ? [[hereLabel[0].toUpperCase() + hereLabel.slice(1), here, 'ici'] as [string, number, string]] : []),
    ...USE_KINDS.map((x) => [USE_LABEL[x], k[x], x] as [string, number, string]),
  ];
  return (
    <div className="usage">
      <table className="usage-sum">
        <tbody>
          {rows.filter(([, n, x]) => n !== undefined && (n > 0 || x === '' || x === 'option' || x === 'reserve')).map(([l, n, x]) => (
            <tr key={l} className={x ? 'uk-' + x : ''}><td>{l}</td><td className="n">{n}</td></tr>
          ))}
          <tr className="usage-free"><td><strong>Disponible{here ? ` après ${hereLabel}` : ''}</strong></td><td className="n"><span className={'avail ' + (avail >= 0 ? 'ok' : 'ko')}>{avail >= 0 ? avail : `manque ${-avail}`}</span></td></tr>
        </tbody>
      </table>
      {isVirtualKit(eq) && <p className="muted" style={{ fontSize: 12 }}>Kit : les quantités sont celles de ses composants.</p>}
      <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>Les quantités s'additionnent sur toute la période ; si les dates ne se chevauchent pas entre elles, le disponible peut être plus grand.</p>
      <OtherUsesList uses={uses} kit={isVirtualKit(eq)} />
    </div>
  );
}

const SOURCE: Record<Reservation['source'], string> = { projet: '', reparation: 'En réparation', souslocation: 'Sous-location', transfert: 'Transfert', kit: 'Monté dans un kit fixe' };

/** liste des autres utilisations, avec un lien vers chaque projet */
function OtherUsesList({ uses, kit }: { uses: OtherUse[]; kit?: boolean }) {
  const ids = Array.from(new Set(uses.map((u) => u.projectId).filter(Boolean)));
  const projects = useLiveQuery(() => db.projects.bulkGet(ids), [ids.join('|')]);
  const byId = new Map((projects || []).filter(Boolean).map((p) => [p!.id, p!]));
  const subIds = Array.from(new Set(uses.map((u) => u.subprojectId).filter(Boolean)));
  const subs = useLiveQuery(() => db.subprojects.bulkGet(subIds), [subIds.join('|')]);
  const subName = new Map((subs || []).filter(Boolean).map((x) => [x!.id, x!.name]));
  if (!uses.length) return <p className="muted other-uses-empty">Utilisé nulle part ailleurs sur cette période.</p>;
  // noms des projets pas encore lus : on attend plutôt que d'afficher « Autre » un instant
  if (ids.length && !projects) return null;
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
            {u.subprojectId && subName.get(u.subprojectId) && <span className="muted">› {subName.get(u.subprojectId)}</span>}
            {(u.kind !== 'autre' || p) && <span className={'use-chip uk-' + u.kind}>{u.kind === 'ici' ? 'ce sous-projet' : u.kind === 'sousprojet' ? 'ce projet' : u.kind === 'option' ? 'option' : u.kind === 'reserve' ? 'réservé' : SOURCE[u.source] || 'autre'}</span>}
            <span className="muted ou-dates">{u.source === 'kit' ? 'en permanence' : u.end.startsWith('9999') ? `depuis le ${fmtDate(u.start, false)}` : fmtRange(u.start, u.end)}</span>
          </li>
        );
      })}
    </ul>
  );
}
