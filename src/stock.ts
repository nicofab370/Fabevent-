/**
 * Stock projeté des consommables : stock actuel, moins les quantités prévues dans les projets à venir
 * (pas encore sorties du stock), plus ou moins les mouvements programmés (livraison attendue…).
 * Sert au seuil de réapprovisionnement (stock critique) : date à laquelle le seuil sera atteint.
 */
import type { Equipment } from './types';

export interface StockUse { date: string; qty: number }

export function projectedStock(e: Pick<Equipment, 'quantity' | 'criticalStock' | 'plannedStock'>, today: string, uses: StockUse[] = []) {
  const events = [
    ...(e.plannedStock || []).filter((m) => m.date.slice(0, 10) >= today).map((m) => ({ date: m.date.slice(0, 10), delta: m.delta })),
    ...uses.map((u) => ({ date: u.date.slice(0, 10) < today ? today : u.date.slice(0, 10), delta: -u.qty })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let v = e.quantity || 0, min = v, reachDate: string | undefined;
  const limit = e.criticalStock || 0;
  if (limit && v <= limit) reachDate = today;
  for (const ev of events) {
    v += ev.delta;
    if (v < min) min = v;
    if (limit && !reachDate && v <= limit) reachDate = ev.date;
  }
  return { now: e.quantity || 0, end: v, min, reachDate };
}
