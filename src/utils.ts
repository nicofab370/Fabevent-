import type { Table } from 'dexie';
import { db } from './db';
import type { Base, Equipment, EquipmentLine, Inspection, Period, Repair, SerialUnit, Settings, Subproject, Subrental, Transfer } from './types';
import { FIRM, RESERVING } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
export const nowIso = () => new Date().toISOString();

/**
 * Modifie seulement les champs donnés d'un enregistrement (sans réécrire le reste) :
 * évite d'écraser une modification faite juste avant par un autre champ de l'écran.
 */
export async function patch<T extends Base>(table: Table<T, string>, id: string, changes: Partial<T>): Promise<void> {
  await (table as unknown as Table<Base, string>).update(id, { ...changes, updatedAt: nowIso() } as Partial<Base>);
}

/** Crée ou met à jour un enregistrement (id + horodatage). */
export async function save<T extends Base>(table: Table<T, string>, data: Omit<T, keyof Base> & Partial<Base>): Promise<T> {
  const rec = { ...data, id: data.id || uid(), createdAt: data.createdAt || nowIso(), updatedAt: nowIso() } as T;
  await table.put(rec);
  return rec;
}

export function money(n: number): string {
  return (n || 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });
}
export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Valeur pour <input type="datetime-local"> */
export function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
export function fmtDate(s?: string, withTime = true): string {
  if (!s) return '';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('fr-FR', withTime && s.length > 10
    ? { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: '2-digit', month: '2-digit', year: 'numeric' });
}
export function fmtRange(a?: string, b?: string) {
  return `${fmtDate(a)} → ${fmtDate(b)}`;
}

/** Nombre de jours calendaires couverts (au moins 1). */
export function daysBetween(start: string, end: string): number {
  if (!start || !end) return 1;
  const s = new Date(start.slice(0, 10) + 'T00:00');
  const e = new Date(end.slice(0, 10) + 'T00:00');
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / 86400000) + 1);
}

/** Coefficient de location selon la durée. */
export function factorFor(days: number, s: Settings): number {
  const f = s.factors.length ? s.factors : [1];
  if (days <= f.length) return f[days - 1];
  return f[f.length - 1] + (days - f.length) * s.factorExtraPerDay;
}

export function lineTotal(l: Pick<EquipmentLine, 'qty' | 'unitPrice' | 'discount' | 'factor'>, days: number, s: Settings, perPiece = false) {
  const factor = perPiece ? 1 : l.factor ?? factorFor(days, s);
  return round2(l.qty * l.unitPrice * factor * (1 - (l.discount || 0) / 100));
}

export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string) {
  return aStart < bEnd && bStart < aEnd;
}

/* ---------- Disponibilité du matériel ---------- */

export const FOREVER = '9999-12-31T23:59';

/** Période pendant laquelle le matériel est bloqué (préparation → retour). */
export function blockPeriod(sp: Pick<Subproject, 'start' | 'end' | 'prepStart' | 'returnEnd'>): [string, string] {
  return [sp.prepStart && sp.prepStart < sp.start ? sp.prepStart : sp.start, sp.returnEnd && sp.returnEnd > sp.end ? sp.returnEnd : sp.end];
}

export interface Reservation {
  equipmentId: string;
  /** négatif = stock ajouté (sous-location) */
  qty: number;
  start: string;
  end: string;
  lineId: string;
  subprojectId: string;
  projectId: string;
  source: 'projet' | 'reparation' | 'souslocation' | 'transfert';
  depotId?: string;
  /** réservation ferme (projet confirmé ou matériel réservé à la main) ; sinon simple option */
  firm?: boolean;
}

export interface AvailabilityExtras {
  repairs?: Repair[];
  subrentals?: Subrental[];
  transfers?: Transfer[];
  /** dépôt de chaque projet */
  projectDepots?: Map<string, string | undefined>;
  mainDepot?: string;
  units?: SerialUnit[];
}

