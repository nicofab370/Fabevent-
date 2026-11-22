import { describe, expect, it } from 'vitest';
import { NO_CATEGORY, categoryLabel, categoryTree, inCategory, mainCategories, subCategories, topCategory } from '../../src/categories';

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

describe('filtre robuste aux catégories importées', () => {
  // deux « Son » (deux imports ou deux appareils), un troisième niveau, un article sans catégorie
  const cats = [
    { id: 's1', name: 'Son' }, { id: 's2', name: 'son' },
    { id: 'm1', name: 'Micro', parentId: 's1' }, { id: 'm2', name: 'Micro', parentId: 's2' },
    { id: 'hf', name: 'Sans fil', parentId: 'm1' },
  ];
  it('les doublons de nom filtrent ensemble', () => {
    expect(inCategory(cats, 'm2', 's1')).toBe(true);
    expect(inCategory(cats, 'm2', 'm1')).toBe(true);
    expect(inCategory(cats, 's2', 's1')).toBe(true);
    expect(inCategory(cats, 'm2', 's1', true)).toBe(false);
    expect(mainCategories(cats, true).map((c) => c.id)).toEqual(['s1']);
    expect(subCategories(cats, 's1', true).map((c) => c.name)).toEqual(['Micro', 'Sans fil']);
  });
  it('un troisième niveau est rangé sous la catégorie principale', () => {
    expect(mainCategories(cats).some((c) => c.id === 'hf')).toBe(false);
    expect(inCategory(cats, 'hf', 's1')).toBe(true);
    expect(topCategory(cats, 'hf')?.id).toBe('s1');
    expect(categoryLabel(cats, 'hf')).toBe('Son › Sans fil');
  });
  it('« Sans catégorie » : aucune ou supprimée', () => {
    expect(inCategory(cats, undefined, NO_CATEGORY)).toBe(true);
    expect(inCategory(cats, 'disparue', NO_CATEGORY)).toBe(true);
    expect(inCategory(cats, 'm1', NO_CATEGORY)).toBe(false);
  });
});
