import { describe, expect, it } from 'vitest';
import { composeName, splitName } from '../../src/equipmentName';

describe('désignation : marque, modèle, description courte', () => {
  it('compose « Marque Modèle (description) »', () => {
    expect(composeName('Shure', 'SM58s', 'Micro dynamique Switch')).toBe('Shure SM58s (Micro dynamique Switch)');
    expect(composeName('Shure', 'SM58s', '')).toBe('Shure SM58s');
    expect(composeName('', '', 'Rallonge 10 m')).toBe('Rallonge 10 m');
    expect(composeName(' L-Acoustics ', 'X12', undefined)).toBe('L-Acoustics X12');
  });
  it('découpe une désignation existante (premier mot = marque)', () => {
    expect(splitName('Shure SM58s (Micro dynamique Switch)')).toEqual({ brand: 'Shure', model: 'SM58s', summary: 'Micro dynamique Switch' });
    expect(splitName('Allen & Heath Qu-16 (Console numérique)')).toEqual({ brand: 'Allen & Heath', model: 'Qu-16', summary: 'Console numérique' });
    expect(splitName('Ma Marque Pro X1', ['Ma Marque Pro'])).toEqual({ brand: 'Ma Marque Pro', model: 'X1', summary: '' });
    expect(splitName('Gaffer')).toEqual({ brand: '', model: 'Gaffer', summary: '' });
  });
});