/** Stock réel : pour le matériel suivi par n° de série = unités en service. */
export function effectiveEquipment(equipment: Equipment[], units: SerialUnit[], depotIds: string[] = []): Equipment[] {
  const main = depotIds[0] || 'main';
  const count = new Map<string, number>();
  const byDepot = new Map<string, Record<string, number>>();
  for (const u of units) {
    if (u.status !== 'ok') continue;
    count.set(u.equipmentId, (count.get(u.equipmentId) || 0) + 1);
    const m = byDepot.get(u.equipmentId) || {};
    const d = u.depotId && depotIds.includes(u.depotId) ? u.depotId : main;
    m[d] = (m[d] || 0) + 1;
    byDepot.set(u.equipmentId, m);
  }
  return equipment.map((e) => {
    if (e.trackSerials) return { ...e, quantity: count.get(e.id) || 0, _stock: byDepot.get(e.id) || {} };
    if (depotIds.length < 2) return e;
    // vrac : les dépôts secondaires ont leur quantité, le principal a le reste
    const st: Record<string, number> = {};
    let others = 0;
    for (const d of depotIds.slice(1)) { st[d] = e.stock?.[d] || 0; others += st[d]; }
    st[main] = Math.max(0, e.quantity - others);
    return { ...e, _stock: st };
  });
}

/** L'article est-il dans ce dépôt ? du stock y est, ou c'est son dépôt d'attache (kits, articles à 0). */
export function inDepot(eq: Equipment, depotId: string | undefined, depots: { id: string }[], res?: Reservation[]): boolean {
  if (!depotId) return true;
  if (!eq.isKit && !eq.accessoryOnly && stockAt(eq, depotId, res) > 0) return true;
  const home = eq.homeDepotId && depots.some((d) => d.id === eq.homeDepotId) ? eq.homeDepotId : depots[0]?.id;
  return home === depotId;
}

/** Quantité dans un dépôt maintenant, transferts en cours compris (arrivés ou partis). */
export function stockAt(eq: Equipment, depotId: string | undefined, res?: Reservation[], at = toLocalInput(new Date())): number {
  let n = stockIn(eq, depotId);
  if (depotId) for (const r of res || []) if (r.source === 'transfert' && r.equipmentId === eq.id && r.depotId === depotId && r.start <= at && at < r.end) n -= r.qty;
  return Math.max(0, n);
}

/** Quantité d'un article dans un dépôt (sans dépôt = tout le parc). */
export function stockIn(eq: Equipment, depotId?: string): number {
  if (!depotId || !eq._stock) return eq.quantity;
  return eq._stock[depotId] || 0;
}

