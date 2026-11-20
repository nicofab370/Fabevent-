import type { Table } from 'dexie';
import { db } from './db';
import type { Base, Equipment, EquipmentLine, Inspection, Repair, SerialUnit, Settings, Subproject, Subrental } from './types';
import { RESERVING } from './types';

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
export const nowIso = () => new Date().toISOString();

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
  source: 'projet' | 'reparation' | 'souslocation';
}

export interface AvailabilityExtras {
  repairs?: Repair[];
  subrentals?: Subrental[];
}

/** Stock réel : pour le matériel suivi par n° de série = unités en service. */
export function effectiveEquipment(equipment: Equipment[], units: SerialUnit[]): Equipment[] {
  if (!units.length) return equipment;
  const count = new Map<string, number>();
  for (const u of units) if (u.status === 'ok') count.set(u.equipmentId, (count.get(u.equipmentId) || 0) + 1);
  return equipment.map((e) => (e.trackSerials ? { ...e, quantity: count.get(e.id) || 0 } : e));
}

/** Développe lignes (kits → composants), réparations et sous-locations en réservations datées. */
export function buildReservations(lines: EquipmentLine[], subs: Subproject[], equipment: Equipment[], extras: AvailabilityExtras = {}): Reservation[] {
  const subMap = new Map(subs.map((s) => [s.id, s]));
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const out: Reservation[] = [];
  const push = (eqId: string, qty: number, l: EquipmentLine, sp: Subproject, depth: number) => {
    const eq = eqMap.get(eqId);
    if (!eq || depth > 4) return;
    if (eq.isKit && eq.kitItems.length) {
      for (const k of eq.kitItems) push(k.equipmentId, k.qty * qty, l, sp, depth + 1);
    } else {
      const [start, end] = blockPeriod(sp);
      // un consommable vendu ne revient pas
      const sold = eq.kind === 'vente';
      if (sold && l.consumed) return;
      out.push({ equipmentId: eqId, qty, start, end: sold ? FOREVER : end, lineId: l.id, subprojectId: sp.id, projectId: sp.projectId, source: 'projet' });
    }
  };
  for (const l of lines) {
    const sp = subMap.get(l.subprojectId);
    if (!sp || !l.equipmentId || l.optional || !RESERVING.includes(sp.status)) continue;
    push(l.equipmentId, l.qty, l, sp, 0);
  }
  for (const r of extras.repairs || []) {
    if (r.status !== 'ouvert') continue;
    out.push({ equipmentId: r.equipmentId, qty: r.qty, start: r.start, end: r.end || FOREVER, lineId: r.id, subprojectId: '', projectId: '', source: 'reparation' });
  }
  for (const sr of extras.subrentals || []) {
    if (sr.status !== 'confirme' && sr.status !== 'recu') continue;
    for (const l of sr.lines) {
      if (l.equipmentId) out.push({ equipmentId: l.equipmentId, qty: -l.qty, start: sr.start, end: sr.end, lineId: sr.id, subprojectId: sr.subprojectId || '', projectId: sr.projectId, source: 'souslocation' });
    }
  }
  return out;
}

/** Pic de quantité réservée sur la période (balayage des intervalles). */
export function peakReserved(res: Reservation[], equipmentId: string, start: string, end: string, excludeLineId?: string): number {
  const events: [string, number][] = [];
  for (const r of res) {
    if (r.equipmentId !== equipmentId || r.lineId === excludeLineId) continue;
    if (!overlaps(r.start, r.end, start, end)) continue;
    events.push([r.start < start ? start : r.start, r.qty]);
    events.push([r.end > end ? end : r.end, -r.qty]);
  }
  events.sort((a, b) => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1));
  let cur = 0, peak = 0;
  for (const [, d] of events) {
    cur += d;
    peak = Math.max(peak, cur);
  }
  return peak;
}

/** Quantité encore disponible (un kit = min de ses composants). */
export function availableQty(
  eq: Equipment, all: Equipment[], res: Reservation[], start: string, end: string, excludeLineId?: string,
): number {
  if (eq.isKit && eq.kitItems.length) {
    const map = new Map(all.map((e) => [e.id, e]));
    let min = Infinity;
    for (const k of eq.kitItems) {
      const c = map.get(k.equipmentId);
      if (!c) return 0;
      min = Math.min(min, Math.floor(availableQty(c, all, res, start, end, excludeLineId) / Math.max(1, k.qty)));
    }
    return min === Infinity ? 0 : min;
  }
  return eq.quantity - peakReserved(res, eq.id, start, end, excludeLineId);
}

export interface Conflict {
  equipment: Equipment;
  subprojectId: string;
  projectId: string;
  shortage: number;
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
    const peak = peakReserved(res, eq.id, r.start, r.end === FOREVER ? r.start : r.end);
    if (peak > eq.quantity) out.push({ equipment: eq, subprojectId: r.subprojectId, projectId: r.projectId, shortage: peak - eq.quantity });
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
  await db.transaction('rw', [db.projects, db.subprojects, db.lines, db.crew, db.vehicleAssignments, db.docs, db.subrentals, db.costs], async () => {
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
  await db.transaction('rw', [db.subprojects, db.lines, db.crew, db.vehicleAssignments], async () => {
    await db.lines.where({ subprojectId }).delete();
    await db.crew.where({ subprojectId }).delete();
    await db.vehicleAssignments.where({ subprojectId }).delete();
    await db.subprojects.delete(subprojectId);
  });
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
