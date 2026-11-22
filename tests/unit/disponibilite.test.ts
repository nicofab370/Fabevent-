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
