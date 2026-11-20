import { describe, expect, it } from 'vitest';
import { invoiceSchedule, invoicedTotal, projectMoments, DEFAULT_MOMENTS } from '../../src/invoicing';
import type { Equipment, EquipmentLine, Subproject } from '../../src/types';
import { buildReservations, findConflicts, lineBlock, lineDays, syncPeriods } from '../../src/utils';

const t = '2026-01-01T00:00:00.000Z';
const eq = (id: string, quantity: number): Equipment =>
  ({ id, createdAt: t, updatedAt: t, name: id, quantity, dailyPrice: 10, isKit: false, kitItems: [] });
const sub = (id: string, status: Subproject['status'], extra: Partial<Subproject> = {}): Subproject =>
  ({ id, createdAt: t, updatedAt: t, projectId: 'p-' + id, name: id, status, start: '2026-12-10T08:00', end: '2026-12-11T23:00', order: 0, ...extra });
const line = (id: string, subprojectId: string, qty: number, extra: Partial<EquipmentLine> = {}): EquipmentLine =>
  ({ id, createdAt: t, updatedAt: t, projectId: 'p-' + subprojectId, subprojectId, equipmentId: 'x12', name: 'x12', qty, unitPrice: 10, discount: 0, order: 0, ...extra });

describe('statuts et réservations', () => {
  const equipment = [eq('x12', 8)];
  it('une demande et un brouillon sont décomptés, un projet annulé ne l’est pas', () => {
    const subs = [sub('a', 'demande'), sub('b', 'brouillon'), sub('c', 'annule')];
    const res = buildReservations([line('la', 'a', 2), line('lb', 'b', 3), line('lc', 'c', 5)], subs, equipment);
    expect(res.map((r) => r.qty).sort()).toEqual([2, 3]);
    expect(res.every((r) => !r.firm)).toBe(true);
  });
  it('manque réel quand les projets confirmés suffisent à vider le stock', () => {
    const subs = [sub('a', 'confirme'), sub('b', 'option')];
    const conflicts = findConflicts(buildReservations([line('la', 'a', 6), line('lb', 'b', 6)], subs, equipment), equipment);
    const forB = conflicts.find((c) => c.subprojectId === 'b')!;
    const forA = conflicts.find((c) => c.subprojectId === 'a')!;
    expect(forB.level).toBe('ferme'); // 6 confirmés + 6 demandés > 8
    expect(forA.level).toBe('concurrence'); // le projet confirmé, lui, est servi
  });
  it('deux options qui se chevauchent : simple concurrence', () => {
    const subs = [sub('a', 'option'), sub('b', 'option')];
    const conflicts = findConflicts(buildReservations([line('la', 'a', 5), line('lb', 'b', 5)], subs, equipment), equipment);
    expect(conflicts).toHaveLength(2);
    expect(conflicts.every((c) => c.level === 'concurrence')).toBe(true);
  });
  it('« Réserver le matériel » rend une option prioritaire', () => {
    const subs = [sub('a', 'option', { reserve: true }), sub('b', 'option')];
    const conflicts = findConflicts(buildReservations([line('la', 'a', 5), line('lb', 'b', 5)], subs, equipment), equipment);
    expect(conflicts.find((c) => c.subprojectId === 'b')!.level).toBe('ferme');
    expect(conflicts.find((c) => c.subprojectId === 'a')!.level).toBe('concurrence');
  });
});

