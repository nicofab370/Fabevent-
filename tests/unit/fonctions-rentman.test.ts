import { describe, expect, it } from 'vitest';
import { projectedStock } from '../../src/stock';
import { importantBetween, importantOn } from '../../src/importantDays';
import { inPreset, presetRange } from '../../src/components/PeriodFilter';
import { allTasks, dueOf } from '../../src/tasks';
import { factorFor } from '../../src/utils';
import { autoBcc, withSignature } from '../../src/mailer';
import { coRented } from '../../src/pages/project/EquipmentExtras';
import { balanceDue } from '../../src/components/DocExtras';
import { changedLines } from '../../src/pages/PlanningSend';
import { mapRentman } from '../../tools/rentman-import/map.mjs';
import type { Doc, EquipmentLine, Project, Settings } from '../../src/types';

describe('stock critique des consommables', () => {
  it('donne la date où le seuil est atteint (projets à venir et mouvements programmés)', () => {
    const e = { quantity: 50, criticalStock: 20, plannedStock: [{ id: 'a', date: '2026-12-20', delta: 40, text: 'Livraison' }] };
    const p = projectedStock(e, '2026-12-01', [{ date: '2026-12-10', qty: 25 }, { date: '2026-12-15', qty: 10 }]);
    expect(p.reachDate).toBe('2026-12-15');
    expect(p.min).toBe(15);
    expect(p.end).toBe(55);
    expect(projectedStock({ quantity: 10, criticalStock: 20 }, '2026-12-01').reachDate).toBe('2026-12-01');
    expect(projectedStock({ quantity: 100, criticalStock: 20 }, '2026-12-01', [{ date: '2026-12-05', qty: 5 }]).reachDate).toBeUndefined();
  });
});

describe('jours importants', () => {
  const days = [{ id: '1', date: '2025-07-21', name: 'Fête nationale', yearly: true }, { id: '2', date: '2026-12-03', name: 'Salon' }];
  it('reconnaît les jours répétés chaque année et ceux d\'une période', () => {
    expect(importantOn('2026-07-21', days).map((d) => d.name)).toEqual(['Fête nationale']);
    expect(importantOn('2027-12-03', days)).toEqual([]);
    expect(importantBetween('2026-12-01T08:00', '2026-12-04T23:00', { importantDays: days }).map((x) => x.date)).toEqual(['2026-12-03']);
  });
});

describe('filtres de période prédéfinis', () => {
  const now = new Date('2026-11-28T10:00:00'); // samedi
  it('calcule les semaines et les mois', () => {
    expect(presetRange('week', now)).toEqual(['2026-11-23', '2026-11-29']);
    expect(presetRange('nextweek', now)).toEqual(['2026-11-30', '2026-12-06']);
    expect(presetRange('nextmonth', now)).toEqual(['2026-12-01', '2026-12-31']);
    expect(presetRange('', now)).toBeNull();
    expect(inPreset('', undefined, undefined)).toBe(true);
  });
});

describe('tâches', () => {
  it('échéance relative au projet, liste commune des tâches', () => {
    const p = { id: 'p', start: '2026-12-10T08:00', end: '2026-12-12T23:00', status: 'confirme', tasks: [{ id: 't', text: 'Badges', done: false, rel: { days: -3, base: 'start' } }] } as unknown as Project;
    expect(dueOf(p.tasks![0], p)).toBe('2026-12-07');
    expect(dueOf({ id: 'x', text: '', done: false, rel: { days: 2, base: 'end' } }, p)).toBe('2026-12-14');
    const rows = allTasks([p, { ...p, id: 'q', isTemplate: true }], [{ id: 'f', text: 'Assurance', done: false, due: '2026-12-01', createdAt: '', updatedAt: '' }]);
    expect(rows.map((r) => r.due)).toEqual(['2026-12-07', '2026-12-01']);
  });
});

describe('grilles de coefficients', () => {
  const s = { factors: [1, 1.5, 2], factorExtraPerDay: 0.5, factorGroups: [{ id: 'rig', name: 'Rigging', factors: [1, 1.2], extraPerDay: 0.1 }] } as unknown as Settings;
  it('utilise la grille de l\'article, sinon la grille par défaut', () => {
    expect(factorFor(2, s)).toBe(1.5);
    expect(factorFor(4, s)).toBe(2.5);
    expect(factorFor(2, s, 'rig')).toBe(1.2);
    expect(factorFor(4, s, 'rig')).toBeCloseTo(1.4);
    expect(factorFor(2, s, 'inconnue')).toBe(1.5);
  });
});

