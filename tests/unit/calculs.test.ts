import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../../src/db';
import { tripKm, vehiclePrice } from '../../src/geo';
import type { Equipment, EquipmentLine, Subproject } from '../../src/types';
import {
  availableQty, buildReservations, crewAmount, crewWindow, daysBetween, effectiveEquipment, factorFor, findConflicts, lineDays, lineTotal,
  syncPeriods, usageDays,
} from '../../src/utils';

const t = '2026-01-01T00:00:00.000Z';
const eq = (id: string, quantity: number, extra: Partial<Equipment> = {}): Equipment =>
  ({ id, createdAt: t, updatedAt: t, name: id, quantity, dailyPrice: 10, isKit: false, kitItems: [], ...extra });
const sub = (id: string, start: string, end: string, extra: Partial<Subproject> = {}): Subproject =>
  ({ id, createdAt: t, updatedAt: t, projectId: 'p-' + id, name: id, status: 'confirme', start, end, order: 0, ...extra });
const line = (id: string, subprojectId: string, equipmentId: string, qty: number, extra: Partial<EquipmentLine> = {}): EquipmentLine =>
  ({ id, createdAt: t, updatedAt: t, projectId: 'p-' + subprojectId, subprojectId, equipmentId, name: equipmentId, qty, unitPrice: 10, discount: 0, order: 0, ...extra });

describe('durées et prix', () => {
  it('compte les jours calendaires', () => {
    expect(daysBetween('2026-12-10T08:00', '2026-12-11T23:00')).toBe(2);
    expect(daysBetween('2026-12-10T08:00', '2026-12-10T09:00')).toBe(1);
  });
  it('applique les coefficients de durée', () => {
    expect(factorFor(1, defaultSettings)).toBe(1);
    expect(factorFor(2, defaultSettings)).toBe(1.5);
    expect(factorFor(9, defaultSettings)).toBe(5); // 4 (7 j) + 2 × 0,5
  });
  it('calcule une ligne avec remise, et un consommable à la pièce', () => {
    expect(lineTotal({ qty: 4, unitPrice: 45, discount: 10 }, 2, defaultSettings)).toBe(243);
    expect(lineTotal({ qty: 3, unitPrice: 12, discount: 0 }, 5, defaultSettings, true)).toBe(36);
  });
});

describe('créneaux et jours facturés', () => {
  const periods = [
    { id: 'm', name: 'Montage', kind: 'montage' as const, start: '2026-12-09T08:00', end: '2026-12-09T18:00' },
    { id: 'j1', name: 'J1', kind: 'prestation' as const, start: '2026-12-10T14:00', end: '2026-12-11T01:00' },
    { id: 'j2', name: 'J2', kind: 'prestation' as const, start: '2026-12-11T14:00', end: '2026-12-12T01:00' },
    { id: 'd', name: 'Démontage', kind: 'demontage' as const, start: '2026-12-12T01:00', end: '2026-12-12T08:00' },
  ];
  const sp = syncPeriods({ ...sub('s', '', ''), periods });
  it('bloque du montage au démontage et facture les prestations', () => {
    expect(sp.prepStart).toBe('2026-12-09T08:00');
    expect(sp.start).toBe('2026-12-10T14:00');
    expect(sp.end).toBe('2026-12-12T01:00');
    expect(sp.returnEnd).toBe('2026-12-12T08:00');
  });
  it('une fin avant 6 h compte pour la veille', () => {
    expect(usageDays(sp)).toBe(2);
  });
  it('un groupe limité au J1 ne facture qu’un jour', () => {
    const withGroup = { ...sp, groups: [{ id: 'g', name: 'Gala', periodIds: ['j1'] }] };
    expect(lineDays({ groupId: 'g' }, withGroup)).toBe(1);
    expect(lineDays({}, withGroup)).toBe(2);
  });
});

