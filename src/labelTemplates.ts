import { qrSvg } from './payment';

/*
 * Modèles d'étiquettes (planches A4 et rouleaux) : format, mise en page, champs imprimés.
 * Les formats standard sont fournis ; chacun peut être dupliqué et modifié, ou créé de zéro
 * (enregistré dans les paramètres, donc synchronisé entre appareils).
 */

export type LabelLayout = 'qr-gauche' | 'qr-dessus' | 'qr-seul' | 'code-barres' | 'texte' | 'cable';
export type LabelField = 'title' | 'code' | 'serial' | 'category' | 'location' | 'contents' | 'company';

export interface LabelTemplate {
  id: string;
  name: string;
  /** planche A4 (plusieurs étiquettes par page) ou rouleau (une étiquette par page) */
  sheet: 'a4' | 'rouleau';
  /** taille d'une étiquette (mm) */
  w: number;
  h: number;
  /** planche : colonnes, lignes, marges et espaces (mm) */
  cols?: number;
  rows?: number;
  marginTop?: number;
  marginLeft?: number;
  gapX?: number;
  gapY?: number;
  layout: LabelLayout;
  fields: LabelField[];
  /** taille du texte en % (100 = automatique selon la hauteur) */
  textScale?: number;
  /** cadre imprimé autour de l'étiquette (étiquettes à découper) */
  border?: boolean;
  /** texte libre ajouté (ex. « Propriété de … — ne pas jeter ») */
  footer?: string;
  builtin?: boolean;
}

export interface SheetLabel { code: string; title: string; sub?: string; serial?: string; contents?: string; category?: string; location?: string }

export const LAYOUT_LABELS: Record<LabelLayout, string> = {
  'qr-gauche': 'QR à gauche, texte à droite',
  'qr-dessus': 'QR au-dessus, texte centré',
  'qr-seul': 'QR seul avec le code dessous (petites étiquettes)',
  'code-barres': 'Code-barres (Code 128) pour douchette',
  texte: 'Texte seul, en grand (bacs, flight cases)',
  cable: 'Drapeau pour câble (QR des deux côtés du pli)',
};
export const FIELD_LABELS: Record<LabelField, string> = {
  title: 'Nom de l’article', code: 'Code', serial: 'N° de série', category: 'Catégorie',
  location: 'Emplacement', contents: 'Contenu fourni', company: 'Nom de la société',
};
export const ALL_FIELDS = Object.keys(FIELD_LABELS) as LabelField[];

