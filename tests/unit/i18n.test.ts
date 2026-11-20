import { describe, expect, it } from 'vitest';
import { fillTemplate } from '../../src/docTemplate';
import { fieldKey } from '../../src/documents';
import { DICT, tr } from '../../src/i18n';
import type { Doc } from '../../src/types';

const now = '2026-11-20T10:00:00.000Z';
const doc = (lang?: 'fr' | 'nl' | 'en'): Doc => ({
  id: 'd', createdAt: now, updatedAt: now, projectId: 'p', type: 'facture', number: 'F-1', version: 1, status: 'brouillon',
  snapshot: {
    company: { name: 'FabEvent' }, project: { number: 'P-1', name: 'Beurs', start: '2026-12-10T08:00', end: '2026-12-10T18:00', discount: 0 },
    subprojects: [], totalHT: 0, discountAmount: 0, vatRate: 21, vat: 0, totalTTC: 0, issuedAt: now, hidePrices: false, lang,
    customFields: [{ key: 'repas_fourni', label: 'Repas fourni', value: 'Oui' }],
  },
});

describe('langue des documents', () => {
  it('chaque langue a toutes les traductions', () => {
    for (const k of Object.keys(DICT.fr)) {
      expect(DICT.nl[k as keyof typeof DICT.fr], `nl.${k}`).toBeTruthy();
      expect(DICT.en[k as keyof typeof DICT.fr], `en.${k}`).toBeTruthy();
    }
  });
  it('traduit selon la langue du document (français par défaut)', () => {
    expect(tr(doc(), 'totalExcl')).toBe('Total HT');
    expect(tr(doc('nl'), 'totalExcl')).toBe('Totaal excl. btw');
    expect(tr(doc('en'), 'totalIncl')).toBe('Total incl. VAT');
  });
  it('titre et libellés traduits dans les gabarits', () => {
    expect(fillTemplate('{{document.titre}} {{libelle.numero}}', doc('nl'))).toBe('Factuur Nr.');
    expect(fillTemplate('{{document.titre}} {{libelle.numero}}', doc())).toBe('Facture N°');
  });
});

describe('champs personnalisés', () => {
  it('clé de variable sans accents ni espaces', () => {
    expect(fieldKey('Repas fourni')).toBe('repas_fourni');
    expect(fieldKey('Accès livraison (quai)')).toBe('acces_livraison_quai');
  });
  it('variable remplie dans un gabarit', () => {
    expect(fillTemplate('Repas : {{champ.repas_fourni}}', doc())).toBe('Repas : Oui');
  });
});
