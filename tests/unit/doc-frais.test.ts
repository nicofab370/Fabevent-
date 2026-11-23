import { describe, expect, it } from 'vitest';
import { buildDocHtml } from '../../src/components/DocRender';
import type { Doc } from '../../src/types';

const now = '2026-11-20T10:00:00.000Z';
const doc = (extras: NonNullable<Doc['snapshot']['extras']>): Doc => ({
  id: 'd', createdAt: now, updatedAt: now, projectId: 'p', type: 'facture', number: 'F-2026-007', version: 1, status: 'envoye',
  snapshot: {
    company: { name: 'FabEvent SRL' },
    project: { number: 'P-1', name: 'Beurs', start: '2026-12-10T08:00', end: '2026-12-11T18:00', discount: 0 },
    subprojects: [],
    extras,
    totalHT: 480, discountAmount: 0, vatRate: 21, vat: 100.8, totalTTC: 580.8, issuedAt: now, hidePrices: false,
  },
});

describe('frais supplémentaires dans les documents', () => {
  it('affiche le fournisseur quand il est renseigné', () => {
    const html = buildDocHtml(doc([{ label: 'Location nacelle 12 m', qty: 1, unitPrice: 480, total: 480, supplier: 'SonoPro' }]));
    expect(html).toContain('Location nacelle 12 m');
    expect(html).toContain('SonoPro');
  });
  it("n'affiche aucun fournisseur quand il est vide", () => {
    const html = buildDocHtml(doc([{ label: 'Hôtel équipe', qty: 2, unitPrice: 100, total: 200 }]));
    expect(html).toContain('Hôtel équipe');
    expect(html).not.toContain('—');
  });
  it('échappe le fournisseur saisi en texte libre', () => {
    const html = buildDocHtml(doc([{ label: 'Déplacement', qty: 1, unitPrice: 50, total: 50, supplier: '<b>X</b>' }]));
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).not.toContain('<b>X</b>');
  });
});