const std = (t: Omit<LabelTemplate, 'builtin'>): LabelTemplate => ({ ...t, builtin: true });
/** formats standard (planches Avery / Herma courantes, rouleaux d'étiqueteuses thermiques) */
export const BUILTIN_TEMPLATES: LabelTemplate[] = [
  std({ id: 'a4-24', name: 'Planche A4 — 24 étiquettes 70 × 37 mm', sheet: 'a4', w: 70, h: 37, cols: 3, rows: 8, marginTop: 0.5, marginLeft: 0, layout: 'qr-gauche', fields: ['title', 'code', 'serial', 'contents', 'company'] }),
  std({ id: 'a4-65', name: 'Planche A4 — 65 étiquettes 38 × 21 mm', sheet: 'a4', w: 38.1, h: 21.2, cols: 5, rows: 13, marginTop: 10.7, marginLeft: 4.7, gapX: 2.5, layout: 'qr-gauche', fields: ['title', 'code', 'contents', 'company'] }),
  std({ id: 'a4-21', name: 'Planche A4 — 21 étiquettes 63,5 × 38,1 mm (L7160)', sheet: 'a4', w: 63.5, h: 38.1, cols: 3, rows: 7, marginTop: 15.1, marginLeft: 7.2, gapX: 2.5, layout: 'qr-gauche', fields: ['title', 'code', 'serial', 'category', 'company'] }),
  std({ id: 'a4-40', name: 'Planche A4 — 40 étiquettes 48,5 × 25,4 mm', sheet: 'a4', w: 48.5, h: 25.4, cols: 4, rows: 10, marginTop: 21.5, marginLeft: 8, layout: 'qr-seul', fields: ['code'] }),
  std({ id: 'a4-14', name: 'Planche A4 — 14 étiquettes 99,1 × 38,1 mm, code-barres', sheet: 'a4', w: 99.1, h: 38.1, cols: 2, rows: 7, marginTop: 15.1, marginLeft: 4.7, gapX: 2.5, layout: 'code-barres', fields: ['title', 'code', 'company'] }),
  std({ id: 'a4-8', name: 'Planche A4 — 8 étiquettes 99,1 × 67,7 mm, texte en grand', sheet: 'a4', w: 99.1, h: 67.7, cols: 2, rows: 4, marginTop: 13, marginLeft: 4.7, gapX: 2.5, layout: 'texte', fields: ['title', 'code', 'category', 'location', 'contents'] }),
  std({ id: 'rouleau', name: 'Rouleau — 50 × 25 mm', sheet: 'rouleau', w: 50, h: 25, layout: 'qr-gauche', fields: ['title', 'code', 'contents', 'company'] }),
  std({ id: 'rouleau-62', name: 'Rouleau — 62 × 29 mm (Brother QL)', sheet: 'rouleau', w: 62, h: 29, layout: 'qr-gauche', fields: ['title', 'code', 'serial', 'company'] }),
  std({ id: 'rouleau-102', name: 'Rouleau — 102 × 51 mm, QR au-dessus (Zebra, Dymo XL)', sheet: 'rouleau', w: 102, h: 51, layout: 'qr-dessus', fields: ['title', 'code', 'serial', 'location', 'company'] }),
  std({ id: 'rouleau-57', name: 'Rouleau — 57 × 32 mm, code-barres', sheet: 'rouleau', w: 57, h: 32, layout: 'code-barres', fields: ['title', 'code'] }),
  std({ id: 'cable', name: 'Drapeau pour câble — 100 × 19 mm (rouleau)', sheet: 'rouleau', w: 100, h: 19, layout: 'cable', fields: ['title', 'code'] }),
];

export const emptyTemplate = (): LabelTemplate => ({
  id: '', name: 'Mon modèle', sheet: 'a4', w: 70, h: 37, cols: 3, rows: 8, marginTop: 0.5, marginLeft: 0, gapX: 0, gapY: 0,
  layout: 'qr-gauche', fields: ['title', 'code', 'company'], textScale: 100,
});

/* ---------- Code 128 (jeu B, chiffres en jeu C) ---------- */
const C128 = ('212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 '
  + '221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 '
  + '231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 '
  + '314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 '
  + '111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 '
  + '114131 311141 411131 211412 211214 211232 2331112').split(' ');
export const CODE128_PATTERNS = C128;

/** valeurs Code 128 (départ, données, contrôle, arrêt) ; les longues suites de chiffres passent en jeu C (plus court) */
export function code128Values(text: string): number[] {
  const s = Array.from(text).map((ch) => (ch.charCodeAt(0) >= 32 && ch.charCodeAt(0) <= 126 ? ch : '?')).join('');
  const out: number[] = [];
  const digitsAt = (i: number) => { let n = 0; while (i + n < s.length && /\d/.test(s[i + n])) n++; return n; };
  let set: 'B' | 'C' = digitsAt(0) >= 4 && digitsAt(0) % 2 === 0 ? 'C' : 'B';
  out.push(set === 'C' ? 105 : 104);
  for (let i = 0; i < s.length;) {
    const d = digitsAt(i);
    if (set === 'B' && d >= 6) {
      // assez de chiffres pour gagner de la place : passage en jeu C (en gardant un nombre pair)
      if (d % 2) { out.push(s.charCodeAt(i) - 32); i++; }
      out.push(99); set = 'C';
      continue;
    }
    if (set === 'C') {
      if (d >= 2) { out.push(Number(s.slice(i, i + 2))); i += 2; continue; }
      out.push(100); set = 'B';
      continue;
    }
    out.push(s.charCodeAt(i) - 32); i++;
  }
  const check = out.reduce((a, v, i) => a + v * (i || 1), 0) % 103;
  return [...out, check, 106];
}

