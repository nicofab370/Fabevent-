import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { BUILTIN_TEMPLATES, CODE128_PATTERNS, code128Modules, code128Values, emptyTemplate, fitsA4, labelCss, labelHtml, labelSheetHtml, perSheet, type LabelField } from '../../src/labelTemplates';

prepareZXingModule({ overrides: { wasmBinary: readFileSync('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm').buffer as ArrayBuffer }, fireImmediately: true });

/** dessine le code-barres en pixels (3 px par module, zones blanches) et le relit avec ZXing */
async function decode(text: string) {
  const mods = code128Modules(text);
  const px = 3, quiet = 12;
  const W = (mods.split('').reduce((a, c) => a + Number(c), 0) + quiet * 2) * px, H = 30;
  const data = new Uint8ClampedArray(W * H * 4).fill(255);
  let x = quiet * px;
  mods.split('').forEach((c, i) => {
    const w = Number(c) * px;
    if (i % 2 === 0) for (let y = 0; y < H; y++) for (let k = x; k < x + w; k++) { const o = (y * W + k) * 4; data[o] = data[o + 1] = data[o + 2] = 0; }
    x += w;
  });
  const r = await readBarcodes({ data, width: W, height: H, colorSpace: 'srgb' } as ImageData, { formats: ['Code128'], tryHarder: true });
  return r[0]?.text;
}

describe('Étiquettes', () => {
  it('Code 128 : table des motifs cohérente (11 modules, 13 pour l’arrêt)', () => {
    expect(CODE128_PATTERNS).toHaveLength(107);
    CODE128_PATTERNS.forEach((p, i) => expect(p.split('').reduce((a, c) => a + Number(c), 0)).toBe(i === 106 ? 13 : 11));
  });
  it('Code 128 : chiffres en jeu C, contrôle correct', () => {
    const v = code128Values('123456');
    expect(v[0]).toBe(105);
    expect(v.slice(1, 4)).toEqual([12, 34, 56]);
    expect(v[v.length - 1]).toBe(106);
  });
  it.each(['F-S-0010-03', 'DEMO-KITPAR', '1234567890', 'AB1234567', 'sm58 n°2'])('Code 128 relu par ZXing : %s', async (t) => {
    expect(await decode(t)).toBe(t.replace('°', '?'));
  });
  it('Planche : une page par planche, étiquettes à sauter', () => {
    const t = BUILTIN_TEMPLATES.find((x) => x.id === 'a4-24')!;
    expect(perSheet(t)).toBe(24);
    const labels = Array.from({ length: 30 }, (_, i) => ({ code: `C${i}`, title: `Article ${i}` }));
    const html = labelSheetHtml(t, labels, 'Ma société', undefined, 5);
    expect(html.match(/class="sheet"/g)).toHaveLength(2);
    expect(html.match(/lab blank/g)).toHaveLength(5);
    expect(html).toContain('Article 29');
  });
  it('Les formats standard et le nouveau modèle tiennent sur une feuille A4', () => {
    for (const t of [...BUILTIN_TEMPLATES, emptyTemplate()]) expect(fitsA4(t), t.name).toBe(true);
  });
  it('Toutes les mises en page standard produisent leur étiquette', () => {
    for (const t of BUILTIN_TEMPLATES) {
      const html = labelSheetHtml(t, [{ code: 'X-1', title: 'Test', serial: '42' }], 'Soc');
      expect(html).toContain(`lab ${t.layout}`);
      expect(html.includes('<svg') || t.layout === 'texte' || t.symbol === 'aucun').toBe(true);
    }
  });
});

