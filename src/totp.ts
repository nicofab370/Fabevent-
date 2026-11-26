/*
 * MFA par TOTP (RFC 6238) : code à 6 chiffres, HMAC-SHA-1, pas de 30 s,
 * compatible Google Authenticator / Microsoft Authenticator / Authy / 1Password…
 * Secret en base32 (20 octets), stocké sur le compte utilisateur.
 */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let out = '', bits = 0, acc = 0;
  for (const b of bytes) {
    acc = ((acc << 8) | b) & 0xfffff; bits += 8;
    while (bits >= 5) { out += B32[(acc >> (bits - 5)) & 31]; bits -= 5; acc &= (1 << bits) - 1; }
  }
  if (bits > 0) out += B32[(acc << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.replace(/=+$/i, '').replace(/[^A-Z2-7]/gi, '').toUpperCase();
  let bits = 0, acc = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) continue;
    acc = ((acc << 5) | v) & 0xfffff; bits += 5;
    if (bits >= 8) { out.push((acc >> (bits - 8)) & 255); bits -= 8; acc &= (1 << bits) - 1; }
  }
  return new Uint8Array(out);
}

/** Nouveau secret TOTP : 20 octets aléatoires en base32 (32 caractères). */
export function newTotpSecret(): string {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return base32Encode(b);
}

/** HOTP (RFC 4226) : HMAC-SHA-1 du compteur sur 8 octets big-endian, tronqué dynamique. */
export async function hotp(secretB32: string, counter: number, digits = 6): Promise<string> {
  const key = new Uint8Array(base32Decode(secretB32));
  const msg = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) { msg[i] = c & 255; c = Math.floor(c / 256); }
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, msg));
  const off = sig[sig.length - 1] & 15;
  const bin = ((sig[off] & 127) << 24) | (sig[off + 1] << 16) | (sig[off + 2] << 8) | sig[off + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/** Code TOTP à un instant donné (pas de 30 s). */
export const totpAt = (secretB32: string, timeMs: number, digits = 6): Promise<string> =>
  hotp(secretB32, Math.floor(timeMs / 1000 / 30), digits);

/** Vérifie un code saisi (fenêtre ±1 pas de 30 s pour la latence). */
export async function verifyTotp(secretB32: string, code: string, timeMs = Date.now(), window = 1): Promise<boolean> {
  const c = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return false;
  const counter = Math.floor(timeMs / 1000 / 30);
  for (let w = -window; w <= window; w++) {
    if (await hotp(secretB32, counter + w) === c) return true;
  }
  return false;
}

/** URI otpauth:// pour le QR code d'enrôlement. */
export function otpauthUri(issuer: string, account: string, secretB32: string): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
