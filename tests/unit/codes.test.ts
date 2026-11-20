import { describe, expect, it } from 'vitest';
import { articleCode, depotLetter, newArticleCode, nextArticleNumber, nextUnitCode, suggestCategoryLetter, unitSuffix } from '../../src/codegen';
import type { Category } from '../../src/types';

const cat = (id: string, name: string, letter?: string) => ({ id, name, letter, createdAt: '', updatedAt: '' }) as Category;

describe('codes du matériel F-S-0010', () => {
  it('lettres de catégorie proposées', () => {
    expect(suggestCategoryLetter('Son')).toBe('S');
    expect(suggestCategoryLetter('Vidéo')).toBe('V');
    expect(suggestCategoryLetter('Lumière')).toBe('L');
    expect(suggestCategoryLetter('Informatique')).toBe('IT');
    expect(suggestCategoryLetter('Rigging')).toBe('R');
    expect(suggestCategoryLetter('Scénographie', ['S', 'SC'])).toBe('SCE');
  });
  it('lettre du dépôt de base (sinon celle de la société, F par défaut)', () => {
    const s = { depots: [{ id: 'a', name: 'Liège', letter: 'F' }, { id: 'b', name: 'Namur', letter: 'N' }] };
    expect(depotLetter(s, 'b')).toBe('N');
    expect(depotLetter(s)).toBe('F');
    expect(depotLetter({ depots: [] })).toBe('F');
    expect(depotLetter({ codeLetter: 'G' })).toBe('G');
  });
  it('numéro unique, jamais réutilisé, toutes catégories confondues', () => {
    expect(nextArticleNumber([{ code: 'F-S-0010' }, { code: 'N-L-0051' }, { code: 'Ancien code' }, {}])).toBe(52);
    expect(articleCode('F', 'S', 7)).toBe('F-S-0007');
    const cats = [cat('c1', 'Son', 'S'), cat('c2', 'Vidéo')];
    const s = { depots: [{ id: 'a', name: 'Liège', letter: 'F' }, { id: 'b', name: 'Namur', letter: 'N' }] };
    expect(newArticleCode({ categoryId: 'c2', isKit: false, homeDepotId: 'b' }, s, cats, [{ code: 'F-S-0010' }])).toBe('N-V-0011');
    expect(newArticleCode({ categoryId: 'c1', isKit: true }, s, cats, [])).toBe('F-K-0001');
  });
  it('unités : 2 chiffres, puis hexadécimal au-delà de 99 sans retomber sur un code déjà pris', () => {
    expect(unitSuffix(3)).toBe('03');
    expect(unitSuffix(99)).toBe('99');
    expect(unitSuffix(100)).toBe('0A');
    expect(unitSuffix(101)).toBe('0B');
    expect(unitSuffix(255)).toBe('FF');
    const all = new Set(Array.from({ length: 255 }, (_, i) => unitSuffix(i + 1)));
    expect(all.size).toBe(255); // aucun doublon
    expect(nextUnitCode({ code: 'F-S-0010' }, [])).toBe('F-S-0010-01');
    expect(nextUnitCode({ code: 'F-S-0010' }, [{ barcode: 'F-S-0010-01', serial: 'X' }, { barcode: 'F-S-0010-04', serial: 'Y' }])).toBe('F-S-0010-05');
    const many = Array.from({ length: 99 }, (_, i) => ({ barcode: `F-S-0010-${unitSuffix(i + 1)}`, serial: '' }));
    expect(nextUnitCode({ code: 'F-S-0010' }, many)).toBe('F-S-0010-0A');
  });
});