describe('horaire propre à une ligne', () => {
  const sp = syncPeriods({
    ...sub('s', 'confirme'),
    periods: [
      { id: 'm', name: 'Montage', kind: 'montage', start: '2026-12-07T08:00', end: '2026-12-07T18:00' },
      { id: 'j1', name: 'J1', kind: 'prestation', start: '2026-12-09T09:00', end: '2026-12-09T22:00' },
      { id: 'j2', name: 'J2', kind: 'prestation', start: '2026-12-10T09:00', end: '2026-12-10T22:00' },
    ],
    groups: [{ id: 'g', name: 'Vidéo', periodIds: ['m', 'j1', 'j2'] }],
  });
  it('la ligne ne bloque et ne facture que ses créneaux, même dans un groupe', () => {
    expect(lineBlock({ groupId: 'g', periodIds: ['j2'] }, sp)).toEqual(['2026-12-10T09:00', '2026-12-10T22:00']);
    expect(lineDays({ groupId: 'g', periodIds: ['j2'] }, sp)).toBe(1);
    expect(lineDays({ groupId: 'g' }, sp)).toBe(2);
  });
  it('le matériel reste disponible pour un autre projet avant son créneau', () => {
    const equipment = [eq('x12', 4)];
    const other = { ...sub('o', 'confirme'), start: '2026-12-07T08:00', end: '2026-12-08T20:00' };
    const res = buildReservations([line('l1', sp.id, 4, { periodIds: ['j2'] }), line('l2', 'o', 4)], [sp, other], equipment);
    expect(findConflicts(res, equipment)).toHaveLength(0);
  });
});

describe('moments de facturation', () => {
  const s = { invoiceMoments: DEFAULT_MOMENTS, projectTypes: [{ name: 'Prestation', color: '#000', moments: ['m_acompte', 'm_solde'] }] };
  const p = { start: '2026-12-10T08:00', end: '2026-12-12T23:00', status: 'confirme' as const, confirmedAt: '2026-11-15T10:00:00Z' };
  it('choisit les moments du projet, puis du client, puis du type', () => {
    expect(projectMoments({ typeName: 'Prestation' }, undefined, s).map((m) => m.id)).toEqual(['m_acompte', 'm_solde']);
    expect(projectMoments({ typeName: 'Prestation' }, { moments: ['m_unique'] }, s).map((m) => m.id)).toEqual(['m_unique']);
    expect(projectMoments({ typeName: 'Prestation', moments: ['m_unique'] }, { moments: ['m_acompte'] }, s).map((m) => m.id)).toEqual(['m_unique']);
    expect(projectMoments({ typeName: 'Vente' }, undefined, s).map((m) => m.percent)).toEqual([100]);
  });
  it('acompte à facturer dès la confirmation, solde après la fin', () => {
    const rows = invoiceSchedule(p, projectMoments({ typeName: 'Prestation' }, undefined, s), 1000, 0, '2026-11-20');
    expect(rows.map((r) => [r.due, r.amountHT, r.state])).toEqual([['2026-11-15', 300, 'en_retard'], ['2026-12-12', 700, 'a_venir']]);
    expect(rows[1].final).toBe(true);
  });
  it('un acompte payé fait passer au solde ; tout facturé = rien à faire', () => {
    const ms = projectMoments({ typeName: 'Prestation' }, undefined, s);
    expect(invoiceSchedule(p, ms, 1000, 300, '2026-12-13').map((r) => r.state)).toEqual(['facture', 'en_retard']);
    expect(invoiceSchedule(p, ms, 1000, 1000, '2026-12-13').every((r) => r.state === 'facture')).toBe(true);
  });
  it('un projet en attente n’a rien à facturer', () => {
    const rows = invoiceSchedule({ ...p, status: 'option', confirmedAt: undefined }, projectMoments({ typeName: 'Prestation' }, undefined, s), 1000, 0, '2026-12-20');
    expect(rows.every((r) => r.state === 'a_venir')).toBe(true);
  });
  it('facturé : la facture finale remplace les acomptes qu’elle déduit', () => {
    const snap = (totalHT: number, deposits?: { number: string; ttc: number }[]) => ({ totalHT, deposits }) as never;
    expect(invoicedTotal([
      { type: 'acompte', number: 'F-1', snapshot: snap(300) },
      { type: 'facture', number: 'F-2', snapshot: snap(1000, [{ number: 'F-1', ttc: 363 }]) },
    ])).toBe(1000);
    expect(invoicedTotal([{ type: 'acompte', number: 'F-1', snapshot: snap(300) }, { type: 'devis', number: 'D-1', snapshot: snap(1000) }])).toBe(300);
  });
});
