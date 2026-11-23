import { describe, expect, it } from 'vitest';
import { projectUses, usesByKind } from '../../src/components/Reservations';
import type { Equipment } from '../../src/types';
import type { Reservation } from '../../src/utils';

const eq = { id: 'par', name: 'PAR LED', quantity: 20, dailyPrice: 0, isKit: false, kitItems: [] } as unknown as Equipment;
const r = (qty: number, projectId: string, subprojectId: string, lineId: string, firm: boolean, source: Reservation['source'] = 'projet'): Reservation =>
  ({ equipmentId: 'par', qty, start: '2026-06-01T08:00', end: '2026-06-03T20:00', lineId, subprojectId, projectId, source, firm });

describe('où est le matériel sur la période', () => {
  const res = [
    r(4, 'P1', 'S1', 'L1', false), // cette ligne
    r(2, 'P1', 'S1', 'L2', false), // autre ligne du même sous-projet
    r(3, 'P1', 'S2', 'L3', false), // autre sous-projet du projet
    r(5, 'P2', 'S9', 'L4', false), // option ailleurs
    r(6, 'P3', 'S8', 'L5', true), // réservé ailleurs
    r(1, '', '', 'R1', false, 'reparation'),
    { ...r(7, 'P4', 'S7', 'L6', true), start: '2026-07-01T08:00', end: '2026-07-02T08:00' }, // hors période
  ];
  it('classe chaque utilisation', () => {
    const uses = projectUses(eq, [eq], res, '2026-06-02T00:00', '2026-06-02T23:00', { projectId: 'P1', subprojectId: 'S1', lineId: 'L1' });
    expect(usesByKind(uses)).toEqual({ ici: 2, sousprojet: 3, option: 5, reserve: 6, autre: 1 });
  });
  it('depuis la fenêtre d’ajout (pas de ligne) : la ligne existante compte « ici »', () => {
    const uses = projectUses(eq, [eq], res, '2026-06-02T00:00', '2026-06-02T23:00', { projectId: 'P1', subprojectId: 'S1' });
    expect(usesByKind(uses).ici).toBe(6);
  });
});

describe('stock par dépôt et transferts', async () => {
  const { buildReservations, effectiveEquipment, stockAt, inDepot } = await import('../../src/utils');
  const bulk = { id: 'pc', name: 'Rallonge', quantity: 20, stock: { B: 5 }, dailyPrice: 0, isKit: false, kitItems: [] } as unknown as Equipment;
  const ser = { id: 'ly', name: 'Lyre', quantity: 0, trackSerials: true, dailyPrice: 0, isKit: false, kitItems: [] } as unknown as Equipment;
  const units = [1, 2, 3].map((n) => ({ id: 'u' + n, equipmentId: 'ly', serial: 'S' + n, status: 'ok', number: n, depotId: n === 3 ? 'B' : n === 2 ? 'supprime' : 'A' })) as never[];
  const eqs = effectiveEquipment([bulk, ser], units, ['A', 'B']);
  const tr = (applied: boolean) => ({ id: 't', number: 'TR-1', fromDepotId: 'A', toDepotId: 'B', start: '2026-01-01T08:00', status: 'effectue', applied, lines: [{ equipmentId: 'pc', qty: 4 }, { equipmentId: 'ly', qty: 1, unitIds: ['u1'] }] });

  it('vrac : le principal a le reste, une unité au dépôt inconnu compte au principal', () => {
    expect(stockAt(eqs[0], 'A')).toBe(15);
    expect(stockAt(eqs[0], 'B')).toBe(5);
    expect(stockAt(eqs[1], 'A')).toBe(2);
    expect(stockAt(eqs[1], 'B')).toBe(1);
  });
  it('transfert définitif pas encore déplacé : compté par la réservation', () => {
    const res = buildReservations([], [], eqs, { transfers: [tr(false)] as never[] });
    expect(stockAt(eqs[0], 'B', res, '2026-06-01T00:00')).toBe(9);
    expect(stockAt(eqs[0], 'A', res, '2026-06-01T00:00')).toBe(11);
  });
  it('transfert définitif effectué (stock déplacé) : plus de réservation, pas de double comptage', () => {
    const res = buildReservations([], [], eqs, { transfers: [tr(true)] as never[] });
    expect(res.filter((r) => r.source === 'transfert')).toEqual([]);
  });
  it('filtre dépôt : présent par le stock ou par un transfert', () => {
    const res = buildReservations([], [], eqs, { transfers: [tr(false)] as never[] });
    const e0 = { ...eqs[0], stock: {}, _stock: { A: 20, B: 0 } } as Equipment;
    expect(inDepot(e0, 'B', [{ id: 'A' }, { id: 'B' }])).toBe(false);
    expect(inDepot(e0, 'B', [{ id: 'A' }, { id: 'B' }], res)).toBe(true);
  });
});

describe('contenu des kits avec les quantités', async () => {
  const { kitBreakdown } = await import('../../src/utils');
  const e = (id: string, quantity: number, extra: Partial<Equipment> = {}) => ({ id, name: id, quantity, dailyPrice: 0, isKit: false, kitItems: [], ...extra }) as unknown as Equipment;
  const enceinte = e('enc', 8), cable = e('cab', 30), pied = e('pied', 3);
  const kit = e('kit', 0, { isKit: true, kitItems: [{ equipmentId: 'enc', qty: 2 }, { equipmentId: 'cab', qty: 4 }, { equipmentId: 'pied', qty: 2 }] } as Partial<Equipment>);
  const all = [enceinte, cable, pied, kit];
  it('par élément : par kit, stock, dispo, kits possibles ; l’élément qui limite est marqué', () => {
    const res = [{ equipmentId: 'enc', qty: 4, start: '2026-06-01T08:00', end: '2026-06-02T20:00', lineId: 'L', subprojectId: 'S', projectId: 'P', source: 'projet' as const }];
    const b = kitBreakdown(kit, all, res, '2026-06-01T10:00', '2026-06-01T18:00');
    expect(b.rows.map((r) => [r.equipment.id, r.perKit, r.stock, r.avail, r.kitsStock, r.kitsAvail])).toEqual([
      ['enc', 2, 8, 4, 4, 2], ['cab', 4, 30, 30, 7, 7], ['pied', 2, 3, 3, 1, 1],
    ]);
    expect(b.kitsStock).toBe(1);
    expect(b.kitsAvail).toBe(1);
    expect(b.rows.filter((r) => r.limiting).map((r) => r.equipment.id)).toEqual(['pied']);
  });
});
