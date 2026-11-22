import type { Category } from './types';

/*
 * Catégories et sous-catégories (un niveau : Son › Micro, Son › Console…).
 * Un article est rangé dans une catégorie ou une sous-catégorie ; filtrer sur une catégorie
 * principale montre aussi le matériel de ses sous-catégories.
 */

type Cat = Pick<Category, 'id' | 'name' | 'parentId'>;

const byName = (a: Cat, b: Cat) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' });
/** une sous-catégorie dont la catégorie principale a disparu redevient principale */
const parentOf = <T extends Cat>(cats: T[], c: T): T | undefined => (c.parentId ? cats.find((x) => x.id === c.parentId && !x.parentId) : undefined);

export const mainCategories = <T extends Cat>(cats: T[]): T[] => cats.filter((c) => !parentOf(cats, c)).sort(byName);
export const subCategories = <T extends Cat>(cats: T[], parentId: string): T[] => cats.filter((c) => c.parentId === parentId && parentOf(cats, c)).sort(byName);

/** liste ordonnée : chaque catégorie principale suivie de ses sous-catégories */
export function categoryTree<T extends Cat>(cats: T[]): { cat: T; sub: boolean; label: string }[] {
  const out: { cat: T; sub: boolean; label: string }[] = [];
  for (const m of mainCategories(cats)) {
    out.push({ cat: m, sub: false, label: m.name });
    for (const s of subCategories(cats, m.id)) out.push({ cat: s, sub: true, label: `${m.name} › ${s.name}` });
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
export function inCategory(cats: Cat[], categoryId: string | undefined, filter: string): boolean {
  if (!filter) return true;
  if (categoryId === filter) return true;
  const c = categoryId ? cats.find((x) => x.id === categoryId) : undefined;
  return !!c && parentOf(cats, c)?.id === filter;
}
