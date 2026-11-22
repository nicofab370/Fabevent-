import { NO_CATEGORY, categoryTree } from '../categories';
import type { Category } from '../types';

/**
 * options d'un <select> de catégorie : principales, puis leurs sous-catégories en retrait.
 * `filter` : pour filtrer une liste (doublons de nom fusionnés, option « Sans catégorie »).
 */
export function CategoryOptions({ cats, count, filter }: { cats: Category[]; count?: (id: string) => number; filter?: boolean }) {
  return (
    <>
      {categoryTree(cats, filter).map(({ cat, sub }) => {
        const n = count?.(cat.id);
        return <option key={cat.id} value={cat.id}>{(sub ? '   › ' : '') + cat.name + (n != null ? ` (${n})` : '')}</option>;
      })}
      {filter && <option value={NO_CATEGORY}>Sans catégorie</option>}
    </>
  );
}
