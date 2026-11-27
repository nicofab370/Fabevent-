import { describe, expect, it } from 'vitest';
import { compareKeys, sortKey } from '../../src/tableSort';

const sorted = (xs: string[], dir: 'asc' | 'desc' = 'asc') => [...xs].sort((a, b) => compareKeys(sortKey(a), sortKey(b), dir));

describe('tri des colonnes', () => {
  it('textes de A à Z puis de Z à A, ordre naturel, accents ignorés', () => {
    expect(sorted(['Écran', 'article 10', 'Article 2', 'banane'])).toEqual(['Article 2', 'article 10', 'banane', 'Écran']);
    expect(sorted(['Écran', 'Article 2', 'banane'], 'desc')).toEqual(['Écran', 'banane', 'Article 2']);
  });
  it('montants, unités et dates comparés comme des nombres ; vides toujours à la fin', () => {
    expect(sorted(['1 234,50 €', '99,00 €', '', '5 €'])).toEqual(['5 €', '99,00 €', '1 234,50 €', '']);
    expect(sorted(['12 kg', '', '3 kg'], 'desc')).toEqual(['12 kg', '3 kg', '']);
    expect(sorted(['02/01/2027', '15/12/2026', '01/03/2026'])).toEqual(['01/03/2026', '15/12/2026', '02/01/2027']);
    expect(sortKey('F-S-0012').kind).toBe(1);
  });
});
