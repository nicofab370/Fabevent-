/** Filtre de période prédéfini (semaine prochaine, ce mois, jusqu'à aujourd'hui…) pour les listes. */
const DAY = 86400000;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const PERIOD_PRESETS: Record<string, string> = {
  '': 'Toutes les dates', today: 'Aujourd’hui', week: 'Cette semaine', nextweek: 'Semaine prochaine', lastweek: 'Semaine dernière',
  month: 'Ce mois-ci', nextmonth: 'Mois prochain', untiltoday: 'Jusqu’à aujourd’hui', untilnextmonth: 'Jusqu’au mois prochain', future: 'À venir',
};

/** Bornes [début, fin] (AAAA-MM-JJ, incluses) d'une période prédéfinie ; null = pas de filtre. */
export function presetRange(key: string, now = new Date()): [string, string] | null {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
  switch (key) {
    case 'today': return [ymd(now), ymd(now)];
    case 'week': return [ymd(monday), ymd(addDays(monday, 6))];
    case 'nextweek': return [ymd(addDays(monday, 7)), ymd(addDays(monday, 13))];
    case 'lastweek': return [ymd(addDays(monday, -7)), ymd(addDays(monday, -1))];
    case 'month': return [ymd(new Date(now.getFullYear(), now.getMonth(), 1)), ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0))];
    case 'nextmonth': return [ymd(new Date(now.getFullYear(), now.getMonth() + 1, 1)), ymd(new Date(now.getFullYear(), now.getMonth() + 2, 0))];
    case 'untiltoday': return ['0000-01-01', ymd(now)];
    case 'untilnextmonth': return ['0000-01-01', ymd(new Date(now.getFullYear(), now.getMonth() + 2, 0))];
    case 'future': return [ymd(now), '9999-12-31'];
    default: return null;
  }
}

/** Une période [start, end] croise-t-elle la période prédéfinie ? */
export function inPreset(key: string, start?: string, end?: string): boolean {
  const r = presetRange(key);
  if (!r) return true;
  const a = (start || end || '').slice(0, 10), b = (end || start || '').slice(0, 10);
  return !!a && a <= r[1] && b >= r[0];
}

export function PeriodFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Période">
      {Object.entries(PERIOD_PRESETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </select>
  );
}
