import { describe, expect, it } from 'vitest';
import { epcPayload, qrSvg, structuredCommunication, suggestRegime } from '../../src/payment';

/** Contrôle modulo 97 d'une communication structurée belge. */
function isValidStructured(comm: string): boolean {
  const d = comm.replace(/\D/g, '');
  if (d.length !== 12) return false;
  const check = Number(d.slice(0, 10)) % 97 || 97;
  return check === Number(d.slice(10));
}


describe('communication structurée belge', () => {
  it('calcule la clé modulo 97', () => {
    // 2026002 % 97 = 60
    expect(structuredCommunication('F-2026-002')).toBe('+++000/2026/00260+++');
    expect(isValidStructured('+++000/2026/00260+++')).toBe(true);
  });
  it('utilise 97 quand le reste est nul', () => {
    const c = structuredCommunication('97');
    expect(c.replace(/\D/g, '').slice(-2)).toBe('97');
    expect(isValidStructured(c)).toBe(true);
  });
  it('rejette une communication erronée', () => {
    expect(isValidStructured('+++000/2026/00261+++')).toBe(false);
  });
});

describe('QR code de virement EPC', () => {
  const p = epcPayload({ name: 'FabEvent SRL', iban: 'BE68 5390 0754 7034', bic: 'gebabebb', amount: 1234.5, communication: '+++000/2026/00260+++' });
  it('respecte le format BCD 002', () => {
    const l = p.split('\n');
    expect(l.slice(0, 4)).toEqual(['BCD', '002', '1', 'SCT']);
    expect(l[4]).toBe('GEBABEBB');
    expect(l[6]).toBe('BE68539007547034');
    expect(l[7]).toBe('EUR1234.50');
    expect(l[10]).toBe('000202600260');
  });
  it('produit un SVG', () => {
    expect(qrSvg(p)).toMatch(/^<svg[\s\S]*<path d="M/);
  });
});

describe('régime de TVA suggéré', () => {
  it('Belgique → normal, UE assujetti → autoliquidation, hors UE → hors_ue', () => {
    expect(suggestRegime('BE', 'BE0123456789')).toBe('normal');
    expect(suggestRegime('NL', 'NL000000000B01')).toBe('autoliquidation');
    expect(suggestRegime('FR', undefined)).toBe('normal');
    expect(suggestRegime('CH', 'CHE-123')).toBe('hors_ue');
  });
});