/** Développe lignes (kits → composants), réparations et sous-locations en réservations datées. */
export function buildReservations(lines: EquipmentLine[], subs: Subproject[], equipment: Equipment[], extras: AvailabilityExtras = {}): Reservation[] {
  const subMap = new Map(subs.map((s) => [s.id, s]));
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const out: Reservation[] = [];
  const main = extras.mainDepot || 'main';
  const depotOf = (projectId: string) => extras.projectDepots?.get(projectId) || main;
  const unitDepot = new Map((extras.units || []).map((u) => [u.id, u.depotId || main]));
  const push = (eqId: string, qty: number, l: EquipmentLine, sp: Subproject, depth: number) => {
    const eq = eqMap.get(eqId);
    // élément hors inventaire (accessoire) : ni stock ni réservation
    if (!eq || depth > 4 || eq.accessoryOnly) return;
    if (eq.isKit && eq.kitItems.length) {
      for (const k of eq.kitItems) push(k.equipmentId, k.qty * qty, l, sp, depth + 1);
    } else {
      const [start, end] = lineBlock(l, sp);
      // un consommable vendu ne revient pas
      const sold = eq.kind === 'vente';
      if (sold && l.consumed) return;
      out.push({ equipmentId: eqId, qty, start, end: sold ? FOREVER : end, lineId: l.id, subprojectId: sp.id, projectId: sp.projectId, source: 'projet', depotId: depotOf(sp.projectId), firm: FIRM.includes(sp.status) || !!sp.reserve });
    }
  };
  for (const l of lines) {
    const sp = subMap.get(l.subprojectId);
    if (!sp || !l.equipmentId || l.optional || !RESERVING.includes(sp.status)) continue;
    push(l.equipmentId, l.qty, l, sp, 0);
  }
  for (const r of extras.repairs || []) {
    if (r.status !== 'ouvert') continue;
    out.push({ equipmentId: r.equipmentId, qty: r.qty, start: r.start, end: r.end || FOREVER, lineId: r.id, subprojectId: '', projectId: '', source: 'reparation', depotId: (r.unitId && unitDepot.get(r.unitId)) || main });
  }
  for (const sr of extras.subrentals || []) {
    if (sr.status !== 'confirme' && sr.status !== 'recu') continue;
    for (const l of sr.lines) {
      if (l.equipmentId) out.push({ equipmentId: l.equipmentId, qty: -l.qty, start: sr.start, end: sr.end, lineId: sr.id, subprojectId: sr.subprojectId || '', projectId: sr.projectId, source: 'souslocation', depotId: depotOf(sr.projectId) });
    }
  }
  // transfert : sort du dépôt d'origine et entre dans le dépôt de destination sur la période (ou pour toujours)
  for (const t of extras.transfers || []) {
    if (t.status === 'annule') continue;
    for (const l of t.lines) {
      const base = { equipmentId: l.equipmentId, start: t.start, end: t.end || FOREVER, lineId: t.id, subprojectId: '', projectId: t.projectId || '', source: 'transfert' as const };
      out.push({ ...base, qty: l.qty, depotId: t.fromDepotId });
      out.push({ ...base, qty: -l.qty, depotId: t.toDepotId });
    }
  }
  return out;
}

/**
 * Pic de quantité réservée sur la période. Les apports (sous-locations, transferts entrants)
 * sont négatifs : le résultat peut donc être négatif si du stock arrive pendant toute la période.
 */
export function peakReserved(res: Reservation[], equipmentId: string, start: string, end: string, excludeLineId?: string, depotId?: string): number {
  const rs = res.filter((r) => r.equipmentId === equipmentId && r.lineId !== excludeLineId && (!depotId || r.depotId === depotId) && overlaps(r.start, r.end, start, end));
  if (!rs.length) return 0;
  // le net réservé ne change qu'au début d'une réservation ou à la fin d'un apport : on l'évalue à ces instants
  const times = new Set([start]);
  for (const r of rs) {
    if (r.start > start && r.start < end) times.add(r.start);
    if (r.qty < 0 && r.end > start && r.end < end) times.add(r.end);
  }
  let peak = -Infinity;
  for (const t of times) {
    let net = 0;
    for (const r of rs) if (r.start <= t && t < r.end) net += r.qty;
    peak = Math.max(peak, net);
  }
  return peak;
}

/** Quantité encore disponible (un kit = min de ses composants). */
export function availableQty(
  eq: Equipment, all: Equipment[], res: Reservation[], start: string, end: string, excludeLineId?: string, depotId?: string,
): number {
  if (eq.accessoryOnly) return Infinity;
  if (eq.isKit && eq.kitItems.length) {
    const map = new Map(all.map((e) => [e.id, e]));
    let min = Infinity;
    for (const k of eq.kitItems) {
      const c = map.get(k.equipmentId);
      if (!c) return 0;
      min = Math.min(min, Math.floor(availableQty(c, all, res, start, end, excludeLineId, depotId) / Math.max(1, k.qty)));
    }
    return min === Infinity ? 0 : min;
  }
  return stockIn(eq, depotId) - peakReserved(res, eq.id, start, end, excludeLineId, depotId);
}

