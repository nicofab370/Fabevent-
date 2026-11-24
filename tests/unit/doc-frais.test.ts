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

describe('bloc paiement (QR) sur les factures', () => {
  const facture = (template?: Doc['snapshot']['template']): Doc => ({
    id: 'd', createdAt: now, updatedAt: now, projectId: 'p', type: 'facture', number: 'F-2026-007', version: 1, status: 'envoye',
    snapshot: {
      ...(doc([]) as Doc).snapshot,
      company: { name: 'FabEvent SRL', iban: 'BE68 5390 0754 7034', bic: 'GEBABEBB', vatNumber: 'BE0123456789' },
      extras: [{ label: 'Frais', qty: 1, unitPrice: 50, total: 50 }],
      payment: { communication: '+++000/2026/00745+++', structured: true },
      ...(template ? { template } : {}),
    },
  });
  it('QR présent avec le gabarit par défaut', () => {
    const html = buildDocHtml(facture());
    expect(html).toContain('BE68 5390 0754 7034');
    expect(html).toContain('<svg');
    expect(html).toContain('+++000/2026/00745+++');
  });
  it('QR réinséré même si l’ancien gabarit n’a pas {{bloc.paiement}}', () => {
    const t = { style: {} as never, html: { header: '{{bloc.entete}}', layout: '{{bloc.salles}}{{bloc.totaux}}', footer: '', css: '' } };
    const html = buildDocHtml(facture(t as Doc['snapshot']['template']));
    expect(html).toContain('BE68 5390 0754 7034');
    expect(html).toContain('<svg');
  });
});
