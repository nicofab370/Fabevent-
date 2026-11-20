import { describe, expect, it } from 'vitest';
import { buildEml, mailtoUrl } from '../../src/email';

/** Extrait et décode la partie jointe nommée `name`. */
function part(eml: string, name: string): string {
  const boundary = eml.match(/boundary="([^"]+)"/)![1];
  const p = eml.split(`--${boundary}`).find((x) => x.includes(`filename="${name}"`))!;
  const b64 = p.split('\r\n\r\n')[1].replace(/\s+/g, '');
  return Buffer.from(b64, 'base64').toString('utf8');
}

describe('email avec pièces jointes (.eml)', () => {
  const draft = { to: 'julie@exemple.be', subject: 'Devis D-2026-005 v1 — Conférence', body: 'Bonjour,\nCi-joint notre devis.\nÀ bientôt' };
  it('brouillon non envoyé, objet encodé, texte et pièces jointes', async () => {
    const pdf = new Blob(['%PDF-1.4 contenu fictif'], { type: 'application/pdf' });
    const xml = new Blob(['<Invoice>é</Invoice>'], { type: 'application/xml' });
    const eml = await buildEml(draft, [{ name: 'Devis-D-2026-005.pdf', type: 'application/pdf', blob: pdf }, { name: 'F-1.xml', type: 'application/xml', blob: xml }]);
    expect(eml).toContain('To: julie@exemple.be');
    expect(eml).toContain('X-Unsent: 1');
    expect(eml).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    expect(eml).toContain('Content-Type: multipart/mixed');
    expect(part(eml, 'Devis-D-2026-005.pdf')).toBe('%PDF-1.4 contenu fictif');
    expect(part(eml, 'F-1.xml')).toBe('<Invoice>é</Invoice>');
    // lignes de 76 caractères au plus (norme MIME)
    expect(eml.split('\r\n').every((l) => l.length <= 998)).toBe(true);
  });
  it('lien mailto de secours : texte encodé, @ lisible', () => {
    const url = mailtoUrl(draft);
    expect(url.startsWith('mailto:julie@exemple.be?subject=')).toBe(true);
    expect(decodeURIComponent(url.split('body=')[1])).toBe(draft.body);
  });
});