export interface Conflict {
  equipment: Equipment;
  subprojectId: string;
  projectId: string;
  shortage: number;
  depotId?: string;
  /** ferme : même en ne comptant que les réservations fermes, il manque du matériel ;
   *  concurrence : le manque vient de demandes ou projets en attente qui se chevauchent */
  level: 'ferme' | 'concurrence';
  start: string;
  end: string;
}

export function findConflicts(res: Reservation[], equipment: Equipment[]): Conflict[] {
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const out: Conflict[] = [];
  for (const r of res) {
    if (r.source !== 'projet') continue;
    const key = r.equipmentId + '|' + r.subprojectId;
    if (seen.has(key)) continue;
    seen.add(key);
    const eq = eqMap.get(r.equipmentId);
    if (!eq) continue;
    const depot = eq._stock ? r.depotId : undefined;
    const end = r.end === FOREVER ? r.start : r.end;
    const peak = peakReserved(res, eq.id, r.start, end, undefined, depot);
    const have = stockIn(eq, depot);
    if (peak <= have) continue;
    // seules comptent les réservations fermes des autres projets, plus celles de cette salle
    const firmOnly = res.filter((x) => x.source !== 'projet' || x.firm || x.subprojectId === r.subprojectId);
    const level = peakReserved(firmOnly, eq.id, r.start, end, undefined, depot) > have ? 'ferme' : 'concurrence';
    out.push({ equipment: eq, subprojectId: r.subprojectId, projectId: r.projectId, shortage: peak - have, depotId: depot, level, start: r.start, end });
  }
  return out;
}

/* ---------- Fichiers ---------- */

export function download(filename: string, content: string | Blob, type = 'text/plain;charset=utf-8') {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function parseNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/\s|€/g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

/** Accepte ISO, "jj/mm/aaaa" et "jj/mm/aaaa hh:mm". */
export function parseDate(v: unknown): string {
  if (!v) return '';
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    const p = (x: string) => x.padStart(2, '0');
    return `${y}-${p(m[2])}-${p(m[1])}T${p(m[4] || '08')}:${m[5] || '00'}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : toLocalInput(d);
}

/* ---------- Agenda (.ics) ---------- */

export interface IcsEvent {
  uid: string;
  title: string;
  start: string;
  end: string;
  location?: string;
  description?: string;
  url?: string;
}

const icsEsc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const icsDate = (s: string) => s.replace(/[-:]/g, '').slice(0, 13) + '00';

export function buildIcs(name: string, events: IcsEvent[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FabEvent//FR', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${icsEsc(name)}`];
  for (const e of events) {
    if (!e.start || !e.end) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}@fabevent`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDate(e.start)}`,
      `DTEND:${icsDate(e.end)}`,
      `SUMMARY:${icsEsc(e.title)}`,
    );
    if (e.location) lines.push(`LOCATION:${icsEsc(e.location)}`);
    const desc = [e.description, e.url].filter(Boolean).join('\n');
    if (desc) lines.push(`DESCRIPTION:${icsEsc(desc)}`);
    if (e.url) lines.push(`URL:${e.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/* ---------- Suppression en cascade ---------- */

export async function deleteProject(projectId: string) {
  await db.transaction('rw', [db.projects, db.subprojects, db.lines, db.crew, db.vehicleAssignments, db.docs, db.subrentals, db.costs, db.files, db.log], async () => {
    await db.files.where({ projectId }).delete();
    await db.log.where({ projectId }).delete();
    await db.subrentals.where({ projectId }).delete();
    await db.costs.where({ projectId }).delete();
    await db.subprojects.where({ projectId }).delete();
    await db.lines.where({ projectId }).delete();
    await db.crew.where({ projectId }).delete();
    await db.vehicleAssignments.where({ projectId }).delete();
    await db.docs.where({ projectId }).delete();
    await db.projects.delete(projectId);
  });
}

export async function deleteSubproject(subprojectId: string) {
  await db.transaction('rw', [db.subprojects, db.lines, db.crew, db.vehicleAssignments, db.subrentals], async () => {
    await db.lines.where({ subprojectId }).delete();
    await db.crew.where({ subprojectId }).delete();
    await db.vehicleAssignments.where({ subprojectId }).delete();
    // les sous-locations restent sur le projet (commande fournisseur déjà passée)
    await db.subrentals.where({ subprojectId }).modify({ subprojectId: undefined });
    await db.subprojects.delete(subprojectId);
  });
}

/**
 * Suppression d'un sous-projet après confirmation : prévient s'il reste du matériel sorti non rentré,
 * des techniciens affectés, des documents ou si c'est le dernier sous-projet. Renvoie true si supprimé.
 */
export async function confirmDeleteSubproject(sp: { id: string; name: string; projectId: string }): Promise<boolean> {
  const [lines, crew, siblings] = await Promise.all([
    db.lines.where({ subprojectId: sp.id }).toArray(), db.crew.where({ subprojectId: sp.id }).toArray(), db.subprojects.where({ projectId: sp.projectId }).count(),
  ]);
  const out = lines.reduce((a, l) => a + Math.max(0, (l.outQty || 0) - (l.inQty || 0)), 0);
  const people = crew.filter((c) => c.personId).length;
  const warn = [
    out ? `Attention : ${out} article(s) sorti(s) et pas encore rentré(s) : fais d'abord le retour, sinon ils disparaissent de la checklist.` : '',
    people ? `${people} technicien(s) affecté(s) perdront ce poste.` : '',
    siblings <= 1 ? 'C\'est le dernier sous-projet du projet.' : '',
  ].filter(Boolean);
  const msg = `Supprimer le sous-projet « ${sp.name} » avec son matériel (${lines.length} ligne(s)), ses postes (${crew.length}) et ses véhicules ?${warn.length ? '\n\n' + warn.join('\n') : ''}\n\nLes documents déjà établis (devis, factures) ne changent pas.`;
  if (!confirm(msg)) return false;
  await deleteSubproject(sp.id);
  return true;
}

