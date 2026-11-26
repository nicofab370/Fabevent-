import { describe, expect, it } from 'vitest';
import { missingNumbers, nextNumber, unitNo } from '../../src/unitNumbers';
import type { SerialUnit } from '../../src/types';

const u = (id: string, equipmentId: string, createdAt: string, number?: number): SerialUnit =>
  ({ id, equipmentId, createdAt, updatedAt: createdAt, serial: 'SN-' + id, barcode: 'F-S-0001-' + id, status: 'ok', number });

describe('numéro d’unité #x', () => {
  it('le suivant est le plus grand + 1 (pas de réutilisation après suppression)', () => {
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([{ number: 1 }, { number: 4 }])).toBe(5);
  });
  it('les unités sans numéro sont numérotées par article, dans l’ordre de création, après les existants', () => {
    const todo = missingNumbers([
      u('a', 'E1', '2026-01-02'), u('b', 'E1', '2026-01-01'), u('c', 'E1', '2026-01-03', 7),
      u('d', 'E2', '2026-01-05'),
    ]);
    const n = Object.fromEntries(todo.map((x) => [x.id, x.number]));
    expect(n).toEqual({ b: 8, a: 9, d: 1 });
  });
  it('libellés', () => {
    expect(unitNo({ number: 3 })).toBe('#3');
    expect(unitNo({})).toBe('');
  });
});
