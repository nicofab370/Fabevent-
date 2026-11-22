import { categoryTree } from '../categories';
import type { Category } from '../types';

/** options d'un <select> de catégorie : principales, puis leurs sous-catégories en retrait */
export function CategoryOptions({ cats, count }: { cats: Category[]; count?: (id: string) => number }) {
  return (
    <>
      {categoryTree(cats).map(({ cat, sub }) => {
        const n = count?.(cat.id);
        return <option key={cat.id} value={cat.id}>{(sub ? '   › ' : '') + cat.name + (n != null ? ` (${n})` : '')}</option>;
      })}
    </>
  );
}