/* ---------- Contrôles périodiques ---------- */

export interface InspectionDue {
  equipment: Equipment;
  unit?: SerialUnit;
  last?: string;
  due: string;
}

function addMonths(isoDate: string, months: number): string {
  const d = new Date(isoDate.slice(0, 10) + 'T12:00');
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Prochains contrôles : par unité pour le matériel suivi par n° de série, sinon par article. */
export function inspectionsDue(equipment: Equipment[], units: SerialUnit[], inspections: Inspection[]): InspectionDue[] {
  const out: InspectionDue[] = [];
  const lastOf = (eqId: string, unitId?: string) => inspections
    .filter((i) => i.equipmentId === eqId && (unitId ? i.unitId === unitId : !i.unitId) && i.result === 'ok')
    .reduce<string | undefined>((a, i) => (!a || i.date > a ? i.date : a), undefined);
  const today = new Date().toISOString().slice(0, 10);
  for (const e of equipment) {
    if (!e.inspectionMonths) continue;
    if (e.trackSerials) {
      for (const u of units.filter((x) => x.equipmentId === e.id && x.status === 'ok')) {
        const last = lastOf(e.id, u.id) || u.lastInspection;
        out.push({ equipment: e, unit: u, last, due: last ? addMonths(last, e.inspectionMonths) : today });
      }
    } else {
      const last = lastOf(e.id);
      out.push({ equipment: e, last, due: last ? addMonths(last, e.inspectionMonths) : today });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

/* ---------- Horaires des sous-projets ---------- */

export function sortPeriods(periods: Period[]): Period[] {
  return [...periods].sort((a, b) => a.start.localeCompare(b.start));
}

/** Déduit les dates du sous-projet de ses horaires (bloqué : tout ; facturé : les prestations). */
export function syncPeriods<T extends Pick<Subproject, 'start' | 'end' | 'prepStart' | 'returnEnd' | 'periods'>>(sp: T): T {
  const ps = sortPeriods((sp.periods || []).filter((p) => p.start && p.end));
  if (!ps.length) return { ...sp, periods: undefined };
  const usage = ps.filter((p) => p.kind === 'prestation');
  const used = usage.length ? usage : ps;
  const allStart = ps[0].start;
  const allEnd = ps.reduce((a, p) => (p.end > a ? p.end : a), ps[0].end);
  const start = used[0].start;
  const end = used.reduce((a, p) => (p.end > a ? p.end : a), used[0].end);
  return { ...sp, periods: ps, start, end, prepStart: allStart < start ? allStart : undefined, returnEnd: allEnd > end ? allEnd : undefined };
}

/** Jours facturés : jours distincts couverts par les prestations (une fin avant 6 h compte pour la veille). */
export function usageDays(sp: Pick<Subproject, 'start' | 'end' | 'periods'>): number {
  const usage = (sp.periods || []).filter((p) => p.kind === 'prestation');
  if (!usage.length) return daysBetween(sp.start, sp.end);
  const days = new Set<string>();
  for (const p of usage) {
    const d = new Date(p.start.slice(0, 10) + 'T12:00');
    const endD = new Date(p.end);
    if (endD.getHours() < 6 && p.end.slice(0, 10) > p.start.slice(0, 10)) endD.setDate(endD.getDate() - 1);
    const last = toLocalInput(endD).slice(0, 10);
    for (let i = 0; i < 366; i++) {
      const k = toLocalInput(d).slice(0, 10);
      days.add(k);
      if (k >= last) break;
      d.setDate(d.getDate() + 1);
    }
  }
  return Math.max(1, days.size);
}

/* ---------- Groupes d'équipement liés à des créneaux ---------- */

/** Créneaux couverts par le groupe de la ligne (ou null = toute la salle). */
function groupPeriods(l: Pick<EquipmentLine, 'groupId' | 'periodIds'>, sp: Pick<Subproject, 'groups' | 'periods'>): Period[] | null {
  // horaire propre à la ligne, prioritaire sur celui du groupe
  if (l.periodIds?.length) {
    const own = (sp.periods || []).filter((p) => l.periodIds!.includes(p.id));
    if (own.length) return sortPeriods(own);
  }
  if (!l.groupId) return null;
  const g = sp.groups?.find((x) => x.id === l.groupId);
  if (!g || !g.periodIds.length) return null;
  const ps = (sp.periods || []).filter((p) => g.periodIds.includes(p.id));
  return ps.length ? sortPeriods(ps) : null;
}

/** Période pendant laquelle la ligne bloque le matériel. */
export function lineBlock(l: Pick<EquipmentLine, 'groupId' | 'periodIds'>, sp: Subproject): [string, string] {
  const ps = groupPeriods(l, sp);
  if (!ps) return blockPeriod(sp);
  return [ps[0].start, ps.reduce((a, p) => (p.end > a ? p.end : a), ps[0].end)];
}

/** Jours facturés pour la ligne : jours de prestation des créneaux du groupe, sinon ceux de la salle. */
export function lineDays(l: Pick<EquipmentLine, 'groupId' | 'periodIds'>, sp: Subproject): number {
  const ps = groupPeriods(l, sp);
  if (!ps) return usageDays(sp);
  const synced = syncPeriods({ start: '', end: '', periods: ps });
  return usageDays({ ...synced, periods: ps.some((p) => p.kind === 'prestation') ? ps : ps.map((p) => ({ ...p, kind: 'prestation' as const })) });
}

/* ---------- Personnel : montants, heures supplémentaires, trajet ---------- */

export interface CrewAmount {
  unit: 'jour' | 'heure'; qty: number; hours: number; overtime: number; billed: number; cost: number;
  /** heures sup. du technicien (au-delà de son forfait journalier) */
  costOvertime: number;
  /** heures prestées par le technicien (trajet compris) */
  worked: number;
  /** heures estimées (poste à la journée sur plusieurs jours : même horaire chaque jour) */
  estimated: boolean;
}

/**
 * Ce que coûte la personne : forfait journalier et / ou prix horaire, et heures comprises dans
 * son forfait. Seulement un prix horaire : tout est compté à l'heure. Seulement un forfait :
 * les heures sup. valent forfait ÷ heures du forfait.
 */
export interface CostProfile { day?: number; hour?: number; dayHours?: number }
/** Heures par jour calendaire d'un intervalle. */
export function hoursPerDay(start: string, end: string): number[] {
  const out: number[] = [];
  let t = new Date(start).getTime();
  const e = new Date(end).getTime();
  while (t < e) {
    const d = new Date(t);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const stop = Math.min(next, e);
    out.push((stop - t) / 3600000);
    t = stop;
  }
  return out;
}

/**
 * Montants d'un poste : à la journée (jours × tarif) ou à l'heure, avec majoration
 * des heures au-delà du seuil journalier. Le trajet est compté s'il est inclus.
 */
export function crewAmount(
  c: { start: string; end: string; rate: number; cost?: number; costUnit?: 'jour' | 'heure'; rateUnit?: 'jour' | 'heure'; travel?: boolean },
  s: Pick<Settings, 'overtimeAfter' | 'overtimeRate'>, travelMinutes = 0, costFallback: number | CostProfile = 0,
): CrewAmount {
  const k = 1 + (s.overtimeRate ?? 50) / 100;
  const [a, b] = crewWindow(c, travelMinutes);
  // un service de 24 h maximum (même à cheval sur minuit) compte comme une seule journée de travail
  const total = (new Date(b).getTime() - new Date(a).getTime()) / 3600000;
  const single = total <= 24;
  const perDay = single ? [total] : hoursPerDay(a, b);
  const over = (limit: number) => round2(perDay.reduce((x, h) => x + Math.max(0, h - limit), 0));
  const hours = round2(perDay.reduce((x, h) => x + h, 0));
  const days = daysBetween(c.start, c.end);

  // coût : saisi sur le poste, sinon le profil de la personne
  const unitOf = c.costUnit ?? c.rateUnit ?? 'jour';
  const prof: CostProfile = c.cost != null ? (unitOf === 'heure' ? { hour: c.cost } : { day: c.cost })
    : typeof costFallback === 'number' ? ((c.rateUnit ?? 'jour') === 'heure' ? { hour: costFallback } : { day: costFallback }) : { ...costFallback };
  if (c.cost != null && typeof costFallback === 'object') prof.dayHours = costFallback.dayHours;
  const limitCost = prof.dayHours || s.overtimeAfter || 10;

  // heures prestées : à l'heure, la durée réelle ; à la journée sur plusieurs jours, le même horaire chaque jour
  // (ex. 8 h → 18 h pendant 3 jours = 30 h), trajet compris
  // (estimation : les heures sup. ne sont alors pas comptées, l'horaire réel de chaque jour n'étant pas connu)
  let worked = hours, workedOver = over(limitCost), estimated = false;
  if (c.rateUnit !== 'heure' && !single) {
    const clock = (d: string) => { const x = new Date(d); return x.getHours() + x.getMinutes() / 60; };
    const span = clock(b) - clock(a);
    worked = round2((span > 0 ? span : limitCost) * days);
    workedOver = 0;
    estimated = true;
  }

  const day = prof.day || 0, hour = prof.hour || 0;
  let cost = 0;
  if (hour && (!day || c.rateUnit === 'heure')) {
    // payé à l'heure (seulement un prix horaire, ou poste à l'heure)
    cost = (worked - workedOver) * hour + workedOver * hour * k;
  } else if (day) {
    // payé au forfait : par jour (poste à la journée) ou par journée de service (poste à l'heure) + heures sup.
    const n = c.rateUnit === 'heure' ? perDay.filter((h) => h > 0).length : days;
    cost = n * day + workedOver * (hour || day / limitCost) * k;
  }
  cost = round2(cost);
  const extra = { cost, costOvertime: workedOver, worked, estimated };

  if (c.rateUnit !== 'heure') return { unit: 'jour', qty: days, hours: 0, overtime: 0, billed: round2(days * c.rate), ...extra };
  const overtime = over(s.overtimeAfter ?? 10);
  const normal = hours - overtime;
  return { unit: 'heure', qty: hours, hours, overtime, billed: round2(normal * c.rate + overtime * c.rate * k), ...extra };
}

/** 12,5 → « 12 h 30 » */
export function fmtHours(x: number): string {
  const h = Math.floor(x + 1e-9), m = Math.round((x - h) * 60);
  if (m === 60) return `${h + 1} h`;
  if (!h && m) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** Horaires communiqués : trajet aller avant le début et retour après la fin. */
export function crewWindow(c: { start: string; end: string; travel?: boolean }, travelMinutes = 0): [string, string] {
  if (!c.travel || !travelMinutes) return [c.start, c.end];
  return [toLocalInput(new Date(new Date(c.start).getTime() - travelMinutes * 60000)), toLocalInput(new Date(new Date(c.end).getTime() + travelMinutes * 60000))];
}

/** Coût d'un poste : saisi à la main, sinon celui de la personne affectée selon l'unité. */
export function crewCostRate(
  c: { cost?: number; rateUnit?: 'jour' | 'heure'; function?: string },
  person?: { costRate?: number; hourlyCost?: number; rates?: { function: string; cost?: number; hourCost?: number }[] },
): number {
  if (c.cost != null) return c.cost;
  // tarif propre à la fonction du poste (vidéo, son, road…), sinon le coût par défaut de la personne
  const fn = c.function?.trim().toLowerCase();
  const r = fn ? person?.rates?.find((x) => x.function.trim().toLowerCase() === fn) : undefined;
  const own = c.rateUnit === 'heure' ? r?.hourCost : r?.cost;
  if (own != null && own > 0) return own;
  return (c.rateUnit === 'heure' ? person?.hourlyCost : person?.costRate) ?? 0;
}

/** Profil de coût d'un poste : tarif propre à la fonction, sinon forfait et prix horaire de la personne. */
export function crewCostProfile(
  c: { function?: string },
  person?: { costRate?: number; hourlyCost?: number; dayHours?: number; rates?: { function: string; cost?: number; hourCost?: number }[] },
): CostProfile {
  const fn = c.function?.trim().toLowerCase();
  const r = fn ? person?.rates?.find((x) => x.function.trim().toLowerCase() === fn) : undefined;
  const own = r && ((r.cost || 0) > 0 || (r.hourCost || 0) > 0);
  return {
    day: (own ? r!.cost : person?.costRate) || undefined,
    hour: (own ? r!.hourCost : person?.hourlyCost) || undefined,
    dayHours: person?.dayHours || undefined,
  };
}

/** Coût affiché pour un poste : la valeur et son unité (celle que la personne a, ou celle du poste). */
export function crewCostShown(c: { cost?: number; costUnit?: 'jour' | 'heure'; rateUnit?: 'jour' | 'heure' }, prof: CostProfile): { value: number; unit: 'jour' | 'heure' } {
  if (c.cost != null) return { value: c.cost, unit: c.costUnit ?? c.rateUnit ?? 'jour' };
  if (prof.hour && (!prof.day || c.rateUnit === 'heure')) return { value: prof.hour, unit: 'heure' };
  return { value: prof.day || 0, unit: 'jour' };
}

/** Tarif client d'une fonction du catalogue (sinon le tarif par défaut de la personne). */
export function functionRate(
  fn: string, unit: 'jour' | 'heure' | undefined, catalogue: { name: string; dayRate: number; hourRate?: number }[] = [],
  person?: { dailyRate?: number; hourlyRate?: number },
): number | undefined {
  const f = catalogue.find((x) => x.name.trim().toLowerCase() === fn.trim().toLowerCase());
  if (f) return unit === 'heure' ? f.hourRate : f.dayRate;
  return unit === 'heure' ? person?.hourlyRate : person?.dailyRate;
}
