import type { Category, Equipment, SerialUnit, Settings } from './types';

/*
 * Codes du matériel : F-S-0010
 *   F    = lettre du dépôt de base de l'article (demandée à la création du dépôt)
 *   S    = lettre de la catégorie (S son, V vidéo, L lumière, IT informatique, R rigging…) ; K pour un kit
 *   0010 = numéro unique de l'article (jamais réutilisé, toutes catégories confondues)
 * Unité sérialisée : le code de l'article + son numéro d'unité sur 2 caractères : F-S-0010-03.
 * Au-delà de 99 unités, on passe en hexadécimal : 0A, 0B… FF (sans jamais retomber sur 00-99), soit 255 unités.
 */

/** Lettres proposées pour les catégories courantes (modifiables dans Paramètres). */
const CATEGORY_HINTS: [RegExp, string][] = [
  [/^(son|audio|sono)/i, 'S'], [/^vid[eé]o/i, 'V'], [/^(lumi[eè]re|light|[eé]clairage)/i, 'L'],
  [/^(informatique|it\b|r[eé]seau)/i, 'IT'], [/^(rigging|structure|levage|truss)/i, 'R'], [/^(c[aâ]bl)/i, 'C'],
  [/^([eé]nergie|[eé]lectricit[eé]|alimentation)/i, 'E'], [/^(consommable)/i, 'CO'], [/^(kit|pack)/i, 'K'],
  [/^(sc[eè]ne|pratic)/i, 'SC'], [/^(mobilier|d[eé]co)/i, 'M'], [/^(transport|flight|case)/i, 'FC'],
];

export const cleanLetter = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);

/** Lettre proposée pour une nouvelle catégorie (évite celles déjà prises). */
export function suggestCategoryLetter(name: string, taken: string[] = []): string {
  const hit = CATEGORY_HINTS.find(([re]) => re.test(name.trim()))?.[1];
  if (hit && !taken.includes(hit)) return hit;
  const base = cleanLetter(name);
  for (const cand of [base.slice(0, 1), base.slice(0, 2), base.slice(0, 3)]) if (cand && !taken.includes(cand)) return cand;
  return base.slice(0, 3) || 'X';
}

/** Lettre d'un dépôt (sinon celle de la société, F par défaut). */
export function depotLetter(s: Pick<Settings, 'depots' | 'codeLetter'>, depotId?: string): string {
  const d = s.depots?.find((x) => x.id === depotId) || s.depots?.[0];
  return d?.letter || s.codeLetter || 'F';
}

/** lettre d'une catégorie ; une sous-catégorie sans lettre propre prend celle de sa catégorie principale */
export function categoryLetter(c?: Pick<Category, 'name' | 'letter' | 'parentId'>, cats: Pick<Category, 'id' | 'name' | 'letter'>[] = []): string {
  if (c && !c.letter && c.parentId) {
    const p = cats.find((x) => x.id === c.parentId);
    if (p) return categoryLetter(p);
  }
  return c?.letter || (c ? suggestCategoryLetter(c.name) : 'X');
}

const CODE_RE = /^[A-Z]{1,3}-[A-Z]{1,3}-(\d{4,})$/;

/** Prochain numéro d'article : le plus grand déjà utilisé + 1. */
export function nextArticleNumber(all: Pick<Equipment, 'code'>[]): number {
  let max = 0;
  for (const e of all) {
    const m = (e.code || '').match(CODE_RE);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return max + 1;
}

export function articleCode(depot: string, cat: string, n: number): string {
  return `${depot}-${cat}-${String(n).padStart(4, '0')}`;
}

/** Code proposé pour un nouvel article. */
export function newArticleCode(e: Pick<Equipment, 'categoryId' | 'isKit' | 'homeDepotId'>, s: Pick<Settings, 'depots' | 'codeLetter'>, cats: Category[], all: Pick<Equipment, 'code'>[]): string {
  const cat = e.isKit ? 'K' : categoryLetter(cats.find((c) => c.id === e.categoryId), cats);
  return articleCode(depotLetter(s, e.homeDepotId), cat, nextArticleNumber(all));
}

/* ---------- unités ---------- */

/** Les 256 suffixes sur 2 caractères : 00-99 d'abord, puis ceux qui contiennent une lettre hexadécimale (0A, 0B… FF). */
const SUFFIXES: string[] = (() => {
  const all = Array.from({ length: 256 }, (_, i) => i.toString(16).toUpperCase().padStart(2, '0'));
  return [...all.filter((x) => /^\d\d$/.test(x)).sort(), ...all.filter((x) => /[A-F]/.test(x))];
})();

/** Suffixe de la n-ième unité (1 → « 01 », 99 → « 99 », 100 → « 0A », 255 → « FF »). */
export function unitSuffix(n: number): string {
  if (n >= 1 && n < SUFFIXES.length) return SUFFIXES[n];
  return n.toString(16).toUpperCase().padStart(3, '0'); // au-delà de 255 : 3 caractères
}
function suffixIndex(s: string): number {
  return SUFFIXES.indexOf(s.toUpperCase());
}

/** Code de la prochaine unité d'un article : rang suivant le plus grand déjà attribué. */
export function nextUnitCode(e: Pick<Equipment, 'code'>, units: Pick<SerialUnit, 'barcode' | 'serial'>[]): string {
  const base = e.code || 'X';
  let max = 0;
  for (const u of units) {
    for (const c of [u.barcode, u.serial]) {
      if (!c?.startsWith(base + '-')) continue;
      const i = suffixIndex(c.slice(base.length + 1));
      if (i > max) max = i;
      else if (i < 0 && /^[0-9A-F]{3}$/i.test(c.slice(base.length + 1))) max = Math.max(max, parseInt(c.slice(base.length + 1), 16));
    }
  }
  return `${base}-${unitSuffix(Math.max(max, units.length) + 1)}`;
}