/** largeurs des barres et espaces (en modules), zones blanches comprises */
export function code128Modules(text: string): string {
  return code128Values(text).map((v) => C128[v]).join('');
}

/** code-barres Code 128 en SVG (largeur fixée par le conteneur) */
export function code128Svg(text: string): string {
  const widths = code128Modules(text);
  const quiet = 10;
  let x = quiet, d = '';
  for (let i = 0; i < widths.length; i++) {
    const w = Number(widths[i]);
    if (i % 2 === 0) d += `M${x},0h${w}v40h-${w}z`;
    x += w;
  }
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} 40" preserveAspectRatio="none" shape-rendering="crispEdges"><rect width="${total}" height="40" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

/* ---------- rendu HTML ---------- */
const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** lignes de texte d'une étiquette, dans l'ordre des champs choisis */
function lines(t: LabelTemplate, l: SheetLabel, company: string): { cls: string; text: string }[] {
  const val: Record<LabelField, string | undefined> = {
    title: l.title, code: l.code, serial: l.serial ? `n° ${l.serial}` : undefined, category: l.category, location: l.location,
    contents: l.contents ? `+ ${l.contents}` : undefined, company,
  };
  return [...t.fields.filter((f) => val[f]).map((f) => ({ cls: 'f-' + f, text: val[f]! })), ...(t.footer ? [{ cls: 'f-footer', text: t.footer }] : [])];
}

export function labelCss(t: LabelTemplate): string {
  const k = (t.textScale || 100) / 100;
  const base = Math.max(5, Math.min(16, t.h * 0.23)) * k; // pt, selon la hauteur
  const qr = t.layout === 'qr-dessus' ? Math.min(t.w * 0.6, t.h * 0.58) : t.layout === 'qr-seul' ? Math.min(t.w, t.h) * 0.72 : t.layout === 'cable' ? t.h * 0.86 : Math.min(t.h - 3, t.w * 0.45);
  const big = t.layout === 'texte';
  return `.lab{width:${t.w}mm;height:${t.h}mm;box-sizing:border-box;padding:1.5mm;overflow:hidden;display:flex;gap:1.5mm;font-family:system-ui,sans-serif;color:#000;background:#fff;${t.border ? 'border:0.3mm solid #000;' : ''}}
.lab .qr svg{width:${qr.toFixed(1)}mm;height:${qr.toFixed(1)}mm;display:block}.lab .qr{flex:none}
.lab .tx{min-width:0;display:flex;flex-direction:column;justify-content:center}.lab .tx div{overflow:hidden;text-overflow:ellipsis;line-height:1.12}
.lab .f-title{font-weight:700;font-size:${(base * (big ? 1.9 : 1)).toFixed(1)}pt}.lab .f-code{font:700 ${(base * (big ? 1.25 : 0.9)).toFixed(1)}pt ui-monospace,Menlo,Consolas,monospace}
.lab .f-serial,.lab .f-category,.lab .f-location{font-size:${(base * (big ? 1.05 : 0.82)).toFixed(1)}pt}
.lab .f-contents{font-size:${(base * (big ? 0.95 : 0.72)).toFixed(1)}pt}.lab .f-company,.lab .f-footer{font-size:${(base * 0.68).toFixed(1)}pt;color:#444}
.lab.qr-gauche{align-items:center}
.lab.qr-dessus,.lab.qr-seul{flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0.8mm}
.lab.qr-seul .tx div:not(.f-code){display:none}.lab.qr-seul .f-code{font-size:${(Math.max(5, t.h * 0.17) * k).toFixed(1)}pt}
.lab.code-barres{flex-direction:column;justify-content:center;gap:0.8mm}.lab.code-barres .bc svg{width:100%;height:${(t.h * 0.42).toFixed(1)}mm;display:block}
.lab.code-barres .tx{text-align:center}
.lab.texte{flex-direction:column;justify-content:center}
.lab.cable{align-items:center;justify-content:space-between}.lab.cable .tx{flex:1;text-align:center}.lab.cable .fold{border-left:0.3mm dashed #999;align-self:stretch}`;
}