describe('mails', () => {
  it('copies cachées par type et signature commune', () => {
    const s = { mailBcc: { all: 'archive@x.be', invoices: 'compta@x.be', crew: 'regie@x.be' } } as Settings;
    expect(autoBcc(s, 'facture')).toEqual(['archive@x.be', 'compta@x.be']);
    expect(autoBcc(s, 'planning')).toEqual(['archive@x.be', 'regie@x.be']);
    expect(autoBcc(s, 'devis')).toEqual(['archive@x.be']);
    const sig = { mailSignature: '—\n{societe}', company: { name: 'Fab' } } as Settings;
    expect(withSignature('Bonjour', sig)).toBe('Bonjour\n\n—\nFab');
    expect(withSignature('Bonjour\n\n—\nFab', sig)).toBe('Bonjour\n\n—\nFab');
  });
});

describe('suggestions « souvent loué avec »', () => {
  it('classe les articles présents dans les mêmes projets', () => {
    const l = (projectId: string, equipmentId: string) => ({ id: projectId + equipmentId, projectId, equipmentId } as EquipmentLine);
    const all = [l('a', 'micro'), l('a', 'pied'), l('b', 'micro'), l('b', 'pied'), l('b', 'cable'), l('c', 'projo'), l('me', 'micro')];
    expect(coRented([l('me', 'micro')], all).map((x) => x.equipmentId)).toEqual(['pied', 'cable']);
  });
});

describe('paiements partiels', () => {
  it('reste à payer après acomptes et paiements', () => {
    const d = { snapshot: { totalTTC: 1210, deposits: [{ ttc: 200 }] }, payments: [{ id: '1', date: '2026-11-01', amount: 500 }] } as unknown as Doc;
    expect(balanceDue(d)).toBe(510);
  });
});

describe('partage du planning', () => {
  it('lignes nouvelles ou modifiées depuis le dernier envoi', () => {
    const lines = [{ key: '1', text: 'A' }, { key: '2', text: 'B (modifié)' }];
    expect(changedLines(lines, { lines: ['A', 'B'] }).map((l) => l.key)).toEqual(['2']);
    expect(changedLines(lines).length).toBe(2);
  });
});

describe('import Rentman : nouveaux champs', () => {
  it('avertissement, note automatique, groupes de coefficients, comptes, tâches et paiements', () => {
    const { data } = mapRentman({
      contacts: [{ id: 1, displayname: 'Client', contact_warning: 'Paie en retard', projectnote: 'Badge à demander', visit_street: 'Rue A', visit_city: 'Liège', invoice_street: 'Rue B', invoice_city: 'Namur' }],
      equipment: [{ id: 5, name: 'Truss', factor_group: '/factorgroups/2', packed_per: 4, country_of_origin: 'it', in_planner: false }],
      factorgroups: [{ id: 2, name: 'Rigging' }],
      factors: [{ factor_group: '/factorgroups/2', from_days: 1, to_days: 1, factor: 1 }, { factor_group: '/factorgroups/2', from_days: 2, to_days: 3, factor: 1.5 }],
      ledgercodes: [{ id: 9, code: '700100', displayname: 'Location audio', is_credit: true }],
      projects: [{ id: 3, name: 'Gala', customer: '/contacts/1', planperiod_start: '2026-12-10T08:00:00+01:00', planperiod_end: '2026-12-10T23:00:00+01:00' }],
      subprojects: [{ id: 4, project: '/projects/3', name: 'Salle', planperiod_start: '2026-12-10T08:00:00+01:00', planperiod_end: '2026-12-10T23:00:00+01:00' }],
      tasks: [{ id: 7, name: 'Plan de feu', item: '/projects/3', itemtype: 'Project', status: 'open', priority: 'high' }],
      invoices: [{ id: 8, project: '/projects/3', number: 'F1', price: 100, price_invat: 121 }],
      payments: [{ id: 11, invoice: '/invoices/8', amount: 50, moment: '2026-12-15T10:00:00+01:00' }],
    } as never);
    const c = data.contacts.find((x: { id: string }) => x.id.endsWith('1'));
    expect(c.warning).toBe('Paie en retard');
    expect(c.autoProjectNote).toBe('Badge à demander');
    expect(c.billingAddress?.city).toBe('Namur');
    const e = data.equipment[0];
    expect([e.factorGroupId, e.packedPer, e.originCountry, e.hideInPicker]).toEqual(['rm-fg-2', 4, 'IT', true]);
    expect(data.settings[0].factorGroups[0].factors).toEqual([1, 1.5, 1.5]);
    expect(data.settings[0].ledgers[0].code).toBe('700100');
    expect(data.projects[0].tasks[0]).toMatchObject({ text: 'Plan de feu', priority: 'haute', done: false });
    expect(data.docs.find((d: { number: string }) => d.number === 'F1').payments[0].amount).toBe(50);
  });
});
