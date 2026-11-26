import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/db';
import { computeFinance } from '../../src/pages/project/shared';
import type { CrewAssignment, Person, Project, Subproject } from '../../src/types';
import { crewCostProfile, crewCostShown, functionRate } from '../../src/utils';

const crewCost = (c: { cost?: number; rateUnit?: 'jour' | 'heure' }, p: Person) => crewCostShown(c, crewCostProfile({}, p)).value;

const t = '2026-01-01T00:00:00.000Z';
const catalogue = [{ name: 'Rigger', dayRate: 420, hourRate: 52 }];
const karim: Person = { id: 'k', createdAt: t, updatedAt: t, name: 'Karim', dailyRate: 0, costRate: 300, external: true };
const sam: Person = { id: 's', createdAt: t, updatedAt: t, name: 'Sam', dailyRate: 0, costRate: 260, hourlyCost: 30, external: true };

describe('tarif client et coût du prestataire', () => {
  it('le tarif client vient de la fonction, pas de la personne', () => {
    expect(functionRate('rigger', 'jour', catalogue, { dailyRate: 999 })).toBe(420);
    expect(functionRate('Rigger', 'heure', catalogue)).toBe(52);
    expect(functionRate('Inconnue', 'jour', catalogue, { dailyRate: 300 })).toBe(300);
  });
  it('le coût suit la personne, sauf coût saisi à la main', () => {
    expect(crewCost({}, karim)).toBe(300);
    expect(crewCost({}, sam)).toBe(260);
    expect(crewCost({ rateUnit: 'heure' }, sam)).toBe(30);
    expect(crewCost({ cost: 250 }, sam)).toBe(250);
  });

  it('changer de sous-traitant change la marge, pas le chiffre facturé', () => {
    const project: Project = { id: 'p', createdAt: t, updatedAt: t, number: 'P', name: 'P', status: 'confirme', start: '2026-12-10T08:00', end: '2026-12-11T20:00', discount: 0 };
    const subs: Subproject[] = [{ id: 'sp', createdAt: t, updatedAt: t, projectId: 'p', name: 'Scène', status: 'confirme', start: project.start, end: project.end, order: 0 }];
    const post = (personId: string): CrewAssignment => ({ id: 'c', createdAt: t, updatedAt: t, projectId: 'p', subprojectId: 'sp', personId, function: 'Rigger', start: project.start, end: project.end, rate: 420, billable: true });
    const fin = (personId: string) => computeFinance(project, subs, [], [post(personId)], [], [], [karim, sam], new Map(), defaultSettings, 0);
    const a = fin('k'), b = fin('s');
    expect(a.totalHT).toBe(840);
    expect(b.totalHT).toBe(840);
    expect(a.cost).toBe(600);
    expect(b.cost).toBe(520);
    expect(b.margin - a.margin).toBe(80);
  });
});
