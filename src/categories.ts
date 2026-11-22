import type { Category } from './types';

/*
 * Catégories et sous-catégories (un niveau : Son › Micro, Son › Console…).
 * Un article est rangé dans une catégorie ou une sous-catégorie ; filtrer sur une catégorie
 * principale montre aussi le matériel de ses sous-catégories.
 */

type Cat = Pick<Category, 'id' | 'name' | 'parentId'>;

const byName = (a: Cat, b: Cat) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
/**
 * catégorie principale d'une sous-catégorie : on remonte jusqu'en haut (un import peut créer plus de deux niveaux) ;
 * une sous-catégorie dont la catégorie principale a disparu redevient principale
 */
const parentOf = <T extends Cat>(cats: T[], c: T): T | undefined => {
  let p = c.parentId ? cats.find((x) => x.id === c.parentId) : undefined;
  const seen = new Set([c.id]);
  while (p?.parentId && !seen.has(p.id)) {
    seen.add(p.id);
    const up = cats.find((x) => x.id === p!.parentId);
    if (!up || seen.has(up.id)) break;
    p = up;
  }
  return p && p.id !== c.id ? p : undefined;
};
/** catégorie principale de la catégorie `id` (elle-même si elle est principale) */
export const topCategory = <T extends Cat>(cats: T[], id?: string): T | undefined => {
  const c = id ? cats.find((x) => x.id === id) : undefined;
  return c ? parentOf(cats, c) || c : undefined;
};
const norm = (s: string) => s.trim().toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
/** garde une seule catégorie par nom (catégories en double après plusieurs imports ou appareils) */
const uniqByName = <T extends Cat>(l: T[]): T[] => { const seen = new Set<string>(); return l.filter((c) => !seen.has(norm(c.name)) && !!seen.add(norm(c.name))); };

export const mainCategories = <T extends Cat>(cats: T[], dedupe = false): T[] => { const l = cats.filter((c) => !parentOf(cats, c)).sort(byName); return dedupe ? uniqByName(l) : l; };
export const subCategories = <T extends Cat>(cats: T[], parentId: string, dedupe = false): T[] => {
  const top = cats.find((c) => c.id === parentId);
  // avec dedupe : les sous-catégories de toutes les catégories principales du même nom
  const l = cats.filter((c) => { const p = parentOf(cats, c); return !!p && (dedupe && top ? norm(p.name) === norm(top.name) : p.id === parentId); }).sort(byName);
  return dedupe ? uniqByName(l) : l;
};

/** liste ordonnée : chaque catégorie principale suivie de ses sous-catégories */
export function categoryTree<T extends Cat>(cats: T[], dedupe = false): { cat: T; sub: boolean; label: string }[] {
  const out: { cat: T; sub: boolean; label: string }[] = [];
  for (const m of mainCategories(cats, dedupe)) {
    out.push({ cat: m, sub: false, label: m.name });
    for (const s of subCategories(cats, m.id, dedupe)) out.push({ cat: s, sub: true, label: `${m.name} › ${s.name}` });
  }
  return out;
}

/** « Son › Micro » (ou « Son ») */
export function categoryLabel(cats: Cat[], id?: string): string {
  const c = id ? cats.find((x) => x.id === id) : undefined;
  if (!c) return '';
  const p = parentOf(cats, c);
  return p ? `${p.name} › ${c.name}` : c.name;
}

/** l'article (catégorie categoryId) entre-t-il dans le filtre ? une catégorie principale inclut ses sous-catégories */
export function inCategory(cats: Cat[], categoryId: string | undefined, filter: string, strict = false): boolean {
  if (!filter) return true;
  if (categoryId === filter) return true;
  const c = categoryId ? cats.find((x) => x.id === categoryId) : undefined;
  if (filter === NO_CATEGORY) return !c;
  if (!c) return false;
  const p = parentOf(cats, c);
  if (p?.id === filter) return true;
  if (strict) return false;
  // même nom = même catégorie (doublons créés par plusieurs imports ou appareils)
  const f = cats.find((x) => x.id === filter);
  if (!f) return false;
  const fp = parentOf(cats, f);
  if (!fp) return norm((p || c).name) === norm(f.name);
  return !!p && norm(p.name) === norm(fp.name) && norm(c.name) === norm(f.name);
}

/** filtre « sans catégorie » (ou catégorie supprimée) */
export const NO_CATEGORY = '__sans';
