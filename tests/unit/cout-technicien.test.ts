import { describe, expect, it } from 'vitest';
import { crewAmount, crewCostProfile, crewCostShown, fmtHours } from '../../src/utils';

const s = { overtimeAfter: 10, overtimeRate: 50 };
const jour = (start: string, end: string) => ({ start, end, rate: 400 });
const heure = (start: string, end: string) => ({ start, end, rate: 50, rateUnit: 'heure' as const });

describe('coût du technicien', () => {
  it('seulement un prix horaire : compté à l’heure même sur un poste à la journée', () => {
    const p = crewCostProfile({}, { hourlyCost: 30 });
    const a = crewAmount(jour('2026-12-10T10:00', '2026-12-10T22:00'), s, 0, p);
    expect(a.cost).toBe(10 * 30 + 2 * 30 * 1.5);
    expect(a.costOvertime).toBe(2);
    expect(a.billed).toBe(400); // le client reste facturé à la journée
  });
  it('seulement un forfait : heures sup. = forfait ÷ heures du forfait, majorées', () => {
    const p = crewCostProfile({}, { costRate: 300 });
    expect(crewAmount(jour('2026-12-10T10:00', '2026-12-10T22:00'), s, 0, p).cost).toBe(300 + 2 * 30 * 1.5);
    expect(crewAmount(jour('2026-12-10T10:00', '2026-12-10T18:00'), s, 0, p).cost).toBe(300);
  });
  it('forfait sur un autre nombre d’heures que 10', () => {
    const p = crewCostProfile({}, { costRate: 300, dayHours: 8 });
    const a = crewAmount(jour('2026-12-10T10:00', '2026-12-10T22:00'), s, 0, p);
    expect(a.costOvertime).toBe(4);
    expect(a.cost).toBe(300 + 4 * 37.5 * 1.5);
    const h = crewCostProfile({}, { hourlyCost: 30, dayHours: 12 });
    expect(crewAmount(jour('2026-12-10T10:00', '2026-12-10T22:00'), s, 0, h).cost).toBe(12 * 30);
  });
  it('forfait seul sur un poste à l’heure : un forfait par journée de service, plus les heures sup.', () => {
    const p = crewCostProfile({}, { costRate: 300 });
    expect(crewAmount(heure('2026-12-10T14:00', '2026-12-10T20:00'), s, 0, p).cost).toBe(300);
    expect(crewAmount(heure('2026-12-10T10:00', '2026-12-10T23:00'), s, 0, p).cost).toBe(300 + 3 * 30 * 1.5);
  });
  it('forfait et prix horaire : forfait à la journée, prix horaire pour les postes à l’heure et les heures sup.', () => {
    const p = crewCostProfile({}, { costRate: 300, hourlyCost: 40 });
    expect(crewAmount(jour('2026-12-10T10:00', '2026-12-10T22:00'), s, 0, p).cost).toBe(300 + 2 * 40 * 1.5);
    expect(crewAmount(heure('2026-12-10T10:00', '2026-12-10T22:00'), s, 0, p).cost).toBe(10 * 40 + 2 * 40 * 1.5);
  });
  it('heures prestées : durée réelle, ou même horaire chaque jour sur plusieurs jours, trajet compris', () => {
    expect(crewAmount(jour('2026-12-10T10:00', '2026-12-10T22:00'), s, 0, {}).worked).toBe(12);
    const multi = crewAmount(jour('2026-12-10T08:00', '2026-12-12T18:00'), s, 0, {});
    expect(multi).toMatchObject({ worked: 30, estimated: true, costOvertime: 0 });
    expect(crewAmount({ ...jour('2026-12-10T10:00', '2026-12-10T18:00'), travel: true }, s, 30, {}).worked).toBe(9);
    expect(crewAmount(heure('2026-12-10T14:00', '2026-12-11T01:00'), s, 0, {}).worked).toBe(11);
  });
  it('plusieurs jours à la journée : pas d’heures sup. inventées', () => {
    expect(crewAmount(jour('2026-12-10T08:00', '2026-12-12T18:00'), s, 0, crewCostProfile({}, { costRate: 300 })).cost).toBe(900);
    expect(crewAmount(jour('2026-12-10T08:00', '2026-12-12T18:00'), s, 0, crewCostProfile({}, { hourlyCost: 30 })).cost).toBe(3 * 10 * 30);
  });
  it('tarif propre à la fonction et coût saisi à la main avec son unité', () => {
    const person = { costRate: 300, hourlyCost: 40, rates: [{ function: 'Technicien vidéo', hourCost: 55 }] };
    expect(crewCostProfile({ function: 'technicien vidéo' }, person)).toEqual({ day: undefined, hour: 55, dayHours: undefined });
    const manual = crewAmount({ ...jour('2026-12-10T10:00', '2026-12-10T18:00'), cost: 35, costUnit: 'heure' as const }, s, 0, crewCostProfile({}, person));
    expect(manual.cost).toBe(8 * 35);
    expect(crewCostShown({ rateUnit: 'jour' }, { hour: 30 })).toEqual({ value: 30, unit: 'heure' });
    expect(crewCostShown({ rateUnit: 'heure' }, { day: 300 })).toEqual({ value: 300, unit: 'jour' });
  });
});

describe('affichage des heures', () => {
  it('12 h, 12 h 30, 24 min', () => {
    expect(fmtHours(12)).toBe('12 h');
    expect(fmtHours(12.5)).toBe('12 h 30');
    expect(fmtHours(0.4)).toBe('24 min');
    expect(fmtHours(9.999)).toBe('10 h');
  });
});
