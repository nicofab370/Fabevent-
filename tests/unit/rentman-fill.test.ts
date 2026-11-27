import { describe, expect, it } from 'vitest';
import { fillEmpty } from '../../src/rentmanImport';

describe('réimport Rentman sans « mettre à jour »', () => {
  it('remplit seulement les champs vides ou à 0 (quantité), garde les modifications faites dans FabEvent', () => {
    const cur = { id: 'rm-e-1', name: 'Mon nom à moi', quantity: 0, dailyPrice: 12, weight: undefined, tags: [] };
    const r = { id: 'rm-e-1', name: 'Nom Rentman', quantity: 8, dailyPrice: 15, weight: 2.5, tags: ['rentman'], createdAt: 'x' };
    expect(fillEmpty(cur, r)).toEqual({ id: 'rm-e-1', name: 'Mon nom à moi', quantity: 8, dailyPrice: 12, weight: 2.5, tags: ['rentman'] });
    expect(fillEmpty({ id: 'a', quantity: 3 }, { id: 'a', quantity: 8 })).toBeNull();
  });
});
