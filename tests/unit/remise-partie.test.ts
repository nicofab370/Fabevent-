import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/db';
import { computeFinance } from '../../src/pages/project/shared';
import type { CrewAssignment, Equipment, EquipmentLine, Project, Subproject } from '../../src/types';

const t = '2026-01-01T00:00:00.000Z';
const project: Project = { id: 'p', createdAt: t, updatedAt: t, number: 'P', name: 'P', status: 'confirme', start: '2026-12-10T08:00', end: '2026-12-10T20:00', discount: 0 };
const sp: Subproject = { id: 'sp', createdAt: t, updatedAt: t, projectId: 'p', name: 'Scène', status: 'confirme', start: project.start, end: project.end, order: 0 };
const eq: Equipment = { id: 'e', createdAt: t, updatedAt: t, name: 'Enceinte', quantity: 10, dailyPrice: 100, isKit: false, kitItems: [] };
const line: EquipmentLine = { id: 'l', createdAt: t, updatedAt: t, projectId: 'p', subprojectId: 'sp', equipmentId: 'e', name: 'Enceinte', qty: 10, unitPrice: 100, discount: 0, order: 0 };
const crew: CrewAssignment = { id: 'c', createdAt: t, updatedAt: t, projectId: 'p', subprojectId: 'sp', function: 'Son', start: project.start, end: project.end, rate: 500, billable: true };
const fin = (p: Partial<Project>) => computeFinance({ ...project, ...p }, [sp], [line], [crew], [], [], [], new Map([['e', eq]]), { ...defaultSettings, insurancePct: 0 }, 0);

describe('remise sur une partie seulement', () => {
  it('10 % sur le matériel seul : le personnel n’est pas remisé', () => {
    const base = fin({});
    const f = fin({ partDiscounts: { materiel: 10 } });
    const mat = f.rows.find((r) => r.label === 'Matériel')!, per = f.rows.find((r) => r.label === 'Personnel')!;
    expect(mat.before! - mat.revenue).toBeCloseTo(base.rows[0].revenue * 0.1, 2);
    expect(per.revenue).toBe(base.rows[1].revenue);
    expect(f.totalHT).toBeCloseTo(base.totalHT - base.rows[0].revenue * 0.1, 2);
  });
  it('la remise globale s’applique après les remises par partie', () => {
    const f = fin({ partDiscounts: { materiel: 10 }, discount: 5 });
    const afterParts = fin({ partDiscounts: { materiel: 10 } }).totalHT;
    expect(f.totalHT).toBeCloseTo(afterParts * 0.95, 2);
  });
});
