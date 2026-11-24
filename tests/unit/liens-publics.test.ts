import { afterEach, describe, expect, it, vi } from 'vitest';
import { mySheetLink, newToken, quoteLink, signupLink } from '../../src/mailer';
import { findByCode } from '../../src/codes';
import type { Equipment, SerialUnit } from '../../src/types';

const sansServeur = () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  vi.stubGlobal('location', { protocol: 'http:', hostname: 'localhost', href: 'http://localhost/' });
};
const avecServeur = (url: string) => {
  vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'fab.sync.url' ? url : null), setItem: () => undefined });
  vi.stubGlobal('location', { protocol: 'https:', hostname: 'exemple.be', href: 'https://exemple.be/app/' });
};
afterEach(() => vi.unstubAllGlobals());

describe('jetons des liens publics', () => {
  it('newToken : longueur demandée, alphabet sans caractères ambigus, valeurs uniques', () => {
    const t = newToken(24);
    expect(t).toHaveLength(24);
    expect(t).toMatch(/^[A-Za-z0-9]+$/);
    expect(t).not.toMatch(/[O0Il1]/);
    expect(new Set(Array.from({ length: 100 }, () => newToken())).size).toBe(100);
  });

  it('liens vides sans serveur de synchronisation', () => {
    sansServeur();
    expect(signupLink('abc')).toBe('');
    expect(mySheetLink('abc')).toBe('');
    expect(quoteLink('abc')).toBe('');
  });

  it('liens construits à côté de sync.php quand le serveur est configuré', () => {
    avecServeur('https://exemple.be/api/sync.php');
    expect(signupLink('K')).toBe('https://exemple.be/api/public.php?s=K');
    expect(mySheetLink('T')).toBe('https://exemple.be/api/public.php?m=T');
    expect(quoteLink('D')).toBe('https://exemple.be/api/public.php?d=D');
  });
});

describe('scan : les autres codes (alias) retrouvent l\'article et l\'unité', () => {
  const eq = (over: Partial<Equipment>): Equipment => ({
    id: 'e1', createdAt: '', updatedAt: '', name: 'Caisson SB18', quantity: 4, dailyPrice: 60, isKit: false, kitItems: [], ...over,
  });
  it('findByCode matche code, code-barres et alias', () => {
    const e = eq({ code: 'F-S-0010', barcode: 'DEMO-SUB', extraCodes: ['ANCIEN-123', 'FOURNISSEUR-9'] });
    expect(findByCode('f-s-0010', [e], [])?.equipment?.id).toBe('e1');
    expect(findByCode('demo-sub', [e], [])?.equipment?.id).toBe('e1');
    expect(findByCode('ancien-123', [e], [])?.equipment?.id).toBe('e1');
    expect(findByCode('FOURNISSEUR-9', [e], [])?.equipment?.id).toBe('e1');
    expect(findByCode('inconnu', [e], [])).toBeUndefined();
  });
  it('findByCode matche les alias d\'une unité sérialisée', () => {
    const e = eq({ trackSerials: true });
    const u: SerialUnit = { id: 'u1', createdAt: '', updatedAt: '', equipmentId: 'e1', serial: 'SN-1', barcode: 'F-S-0010-01', status: 'ok', extraCodes: ['ETIQ-OLD'] };
    expect(findByCode('etiq-old', [e], [u])?.unit?.id).toBe('u1');
  });
});
