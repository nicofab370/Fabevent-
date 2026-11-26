/**
 * Opérations sur un projet entier : copie (duplication, modèle, récurrence) et décalage dans le temps.
 */
import { db, nextNumber } from './db';
import type { Project, ProjectStatus, Subproject } from './types';
import { nowIso, save, toLocalInput, uid } from './utils';

/** Décalage en jours calendaires + minutes (robuste aux changements d'heure). */
export interface Shift { days: number; minutes: number }

export function shiftDate(s: string | undefined, sh: Shift): string | undefined {
  if (!s) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  d.setDate(d.getDate() + sh.days);
  d.setMinutes(d.getMinutes() + sh.minutes);
  return s.length <= 10 ? toLocalInput(d).slice(0, 10) : toLocalInput(d);
}

/** Écart entre deux dates locales, exprimé en jours + minutes. */
export function shiftBetween(from: string, to: string): Shift {
  const a = new Date(from), b = new Date(to);
  const dayA = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const dayB = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  const days = Math.round((dayB.getTime() - dayA.getTime()) / 86400000);
  const minutes = (b.getHours() * 60 + b.getMinutes()) - (a.getHours() * 60 + a.getMinutes());
  return { days, minutes };
}

function shiftSub<T extends Pick<Subproject, 'start' | 'end' | 'prepStart' | 'returnEnd' | 'periods'>>(sp: T, sh: Shift): T {
  return {
    ...sp, start: shiftDate(sp.start, sh)!, end: shiftDate(sp.end, sh)!, prepStart: shiftDate(sp.prepStart, sh), returnEnd: shiftDate(sp.returnEnd, sh),
    periods: sp.periods?.map((p) => ({ ...p, start: shiftDate(p.start, sh)!, end: shiftDate(p.end, sh)! })),
  };
}

/** Recalcule le début et la fin du projet à partir de ses salles. */
async function refreshProjectDates(projectId: string) {
  const p = await db.projects.get(projectId);
  const subs = await db.subprojects.where({ projectId }).toArray();
  if (!p || !subs.length) return;
  const start = subs.map((s) => s.prepStart && s.prepStart < s.start ? s.prepStart : s.start).sort()[0];
  const end = subs.map((s) => s.returnEnd && s.returnEnd > s.end ? s.returnEnd : s.end).sort().at(-1)!;
  if (start !== p.start || end !== p.end) await save(db.projects, { ...p, start, end });
}

/**
 * Décale tout ou partie d'un projet : créneaux, salles, postes, véhicules
 * et, si demandé, ses sous-locations et transferts.
 */
export async function shiftProject(projectId: string, sh: Shift, opts: { subIds?: string[]; withOrders?: boolean } = {}) {
  if (!sh.days && !sh.minutes) return;
  const subs = (await db.subprojects.where({ projectId }).toArray()).filter((s) => !opts.subIds || opts.subIds.includes(s.id));
  const ids = new Set(subs.map((s) => s.id));
  for (const sp of subs) await save(db.subprojects, shiftSub(sp, sh));
  for (const c of await db.crew.where({ projectId }).toArray()) {
    if (ids.has(c.subprojectId)) await save(db.crew, { ...c, start: shiftDate(c.start, sh)!, end: shiftDate(c.end, sh)! });
  }
  for (const v of await db.vehicleAssignments.where({ projectId }).toArray()) {
    if (ids.has(v.subprojectId)) await save(db.vehicleAssignments, { ...v, start: shiftDate(v.start, sh)!, end: shiftDate(v.end, sh)! });
  }
  if (opts.withOrders !== false) {
    for (const r of await db.subrentals.where({ projectId }).toArray()) {
      if (!r.subprojectId || ids.has(r.subprojectId)) await save(db.subrentals, { ...r, start: shiftDate(r.start, sh)!, end: shiftDate(r.end, sh)! });
    }
    for (const t of (await db.transfers.toArray()).filter((x) => x.projectId === projectId && x.status === 'planifie')) {
      await save(db.transfers, { ...t, start: shiftDate(t.start, sh)!, end: shiftDate(t.end, sh) });
    }
  }
  await refreshProjectDates(projectId);
}

interface CopyOptions {
  name?: string;
  status?: ProjectStatus;
  isTemplate?: boolean;
  shift?: Shift;
  /** garder les personnes affectées aux postes (récurrences) */
  keepPeople?: boolean;
  /** nouvelle édition du même évènement : relie les deux projets */
  edition?: boolean;
}

