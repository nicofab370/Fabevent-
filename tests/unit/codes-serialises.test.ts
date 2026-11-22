import { describe, expect, it } from 'vitest';
import { missingSerialCodes } from '../../src/autoCodes';
import type { Category, Equipment, SerialUnit } from '../../src/types';

const cats = [{ id: 'son', name: 'Son', letter: 'S' }, { id: 'mic', name: 'Micro', parentId: 'son' }] as Category[];
const eq = (id: string, extra: Partial<Equipment>) => ({ id, name: id, quantity: 0, dailyPrice: 0, isKit: false, kitItems: [], ...extra }) as Equipment;
const unit = (id: string, equipmentId: string, number: number, barcode?: string) => ({ id, equipmentId, number, serial: 'SN' + id, barcode, status: 'ok' }) as SerialUnit;

describe('code logique pour un article sérialisé sans code', () => {
  const equipment = [
    eq('a', { code: 'F-S-0041', trackSerials: true }),
    eq('b', { trackSerials: true, categoryId: 'mic' }),
    eq('c', { categoryId: 'son' }), // en vrac : pas concerné
  ];
  const units = [unit('1', 'b', 1), unit('2', 'b', 3), unit('3', 'a', 2), unit('4', 'b', 2, 'ANCIEN-CODE')];
  const r = missingSerialCodes(equipment, units, { depots: [{ id: 'd', name: 'Liège', letter: 'F' }] } as never, cats);
  it('article : dépôt-catégorie-numéro suivant (sous-catégorie = lettre de la catégorie)', () => {
    expect(r.equipment.map((e) => [e.id, e.code])).toEqual([['b', 'F-S-0042']]);
  });
  it('unités sans code : code de l’article + numéro #x ; les codes existants ne bougent pas', () => {
    expect(Object.fromEntries(r.units.map((u) => [u.id, u.barcode]))).toEqual({ 1: 'F-S-0042-01', 2: 'F-S-0042-03', 3: 'F-S-0041-02' });
  });
});