describe('mise en page libre et réglages fins', () => {
  const base = { id: 'x', name: 'Libre', sheet: 'rouleau' as const, w: 62, h: 29, layout: 'libre' as const, fields: ['title', 'serial', 'code'] as LabelField[] };
  const l = { code: 'F-S-0010-03', title: 'Lyre #3', serial: 'SN1' };
  it('QR + code-barres, position et taille', () => {
    const t = { ...base, symbol: 'les-deux' as const, symbolPos: 'droite' as const, symbolSize: 80 };
    const html = labelHtml(t, l, 'Ma société');
    expect((html.match(/<svg/g) || []).length).toBe(2);
    expect(labelCss(t)).toContain('flex-direction:row-reverse');
  });
  it('sans code : texte seul', () => {
    expect(labelHtml({ ...base, symbol: 'aucun' }, l, '')).not.toContain('<svg');
  });
  it('textes libres, préfixe, styles par zone, police, logo', () => {
    const t = { ...base, header: 'LOCATION', footer: 'Ne pas jeter', font: 'mono' as const, align: 'droite' as const, logo: 'haut' as const,
      styles: { serial: { prefix: 'S/N : ', upper: true, size: 150 }, title: { bold: false, wrap: false } } };
    const html = labelHtml(t, l, '', undefined, 'data:image/png;base64,AAAA');
    expect(html).toContain('S/N : SN1');
    const txt = html.replace(/<[^>]+>/g, '');
    expect(txt.indexOf('LOCATION')).toBeLessThan(txt.indexOf('Lyre #3'));
    expect(html).toContain('class="logo"');
    const css = labelCss(t);
    expect(css).toContain('.lab .f-serial{font-size:');
    expect(css).toContain('text-transform:uppercase');
    expect(css).toContain('.lab .f-title{font-weight:400;white-space:nowrap}');
    expect(css).toContain('ui-monospace');
    expect(css).toContain('text-align:right');
  });
  it('préfixes par défaut conservés', () => {
    const html = labelHtml({ ...base, layout: 'qr-gauche', fields: ['serial', 'contents'] }, { ...l, contents: 'Housse' }, '');
    expect(html).toContain('n° SN1');
    expect(html).toContain('+ Housse');
  });
});

describe('rubans d’étiqueteuse (Brother PT-P750W, Dymo)', async () => {
  const { printableHeight, DEVICE_TAPES } = await import('../../src/labelTemplates');
  it('tous les rubans TZe de la PT-P750W ont un modèle, et la largeur imprimable vient de la table Brother', () => {
    for (const mm of DEVICE_TAPES.ptouch!) expect(BUILTIN_TEMPLATES.some((t) => t.device === 'ptouch' && t.h === mm)).toBe(true);
    expect(printableHeight({ sheet: 'ruban', device: 'ptouch', h: 12 })).toBeCloseTo(70 / (180 / 25.4), 3);
    expect(printableHeight({ sheet: 'ruban', device: 'ptouch', h: 3.5 })).toBeCloseTo(24 / (180 / 25.4), 3);
  });
  it('Dymo : rubans D1 et étiquettes LabelWriter', () => {
    for (const mm of DEVICE_TAPES['dymo-lm']!) expect(BUILTIN_TEMPLATES.some((t) => t.device === 'dymo-lm' && t.h === mm)).toBe(true);
    expect(BUILTIN_TEMPLATES.filter((t) => t.device === 'dymo-lw').length).toBeGreaterThanOrEqual(6);
  });
  it('ruban : page = longueur × largeur du ruban, texte centré dans la zone imprimable', () => {
    const t = BUILTIN_TEMPLATES.find((x) => x.id === 'pt-12')!;
    const html = labelSheetHtml(t, [{ code: 'F-S-0001-01', title: 'Micro' }], '');
    expect(html).toContain('@page{size:45mm 12mm');
    expect(labelCss(t)).toMatch(/padding-top:1\.6\dmm/); // (12 − 9,88) / 2 + 0,6
  });
});

