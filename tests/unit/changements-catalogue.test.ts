import { describe, expect, it } from 'vitest';
import { catalogChanges, kitSig } from '../../src/catalogChanges';
import type { Equipment, EquipmentLine, Subproject } from '../../src/types';
import { availableQty, buildReservations } from '../../src/utils';

const t = '2026-01-01T00:00:00.000Z';
const eq = (id: string, x: Partial<Equipment>): Equipment => ({ id, createdAt: t, updatedAt: t, name: id, quantity: 10, dailyPrice: 0, isKit: false, kitItems: [], ...x });
const line = (id: string, equipmentId: string, qty: number, x: Partial<EquipmentLine> = {}): EquipmentLine =>
  ({ id, createdAt: t, updatedAt: t, projectId: 'p', subprojectId: 'sp', equipmentId, name: equipmentId, qty, unitPrice: 0, discount: 0, order: 0, ...x } as EquipmentLine);
const sp: Subproject = { id: 'sp', createdAt: t, updatedAt: t, projectId: 'p', name: 'Scène', status: 'confirme', start: '2026-06-01T08:00', end: '2026-06-02T20:00', order: 0 };
const S = '2026-06-01T10:00', E = '2026-06-01T12:00';

const micro = eq('micro', { dailyPrice: 5 });
const pied = eq('pied', { dailyPrice: 2 });
// le pack contenait 2 micros + 1 pied ; au catalogue, il contient maintenant 3 micros (et plus de pied)
const packAvant = eq('pack', { name: 'Pack voix', dailyPrice: 20, isKit: true, kitItems: [{ equipmentId: 'micro', qty: 2 }, { equipmentId: 'pied', qty: 1 }] });
const packMaintenant = { ...packAvant, name: 'Pack voix pro', dailyPrice: 25, kitItems: [{ equipmentId: 'micro', qty: 3 }] };
const lines = [
  line('l1', 'pack', 2, { name: 'Pack voix', unitPrice: 20, catalogPrice: 20 }),
  line('c1', 'micro', 4, { parentLineId: 'l1', kitPart: true }),
  line('c2', 'pied', 2, { parentLineId: 'l1', kitPart: true }),
  line('l2', 'micro', 1, { unitPrice: 4, catalogPrice: 5 }), // prix modifié à la main dans le projet
];

describe('changement au catalogue : rien ne change tout seul dans les projets', () => {
  it('les réservations suivent le contenu figé dans le projet, pas le nouveau contenu du kit', () => {
    const res = buildReservations(lines, [sp], [micro, pied, packMaintenant]);
    expect(availableQty(micro, [micro, pied, packMaintenant], res, S, E)).toBe(10 - 4 - 1);
    expect(availableQty(pied, [micro, pied, packMaintenant], res, S, E)).toBe(10 - 2);
  });
  it('ancien projet sans lignes de contenu : le kit est déplié comme avant', () => {
    const res = buildReservations([line('l1', 'pack', 2)], [sp], [micro, pied, packAvant]);
    expect(availableQty(micro, [micro, pied, packAvant], res, S, E)).toBe(6);
  });
  it('les différences sont proposées : prix, nom, contenu (prix modifié à la main signalé)', () => {
    const ch = catalogChanges(lines, [micro, pied, packMaintenant]);
    const by = Object.fromEntries(ch.map((c) => [c.key, c]));
    expect(by['prix:l1'].text).toContain('→');
    expect(by['nom:l1'].text).toContain('Pack voix pro');
    expect(by['contenu:l1'].text).toContain('micro : 4 → 6');
    expect(by['contenu:l1'].text).toContain('− 2 × pied (retiré du kit)');
    expect(by['prix:l2']).toBeUndefined(); // le catalogue n'a pas bougé pour le micro (5)
    expect(catalogChanges(lines, [{ ...micro, dailyPrice: 6 }, pied, packAvant]).find((c) => c.key === 'prix:l2')?.manual).toBe(true);
  });
  it('rien à proposer quand le catalogue n’a pas changé, ou une fois le changement ignoré', () => {
    expect(catalogChanges(lines.map((l) => (l.id === 'l2' ? { ...l, unitPrice: 5 } : l)), [micro, pied, packAvant])).toEqual([]);
    const acked = lines.map((l) => (l.id === 'l1' ? { ...l, catalogPrice: 25, catalogName: 'Pack voix pro', kitAck: kitSig(packMaintenant) } : l));
    expect(catalogChanges(acked, [micro, pied, packMaintenant]).filter((c) => c.lineId === 'l1')).toEqual([]);
  });
});
