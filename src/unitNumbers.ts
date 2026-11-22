import { db } from './db';
import type { SerialUnit } from './types';
import { nowIso } from './utils';

/*
 * Numéro d'unité (#1, #2…) : chaque unité d'un article sérialisé reçoit un numéro fixe, propre à l'article.
 * Attribué à la création (le plus grand + 1) ; jamais réutilisé ni décalé quand une unité est supprimée.
 */

/** « #3 » (vide si l'unité n'a pas encore de numéro) */
export const unitNo = (u: Pick<SerialUnit, 'number'>): string => (u.number ? `#${u.number}` : '');

/** « #3 · F-S-0010-03 » : numéro puis code (ou n° de série) */
export const unitTitle = (u: Pick<SerialUnit, 'number' | 'barcode' | 'serial'>): string => [unitNo(u), u.barcode || u.serial].filter(Boolean).join(' · ');

/** numéro suivant pour un article, parmi ses unités */
export const nextNumber = (units: Pick<SerialUnit, 'number'>[]): number => units.reduce((m, u) => Math.max(m, u.number || 0), 0) + 1;

/**
 * Numéros manquants (unités créées avant cette version, importées ou reçues d'un autre appareil) :
 * par article, dans l'ordre de création, à la suite des numéros existants. Renvoie les unités à modifier.
 */
export function missingNumbers<T extends SerialUnit>(units: T[]): T[] {
  const byEq = new Map<string, T[]>();
  for (const u of units) byEq.set(u.equipmentId, [...(byEq.get(u.equipmentId) || []), u]);
  const out: T[] = [];
  for (const list of byEq.values()) {
    let n = nextNumber(list);
    const todo = list.filter((u) => !u.number).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '') || (a.barcode || a.serial).localeCompare(b.barcode || b.serial, 'fr', { numeric: true }));
    for (const u of todo) out.push({ ...u, number: n++ });
  }
  return out;
}

/** donne un numéro aux unités qui n'en ont pas (au démarrage et après une synchronisation) */
export async function ensureUnitNumbers(): Promise<number> {
  const todo = missingNumbers(await db.units.toArray());
  if (todo.length) await db.units.bulkPut(todo.map((u) => ({ ...u, updatedAt: nowIso() })));
  return todo.length;
}
