import { describe, expect, it } from 'vitest';
import { categoryLabel, categoryTree, inCategory } from '../../src/categories';

const cats = [
  { id: 'son', name: 'Son' }, { id: 'lum', name: 'Lumière' },
  { id: 'micro', name: 'Micro', parentId: 'son' }, { id: 'console', name: 'Console', parentId: 'son' },
  { id: 'orphan', name: 'Orpheline', parentId: 'disparue' },
];

describe('catégories et sous-catégories', () => {
  it('arbre : principales triées, sous-catégories sous leur parent', () => {
    expect(categoryTree(cats).map((x) => x.label)).toEqual(['Lumière', 'Orpheline', 'Son', 'Son › Console', 'Son › Micro']);
  });
  it('libellé complet', () => {
    expect(categoryLabel(cats, 'micro')).toBe('Son › Micro');
    expect(categoryLabel(cats, 'son')).toBe('Son');
    expect(categoryLabel(cats, undefined)).toBe('');
  });
  it('filtrer sur une catégorie principale inclut ses sous-catégories', () => {
    expect(inCategory(cats, 'micro', 'son')).toBe(true);
    expect(inCategory(cats, 'son', 'son')).toBe(true);
    expect(inCategory(cats, 'micro', 'micro')).toBe(true);
    expect(inCategory(cats, 'son', 'micro')).toBe(false);
    expect(inCategory(cats, 'lum', 'son')).toBe(false);
    expect(inCategory(cats, undefined, '')).toBe(true);
  });
});

import { categoryLetter } from '../../src/codegen';
describe('lettre des sous-catégories', () => {
  it('reprend la lettre de la catégorie principale', () => {
    const all = [{ id: 'son', name: 'Son', letter: 'S' }, { id: 'micro', name: 'Micro', parentId: 'son' }, { id: 'hp', name: 'Haut-parleurs', parentId: 'son', letter: 'HP' }];
    expect(categoryLetter(all[1], all)).toBe('S');
    expect(categoryLetter(all[2], all)).toBe('HP');
  });
});