describe('disponibilités', () => {
  const equipment = [eq('x12', 8)];
  const subs = [sub('a', '2026-12-10T08:00', '2026-12-11T23:00'), sub('b', '2026-12-11T08:00', '2026-12-12T23:00')];
  const lines = [line('l1', 'a', 'x12', 6), line('l2', 'b', 'x12', 4)];
  it('détecte le manque sur le chevauchement', () => {
    const res = buildReservations(lines, subs, equipment);
    expect(availableQty(equipment[0], equipment, res, '2026-12-11T09:00', '2026-12-11T10:00')).toBe(-2);
    const c = findConflicts(res, equipment);
    expect(c.length).toBe(2);
    expect(c[0].shortage).toBe(2);
  });
  it('une sous-location confirmée comble le manque', () => {
    const res = buildReservations(lines, subs, equipment, {
      subrentals: [{ id: 'sr', createdAt: t, updatedAt: t, number: 'SL', projectId: 'p-b', subprojectId: 'b', status: 'confirme', start: '2026-12-11T08:00', end: '2026-12-12T23:00', lines: [{ equipmentId: 'x12', name: 'x12', qty: 2, cost: 0 }] }],
    });
    expect(findConflicts(res, equipment)).toEqual([]);
  });
  it('une réparation ouverte réduit le stock', () => {
    const res = buildReservations([], [], equipment, { repairs: [{ id: 'r', createdAt: t, updatedAt: t, equipmentId: 'x12', qty: 1, start: '2026-01-01T00:00', status: 'ouvert', description: '', cost: 0 }] });
    expect(availableQty(equipment[0], equipment, res, '2026-12-01T00:00', '2026-12-02T00:00')).toBe(7);
  });
  it('les lignes optionnelles et les demandes ne réservent pas', () => {
    const res = buildReservations([line('o', 'a', 'x12', 8, { optional: true })], [sub('a', '2026-12-10T08:00', '2026-12-11T23:00', { status: 'demande' })], equipment);
    expect(res.length).toBe(0);
  });
  it('un kit réserve ses composants', () => {
    const all = [eq('x12', 8), eq('pack', 0, { isKit: true, kitItems: [{ equipmentId: 'x12', qty: 2 }] })];
    const res = buildReservations([line('k', 'a', 'pack', 3)], [subs[0]], all);
    expect(availableQty(all[0], all, res, '2026-12-10T09:00', '2026-12-10T10:00')).toBe(2);
    expect(availableQty(all[1], all, res, '2026-12-10T09:00', '2026-12-10T10:00')).toBe(1);
  });
  it('gère le stock par dépôt et les transferts', () => {
    const all = effectiveEquipment([eq('x12', 8, { stock: { namur: 2 } })], [], ['liege', 'namur']);
    expect(all[0]._stock).toEqual({ liege: 6, namur: 2 });
    const res = buildReservations([], [], all, {
      mainDepot: 'liege',
      transfers: [{ id: 'tr', createdAt: t, updatedAt: t, number: 'TR', fromDepotId: 'namur', toDepotId: 'liege', start: '2026-12-01T00:00', end: '2026-12-31T00:00', status: 'planifie', lines: [{ equipmentId: 'x12', qty: 2 }] }],
    });
    expect(availableQty(all[0], all, res, '2026-12-10T00:00', '2026-12-11T00:00', undefined, 'liege')).toBe(8);
    expect(availableQty(all[0], all, res, '2026-12-10T00:00', '2026-12-11T00:00', undefined, 'namur')).toBe(0);
  });
});

describe('personnel', () => {
  const s = { overtimeAfter: 10, overtimeRate: 50 };
  it('tarif journalier', () => {
    expect(crewAmount({ start: '2026-12-10T08:00', end: '2026-12-11T20:00', rate: 300, cost: 200 }, s)).toMatchObject({ unit: 'jour', qty: 2, billed: 600, cost: 400 });
  });
  it('tarif horaire avec heures supplémentaires sur un service de nuit', () => {
    // 14 h → 1 h = 11 h, dont 1 h majorée à 50 %
    const a = crewAmount({ start: '2026-12-10T14:00', end: '2026-12-11T01:00', rate: 40, rateUnit: 'heure' }, s);
    expect(a.hours).toBe(11);
    expect(a.overtime).toBe(1);
    expect(a.billed).toBe(10 * 40 + 1 * 60);
  });
  it('le trajet élargit les horaires communiqués et facturés à l’heure', () => {
    expect(crewWindow({ start: '2026-12-10T08:00', end: '2026-12-10T12:00', travel: true }, 30)).toEqual(['2026-12-10T07:30', '2026-12-10T12:30']);
    expect(crewAmount({ start: '2026-12-10T08:00', end: '2026-12-10T12:00', rate: 40, rateUnit: 'heure', travel: true }, s, 30).hours).toBe(5);
  });
});

describe('transport', () => {
  it('km = distance × 2 × allers-retours, prix = forfait × jours + km × €/km', () => {
    expect(tripKm(50, 2)).toBe(200);
    const v = { id: 'v', createdAt: t, updatedAt: t, name: 'Fourgon', dailyPrice: 70 };
    expect(vehiclePrice({ start: '2026-11-25T14:00', end: '2026-11-27T21:00', km: 200 }, v, { ...defaultSettings, pricePerKm: 1.1 })).toBe(430);
  });
});
