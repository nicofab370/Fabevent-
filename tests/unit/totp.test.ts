import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, newTotpSecret, totpAt, verifyTotp } from '../../src/totp';

// Vecteurs de test RFC 6238 (annexe B, SHA-1, secret ASCII « 12345678901234567890 »)
// secret base32 : GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp (RFC 6238)', () => {
  it('base32 aller-retour', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 66]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    expect(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq====')).toEqual(base32Decode(RFC_SECRET));
  });

  it('HOTP = vecteurs RFC 6238 (8 chiffres)', async () => {
    // T = 59 s → compteur 1 → 94287082 ; T = 1111111109 → 07081804 ; T = 1234567890 → 89005924
    expect(await hotp(RFC_SECRET, 1, 8)).toBe('94287082');
    expect(await hotp(RFC_SECRET, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(await hotp(RFC_SECRET, Math.floor(1234567890 / 30), 8)).toBe('89005924');
  });

  it('TOTP à 6 chiffres et vérification ±1 pas', async () => {
    expect(await totpAt(RFC_SECRET, 59_000, 6)).toBe('287082'); // 94287082 tronqué à 6
    expect(await verifyTotp(RFC_SECRET, '287082', 59_000)).toBe(true);
    expect(await verifyTotp(RFC_SECRET, '287082', 59_000 + 30_000)).toBe(true); // fenêtre +1
    expect(await verifyTotp(RFC_SECRET, '287082', 59_000 + 90_000)).toBe(false); // hors fenêtre
    expect(await verifyTotp(RFC_SECRET, '000000', 59_000)).toBe(false);
    expect(await verifyTotp(RFC_SECRET, 'abc', 59_000)).toBe(false);
  });

  it('nouveau secret : 32 caractères base32 aléatoires', () => {
    const a = newTotpSecret(), b = newTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(a).not.toBe(b);
  });
});
