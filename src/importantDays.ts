/**
 * Jours importants (Paramètres) : fériés, salons, fermetures… Signalés dans le planning, l'attribution et les créneaux
 * des projets (icône parapluie, message). Rien n'est bloqué.
 */
import type { ImportantDay, Settings } from './types';

/** Jours importants d'une date (AAAA-MM-JJ), en tenant compte de ceux qui se répètent chaque année. */
export function importantOn(date: string, days: ImportantDay[] = []): ImportantDay[] {
  const d = date.slice(0, 10);
  return days.filter((x) => (x.yearly ? x.date.slice(5, 10) === d.slice(5, 10) : x.date.slice(0, 10) === d));
}

/** Jours importants compris dans une période (début et fin inclus). */
export function importantBetween(start: string, end: string, s: Pick<Settings, 'importantDays'>): { date: string; day: ImportantDay }[] {
  const out: { date: string; day: ImportantDay }[] = [];
  if (!s.importantDays?.length || !start || !end || end < start) return out;
  const t0 = Date.parse(start.slice(0, 10) + 'T12:00'), t1 = Date.parse(end.slice(0, 10) + 'T12:00');
  for (let t = t0, i = 0; t <= t1 && i < 400; t += 86400000, i++) {
    const date = new Date(t).toISOString().slice(0, 10);
    for (const day of importantOn(date, s.importantDays)) out.push({ date, day });
  }
  return out;
}

export const importantLabel = (list: { date: string; day: ImportantDay }[]) =>
  list.map((x) => `${x.day.name} (${new Date(x.date + 'T12:00').toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' })})`).join(', ');
