import { describe, expect, it } from 'vitest';
import { buildDocHtml } from '../../src/components/DocRender';
import type { Doc, SnapshotLine } from '../../src/types';

const now = '2026-11-20T10:00:00.000Z';
const line = (name: string, total: number, optional = false, optionGroup?: string, optId?: string): SnapshotLine =>
  ({ name, qty: 1, unitPrice: total, days: 1, factor: 1, discount: 0, total, optional, optionGroup, optId, unit: 'jour' });

const devis = (equipment: SnapshotLine[]): Doc => ({
  id: 'd', createdAt: now, updatedAt: now, projectId: 'p', type: 'devis', number: 'D-2026-001', version: 1, status: 'envoye',
  snapshot: {
    company: { name: 'FabEvent SRL' },
    project: { number: 'P-1', name: 'Gala', start: '2026-12-10T08:00', end: '2026-12-11T18:00', discount: 0 },
    subprojects: [{ name: 'Salle', start: '2026-12-10T08:00', end: '2026-12-11T18:00', equipment, crew: [], vehicles: [], subtotal: 100 }],
    totalHT: 100, discountAmount: 0, vatRate: 21, vat: 21, totalTTC: 121, issuedAt: now, hidePrices: false,
    optionalTotal: equipment.filter((l) => l.optional).reduce((a, l) => a + l.total, 0),
  },
} as Doc);

describe('groupes d\'options sur le devis', () => {
  it('groupe les lignes optionnelles par groupe, avec le total des options', () => {
    const html = buildDocHtml(devis([
      line('Enceinte X12', 90),
      line('Enceinte X12 (option 2)', 90, true, 'Son', 'l1'),
      line('Projecteur PAR', 34, true, 'Son', 'l2'),
      line('Nacelle', 480, true, undefined, 'l3'),
    ]));
    expect(html).toContain('doc-options');
    expect(html).toContain('Groupe au choix'); // libellé du groupe
    expect(html).toContain('Son'); // nom du groupe
    expect(html).not.toContain('l3'); // l'id interne ne s'imprime pas
    expect(html).toContain('Nacelle'); // option sans groupe toujours listée
    expect(html).toContain('Total des options');
  });
  it('sans groupe : pas de libellé « au choix »', () => {
    const html = buildDocHtml(devis([line('Base', 100), line('Nacelle', 480, true, undefined, 'l3')]));
    expect(html).toContain('doc-options');
    expect(html).not.toContain('Groupe au choix');
  });
  it('le snapshot porte optId pour l\'acceptation en ligne', () => {
    const d = devis([line('Nacelle', 480, true, 'Levage', 'l9')]);
    expect(d.snapshot.subprojects[0].equipment[0].optId).toBe('l9');
    expect(d.snapshot.subprojects[0].equipment[0].optionGroup).toBe('Levage');
  });
});
