import { describe, expect, it } from 'vitest';
import { fillTemplate, stripScripts } from '../../src/docTemplate';
import { recurrenceStarts, shiftBetween, shiftDate } from '../../src/projectOps';
import type { Doc } from '../../src/types';
import { buildUbl } from '../../src/ubl';

describe('décalage et récurrences', () => {
  it('décale en jours et minutes', () => {
    expect(shiftDate('2026-12-10T08:00', { days: 7, minutes: 90 })).toBe('2026-12-17T09:30');
    expect(shiftDate('2026-12-10', { days: -1, minutes: 0 })).toBe('2026-12-09');
  });
  it('calcule l’écart entre deux dates', () => {
    expect(shiftBetween('2026-12-10T08:00', '2027-01-02T10:30')).toEqual({ days: 23, minutes: 150 });
  });
  it('génère les occurrences', () => {
    expect(recurrenceStarts('2026-01-31T08:00', 'semaine', 2)).toEqual(['2026-02-07T08:00', '2026-02-14T08:00']);
    expect(recurrenceStarts('2026-01-15T08:00', 'mois', 1)).toEqual(['2026-02-15T08:00']);
  });
});

const now = '2026-11-20T10:00:00.000Z';
const doc = (extra: Partial<Doc['snapshot']> = {}, type: Doc['type'] = 'facture'): Doc => ({
  id: 'd', createdAt: now, updatedAt: now, projectId: 'p', type, number: 'F-2026-007', version: 1, status: 'envoye', contactPerson: 'Joost <b>',
  snapshot: {
    company: { name: 'FabEvent SRL', vatNumber: 'BE0123456789', peppolId: '0208:0123456789', country: 'BE', iban: 'BE68539007547034' },
    client: { id: 'c', createdAt: now, updatedAt: now, type: 'client', company: 'Evenementen <BV>', country: 'NL', vatNumber: 'NL000000000B01', peppolId: '0106:00000000' },
    project: { number: 'P-1', name: 'Beurs', start: '2026-12-10T08:00', end: '2026-12-11T18:00', discount: 0 },
    subprojects: [{ name: 'Stand', start: '', end: '', equipment: [{ name: 'Écran', qty: 2, unitPrice: 75, days: 2, factor: 1.5, discount: 0, total: 225 }], crew: [], vehicles: [], subtotal: 225 }],
    extras: [{ label: 'Hôtel', qty: 2, unitPrice: 100, total: 200 }],
    totalHT: 425, discountAmount: 0, vatRate: 0, vat: 0, totalTTC: 425, issuedAt: now, dueDate: now, hidePrices: false,
    vatRegime: 'autoliquidation', vatMention: 'Autoliquidation', payment: { communication: '+++000/2026/00745+++', structured: true },
    ...extra,
  },
});

describe('gabarits de documents', () => {
  it('remplit et échappe les variables', () => {
    const html = fillTemplate('<p>{{client.nom}} — {{client.contact}} — {{total.ttc}} — {projet}</p>', doc());
    expect(html).toContain('Evenementen &lt;BV&gt;');
    expect(html).toContain('Joost &lt;b&gt;');
    expect(html).toContain('425,00');
    expect(html).toContain('Beurs');
  });
  it('insère les blocs tels quels et retire les scripts', () => {
    expect(fillTemplate('{{bloc.x}}', doc(), { 'bloc.x': '<table></table>' })).toBe('<table></table>');
    expect(stripScripts('<p onclick="x()">a</p><script>alert(1)</script>')).toBe('<p>a</p>');
  });
});

describe('Peppol UBL', () => {
  const xml = buildUbl(doc());
  it('autoliquidation : catégorie AE avec motif', () => {
    expect(xml).toContain('<cbc:ID>AE</cbc:ID>');
    expect(xml).toContain('VATEX-EU-AE');
  });
  it('virement SEPA avec communication structurée', () => {
    expect(xml).toContain('<cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>');
    expect(xml).toContain('<cbc:PaymentID>000202600745</cbc:PaymentID>');
  });
  it('totaux cohérents (lignes + frais = HT)', () => {
    const lineSum = [...xml.matchAll(/<cac:InvoiceLine>[\s\S]*?<cbc:LineExtensionAmount currencyID="EUR">([\d.]+)</g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(lineSum).toBe(425);
    expect(xml).toContain('<cbc:PayableAmount currencyID="EUR">425.00</cbc:PayableAmount>');
  });
  it('un avoir devient une CreditNote 381', () => {
    const cn = buildUbl({ ...doc({ simpleLines: [{ label: 'Avoir', ht: -100 }], totalHT: -100, totalTTC: -100, refNumber: 'F-2026-007' }), type: 'avoir' });
    expect(cn).toContain('<CreditNote');
    expect(cn).toContain('<cbc:CreditNoteTypeCode>381</cbc:CreditNoteTypeCode>');
    expect(cn).toContain('<cbc:PayableAmount currencyID="EUR">100.00</cbc:PayableAmount>');
  });
});