/** Copie complète d'un projet : salles, horaires, groupes, matériel, postes, véhicules, coûts. */
export async function copyProject(projectId: string, o: CopyOptions = {}): Promise<Project> {
  const src = await db.projects.get(projectId);
  if (!src) throw new Error('Projet introuvable');
  const sh = o.shift || { days: 0, minutes: 0 };
  const [subs, lines, crew, vas, costs] = await Promise.all([
    db.subprojects.where({ projectId }).toArray(), db.lines.where({ projectId }).toArray(), db.crew.where({ projectId }).toArray(),
    db.vehicleAssignments.where({ projectId }).toArray(), db.costs.where({ projectId }).toArray(),
  ]);
  const np = await save(db.projects, {
    ...src, id: undefined, createdAt: undefined, number: await nextNumber('P'), name: o.name ?? src.name + ' (copie)',
    status: o.status ?? 'brouillon', isTemplate: o.isTemplate || undefined, start: shiftDate(src.start, sh)!, end: shiftDate(src.end, sh)!,
    tasks: src.tasks?.map((t) => ({ ...t, id: uid(), done: false, due: shiftDate(t.due, sh) })),
    // ce qui appartient à l'édition copiée ne suit pas : référence de commande, facturation, coûts réels, caution réglée
    externalRef: undefined, externalInvoiced: undefined, confirmedAt: undefined, actualCosts: undefined,
    deposit: src.deposit ? { amount: src.deposit.amount, status: src.deposit.status === 'aucune' ? 'aucune' : 'demandee' } : undefined,
    editionOf: o.edition ? src.editionOf || src.id : undefined,
  });
  for (const sp of subs) {
    const idMap = new Map<string, string>();
    const periods = sp.periods?.map((p) => { const nid = uid(); idMap.set(p.id, nid); return { ...p, id: nid }; });
    const groups = sp.groups?.map((g) => { const nid = uid(); idMap.set(g.id, nid); return { ...g, id: nid, periodIds: g.periodIds.map((x) => idMap.get(x) || x) }; });
    const ns = await save(db.subprojects, shiftSub({ ...sp, id: undefined, createdAt: undefined, projectId: np.id, status: np.status, periods, groups }, sh));
    const own = lines.filter((x) => x.subprojectId === sp.id);
    for (const l of own) idMap.set(l.id, uid());
    for (const l of own) {
      await db.lines.put({
        ...l, id: idMap.get(l.id)!, createdAt: nowIso(), updatedAt: nowIso(), projectId: np.id, subprojectId: ns.id, groupId: l.groupId ? idMap.get(l.groupId) : undefined,
        parentLineId: l.parentLineId ? idMap.get(l.parentLineId) : undefined, outQty: undefined, inQty: undefined, outSerials: undefined, inSerials: undefined, consumed: undefined,
      });
    }
    for (const c of crew.filter((x) => x.subprojectId === sp.id)) {
      await save(db.crew, {
        ...c, id: undefined, createdAt: undefined, projectId: np.id, subprojectId: ns.id, personId: o.keepPeople ? c.personId : undefined,
        periodId: c.periodId ? idMap.get(c.periodId) : undefined, start: shiftDate(c.start, sh)!, end: shiftDate(c.end, sh)!,
      });
    }
    for (const v of vas.filter((x) => x.subprojectId === sp.id)) {
      await save(db.vehicleAssignments, {
        ...v, id: undefined, createdAt: undefined, projectId: np.id, subprojectId: ns.id, periodId: v.periodId ? idMap.get(v.periodId) : undefined,
        start: shiftDate(v.start, sh)!, end: shiftDate(v.end, sh)!,
      });
    }
  }
  for (const c of costs) await save(db.costs, { ...c, id: undefined, createdAt: undefined, projectId: np.id });
  return np;
}

/** Dates de début des occurrences d'un projet récurrent. */
export function recurrenceStarts(start: string, freq: 'semaine' | '2semaines' | 'mois', count: number): string[] {
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(start);
    if (freq === 'mois') d.setMonth(d.getMonth() + i);
    else d.setDate(d.getDate() + i * (freq === 'semaine' ? 7 : 14));
    out.push(toLocalInput(d));
  }
  return out;
}
