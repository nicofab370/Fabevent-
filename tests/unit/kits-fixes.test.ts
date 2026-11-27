import { describe, expect, it } from 'vitest';
import type { Equipment, EquipmentLine, Subproject } from '../../src/types';
import { availableQty, buildReservations, fixedKitBlocked, isFixedKit, isVirtualKit } from '../../src/utils';

const t = '2026-01-01T00:00:00.000Z';
const eq = (id: string, x: Partial<Equipment>): Equipment => ({ id, createdAt: t, updatedAt: t, name: id, quantity: 0, dailyPrice: 0, isKit: false, kitItems: [], ...x });
const sm58 = eq('sm58', { quantity: 10 });
const pied = eq('pied', { quantity: 6 });
// caisse montée : 4 micros + 2 pieds par caisse, 2 caisses
const caisse = eq('caisse', { quantity: 2, isKit: true, kitType: 'fixe', kitItems: [{ equipmentId: 'sm58', qty: 4 }, { equipmentId: 'pied', qty: 2 }] });
// pack virtuel : 2 micros + 1 pied
const pack = eq('pack', { isKit: true, kitItems: [{ equipmentId: 'sm58', qty: 2 }, { equipmentId: 'pied', qty: 1 }] });
const all = [sm58, pied, caisse, pack];
const sp: Subproject = { id: 'sp', createdAt: t, updatedAt: t, projectId: 'p', name: 'Scène', status: 'confirme', start: '2026-06-01T08:00', end: '2026-06-02T20:00', order: 0 };
const line = (id: string, equipmentId: string, qty: number, parentLineId?: string): EquipmentLine =>
  ({ id, createdAt: t, updatedAt: t, projectId: 'p', subprojectId: 'sp', equipmentId, name: equipmentId, qty, unitPrice: 0, discount: 0, order: 0, parentLineId } as EquipmentLine);
const S = '2026-06-01T10:00', E = '2026-06-01T12:00';

describe('kits fixes (caisses montées) et kits virtuels', () => {
  it('reconnaît le type de kit (les kits existants restent virtuels)', () => {
    expect([isFixedKit(caisse), isVirtualKit(caisse), isFixedKit(pack), isVirtualKit(pack), isVirtualKit(sm58)]).toEqual([true, false, false, true, false]);
  });
  it('le contenu des caisses montées est bloqué : plus disponible seul', () => {
    const res = buildReservations([], [sp], all);
    expect(fixedKitBlocked('sm58', all)).toBe(8);
    expect(availableQty(sm58, all, res, S, E)).toBe(2); // 10 − 2 caisses × 4
    expect(availableQty(pied, all, res, S, E)).toBe(2); // 6 − 2 × 2
    expect(availableQty(caisse, all, res, S, E)).toBe(2); // son propre stock : 2 caisses
  });
  it('dans un projet, une caisse réserve la caisse (pas ses composants une 2e fois)', () => {
    const res = buildReservations([line('l1', 'caisse', 1)], [sp], all);
    expect(availableQty(caisse, all, res, S, E)).toBe(1);
    expect(availableQty(sm58, all, res, S, E)).toBe(2);
    // contenu détaillé pour la vérification (lignes enfants) : jamais compté en plus
    const res2 = buildReservations([line('l1', 'caisse', 1), line('l2', 'sm58', 4, 'l1')], [sp], all);
    expect(availableQty(sm58, all, res2, S, E)).toBe(2);
  });
  it('un kit virtuel réserve ses composants, sa dispo = celle des composants restants', () => {
    const res = buildReservations([], [sp], all);
    expect(availableQty(pack, all, res, S, E)).toBe(1); // 2 micros libres / 2 par pack
    const res2 = buildReservations([line('l1', 'pack', 1)], [sp], all);
    expect(availableQty(sm58, all, res2, S, E)).toBe(0);
    expect(availableQty(pied, all, res2, S, E)).toBe(1);
  });
  it('caisse archivée : son contenu est de nouveau libre', () => {
    const arch = [sm58, pied, { ...caisse, archived: true }];
    expect(availableQty(sm58, arch, buildReservations([], [sp], arch), S, E)).toBe(10);
  });
});