describe('taille du QR et place perdue', async () => {
  const { qrSizeMm } = await import('../../src/labelTemplates');
  const big = { id: 'b', name: 'B', sheet: 'rouleau' as const, w: 102, h: 51, layout: 'qr-dessus' as const, fields: ['title'] as LabelField[] };
  it('QR au-dessus du texte : il remplit dès 100 % la hauteur laissée par le texte ; au-delà plafonné, en dessous plus petit', () => {
    const n = qrSizeMm(big);
    expect(n.mm).toBeGreaterThan(40); // ~ 48 mm intérieurs moins une ligne de texte
    expect(qrSizeMm({ ...big, symbolSize: 150 }).capped).toBe(true);
    expect(qrSizeMm({ ...big, symbolSize: 60 }).mm).toBeLessThan(n.mm);
    const css = labelCss(big);
    expect(css).toContain('.lab.qr-dessus .qr{flex:1 1 0');
    expect(css).toContain('.lab.qr-dessus .qr svg{width:auto;height:100%');
  });
  it('QR à gauche du texte : agrandissable au-delà de 100 % tant qu’il y a de la place', () => {
    const t = { ...big, w: 100, h: 30, layout: 'qr-gauche' as const };
    expect(qrSizeMm({ ...t, symbolSize: 130 }).mm).toBeGreaterThanOrEqual(qrSizeMm(t).mm);
    expect(qrSizeMm({ ...t, symbolSize: 200 }).mm).toBeLessThanOrEqual(30 - 3 + 0.01);
  });
  it('pas de bordure blanche dans le QR d’une étiquette (la marge de l’étiquette en tient lieu)', () => {
    const html = labelHtml({ ...big, layout: 'qr-gauche' }, { code: 'X-1', title: 'T' }, '');
    const vb = html.match(/viewBox="0 0 (\d+) \1"/);
    expect(vb && Number(vb[1])).toBe(21); // QR version 1 : 21 modules, sans marge
  });
});

describe('texte à côté et sous le QR, texte tourné', () => {
  const t = { id: 'm', name: 'Mixte', sheet: 'rouleau' as const, w: 40, h: 40, layout: 'libre' as const, symbol: 'qr' as const, symbolPos: 'gauche' as const,
    fields: ['title', 'code', 'serial'] as LabelField[], styles: { code: { place: 'dessous' as const }, serial: { place: 'dessous' as const } } };
  const l = { code: 'F-S-0010-03', title: 'Table de mix #3', serial: 'SN1' };
  it('nom à côté du QR, code et n° de série dessous sur toute la largeur', () => {
    const html = labelHtml(t, l, '');
    const top = html.slice(html.indexOf('class="top"'), html.indexOf('tx-bas'));
    const bas = html.slice(html.indexOf('tx-bas'));
    expect(top.replace(/<[^>]+>/g, '')).toContain('Table de mix #3');
    expect(top).not.toContain('F-S-0010-03</div>');
    expect(bas).toContain('F-S-0010-03');
    expect(bas).toContain('n° SN1');
    expect(labelCss(t)).toContain('.lab.libre .top{display:flex');
  });
  it('texte d’à côté tourné (lettres couchées, pas empilées)', () => {
    const css = labelCss({ ...t, sideRotate: 270 });
    expect(css).toContain('writing-mode:vertical-rl;text-orientation:mixed');
    expect(css).toContain('transform:rotate(180deg)');
    expect(labelCss({ ...t, sideRotate: 90 })).not.toContain('rotate(180deg)');
  });
  it('sans réglage de position : tout à côté du code, comme avant', () => {
    expect(labelHtml({ ...t, styles: undefined }, l, '')).not.toContain('tx-bas');
  });
});

describe('nom raccourci : le #x reste visible', async () => {
  const { splitUnitNo } = await import('../../src/labelTemplates');
  it('sépare le nom et le numéro d’unité', () => {
    expect(splitUnitNo('Table de mix Allen & Heath #12')).toEqual(['Table de mix Allen & Heath', ' #12']);
    expect(splitUnitNo('Câble XLR 10 m')).toEqual(['Câble XLR 10 m', '']);
    expect(splitUnitNo('Kit #2 complet')).toEqual(['Kit #2 complet', '']);
  });
  it('le « … » coupe le nom, avant le #x', () => {
    const t = { id: 'r', name: 'R', sheet: 'ruban' as const, device: 'ptouch' as const, w: 30, h: 12, layout: 'libre' as const, symbol: 'qr' as const, fields: ['title'] as LabelField[], styles: { title: { wrap: false } } };
    const html = labelHtml(t, { code: 'X', title: 'Console Allen & Heath Qu-16 #3' }, '');
    expect(html).toContain('<span class="nm">Console Allen &amp; Heath Qu-16</span><span class="no"> #3</span>');
    expect(labelCss(t)).toContain('.lab .f-title .nm{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis');
  });
});