/** une étiquette (HTML) */
export function labelHtml(t: LabelTemplate, l: SheetLabel, company: string, qrPayload: (code: string) => string = (c) => c): string {
  const tx = `<div class="tx">${lines(t, l, company).map((x) => `<div class="${x.cls}">${esc(x.text)}</div>`).join('')}</div>`;
  const qr = () => `<div class="qr">${qrSvg(qrPayload(l.code), 100)}</div>`;
  const inner = t.layout === 'texte' ? tx
    : t.layout === 'code-barres' ? `<div class="bc">${code128Svg(l.code)}</div>${tx}`
      : t.layout === 'cable' ? `${qr()}${tx}<div class="fold"></div>${tx}${qr()}`
        : `${qr()}${tx}`;
  return `<div class="lab ${t.layout}">${inner}</div>`;
}

/** page complète à imprimer ; `skip` laisse vides les premières étiquettes d'une planche déjà entamée */
export function labelSheetHtml(t: LabelTemplate, labels: SheetLabel[], company: string, qrPayload?: (code: string) => string, skip = 0): string {
  const a4 = t.sheet === 'a4';
  const cols = a4 ? Math.max(1, t.cols || 1) : 1;
  const per = perSheet(t);
  const cells = [...(a4 ? Array.from({ length: Math.max(0, skip) }, () => '<div class="lab blank"></div>') : []), ...labels.map((l) => labelHtml(t, l, company, qrPayload))];
  // une planche (ou une étiquette du rouleau) par page imprimée
  const pages: string[][] = [];
  const size = a4 ? per || cells.length || 1 : 1;
  for (let i = 0; i < cells.length; i += size) pages.push(cells.slice(i, i + size));
  const css = `@page{size:${a4 ? 'A4' : `${t.w}mm ${t.h}mm`};margin:0}body{margin:0}
.sheet{display:grid;grid-template-columns:repeat(${cols},${t.w}mm);grid-auto-rows:${t.h}mm;column-gap:${a4 ? t.gapX || 0 : 0}mm;row-gap:${a4 ? t.gapY || 0 : 0}mm;padding:${a4 ? `${t.marginTop || 0}mm 0 0 ${t.marginLeft || 0}mm` : 0};break-after:page;box-sizing:border-box}
.sheet:last-child{break-after:auto}
${labelCss(t)}
@media screen{.lab{outline:1px dashed #ccc}.sheet{margin-bottom:6mm}}`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes</title><style>${css}</style></head><body>${pages.map((p) => `<div class="sheet">${p.join('')}</div>`).join('')}</body></html>`;
}

/** la planche tient-elle sur une feuille A4 (210 × 297 mm) ? */
export function fitsA4(t: LabelTemplate): boolean {
  if (t.sheet !== 'a4') return true;
  const c = t.cols || 1, r = t.rows || 1;
  return (t.marginLeft || 0) + c * t.w + (c - 1) * (t.gapX || 0) <= 210.5 && (t.marginTop || 0) + r * t.h + (r - 1) * (t.gapY || 0) <= 297.5;
}

/** étiquettes par planche (pour « commencer à l'étiquette n° ») */
export const perSheet = (t: LabelTemplate) => (t.sheet === 'a4' ? (t.cols || 1) * (t.rows || 0) : 1);
