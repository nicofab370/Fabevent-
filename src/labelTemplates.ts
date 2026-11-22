import { qrSvg } from './payment';
import { TAPES as PT_TAPES, printableMm as ptPrintable } from './ptouch';

/*
 * Modèles d'étiquettes (planches A4 et rouleaux) : format, mise en page, champs imprimés.
 * Les formats standard sont fournis ; chacun peut être dupliqué et modifié, ou créé de zéro
 * (enregistré dans les paramètres, donc synchronisé entre appareils).
 */

export type LabelLayout = 'qr-gauche' | 'qr-dessus' | 'qr-seul' | 'code-barres' | 'texte' | 'cable' | 'libre';
/** zones de texte réglables une à une (champs + en-tête et texte libre) */
export type LabelPart = LabelField | 'header' | 'footer';
export interface FieldStyle {
  /** taille en % de la taille normale de ce champ */
  size?: number;
  bold?: boolean;
  italic?: boolean;
  upper?: boolean;
  /** le texte peut passer à la ligne (sinon une ligne, coupée par « … ») */
  wrap?: boolean;
  /** texte devant la valeur (ex. « S/N : », « Rangement : ») ; vide = celui par défaut */
  prefix?: string;
  /** mise en page libre, code à gauche ou à droite : à côté du code (défaut) ou dessous, sur toute la largeur */
  place?: 'cote' | 'dessous';
}
export type LabelFont = 'systeme' | 'arial' | 'etroite' | 'serif' | 'mono';
export type LabelDevice = 'ptouch' | 'dymo-lm' | 'dymo-lw' | 'autre';
export const DEVICE_LABELS: Record<LabelDevice, string> = {
  ptouch: 'Brother PT-P750W (ruban TZe)', 'dymo-lm': 'Dymo LabelManager (ruban D1)', 'dymo-lw': 'Dymo LabelWriter (étiquettes prédécoupées)', autre: 'Autre imprimante',
};
/** largeurs de ruban de chaque étiqueteuse (mm) */
export const DEVICE_TAPES: Partial<Record<LabelDevice, number[]>> = { ptouch: PT_TAPES.map((t) => t.mm), 'dymo-lm': [6, 9, 12, 19, 24] };
/**
 * largeur imprimable en travers d'un ruban (mm) : table Brother pour la PT-P750W ;
 * Dymo LabelManager : tête de 64 points à 180 dpi (9 mm) au plus, marges d'environ 1,5 mm sur les rubans étroits
 */
export function printableHeight(t: Pick<LabelTemplate, 'sheet' | 'device' | 'h'>): number {
  if (t.sheet !== 'ruban') return t.h;
  if (t.device === 'ptouch' && PT_TAPES.some((x) => x.mm === t.h)) return ptPrintable(t.h);
  if (t.device === 'dymo-lm') return Math.min(9, Math.max(2, t.h - 3));
  return t.h;
}
export type LabelField = 'title' | 'code' | 'serial' | 'category' | 'location' | 'contents' | 'company';

export interface LabelTemplate {
  id: string;
  name: string;
  /**
   * planche A4 (plusieurs étiquettes par page), rouleau d'étiquettes prédécoupées (une par page),
   * ou ruban continu d'étiqueteuse (h = largeur du ruban, w = longueur coupée)
   */
  sheet: 'a4' | 'rouleau' | 'ruban';
  /** machine : impression directe en USB pour la PT-P750W, pilote de l'ordinateur pour les autres */
  device?: LabelDevice;
  /** taille d'une étiquette (mm) ; ruban : w = longueur, h = largeur du ruban */
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
  /** texte libre en haut (ex. « MATÉRIEL DE LOCATION ») */
  header?: string;
  /* ----- réglages fins (toutes les mises en page) ----- */
  /** marge intérieure et espace entre le code et le texte (mm) */
  padding?: number;
  gap?: number;
  font?: LabelFont;
  align?: 'gauche' | 'centre' | 'droite';
  vAlign?: 'haut' | 'centre' | 'bas';
  /** réglage de chaque zone de texte */
  styles?: Partial<Record<LabelPart, FieldStyle>>;
  /** épaisseur du cadre (mm) et coins arrondis (mm) */
  borderWidth?: number;
  radius?: number;
  /** logo de la société */
  logo?: 'aucun' | 'haut' | 'bas';
  /* ----- mise en page libre ----- */
  symbol?: 'qr' | 'code-barres' | 'les-deux' | 'aucun';
  symbolPos?: 'gauche' | 'droite' | 'dessus' | 'dessous';
  /**
   * texte à côté du code tourné d'un quart de tour (les lignes se lisent dans le sens de la hauteur,
   * lettres couchées, pas empilées) : 90 = de haut en bas, 270 = de bas en haut
   */
  sideRotate?: 0 | 90 | 270;
  /** taille du code (QR, code-barres) en % de sa taille normale (30 à 200), plafonnée à la place disponible */
  symbolSize?: number;
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
  libre: 'Libre : QR et / ou code-barres où tu veux, à la taille voulue',
};
export const PART_LABELS: Record<LabelPart, string> = {
  header: 'Texte libre en haut', title: 'Nom de l’article', code: 'Code', serial: 'N° de série', category: 'Catégorie',
  location: 'Emplacement', contents: 'Contenu fourni', company: 'Nom de la société', footer: 'Texte libre en bas',
};
export const FONT_LABELS: Record<LabelFont, string> = {
  systeme: 'Système (lisible à l’écran)', arial: 'Arial / Helvetica', etroite: 'Étroite (Arial Narrow)', serif: 'Avec empattements (Georgia)', mono: 'Chasse fixe (codes)',
};
const FONT_CSS: Record<LabelFont, string> = {
  systeme: 'system-ui,sans-serif', arial: 'Arial,Helvetica,sans-serif', etroite: '"Arial Narrow","Roboto Condensed","Liberation Sans Narrow",Arial,sans-serif',
  serif: 'Georgia,"Times New Roman",serif', mono: 'ui-monospace,Menlo,Consolas,monospace',
};
/** préfixes par défaut */
const PREFIX: Partial<Record<LabelField, string>> = { serial: 'n° ', contents: '+ ' };
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
  // Brother PT-P750W : tous les rubans TZe (impression directe en USB)
  std({ id: 'pt-3.5', textScale: 120,  name: 'PT-P750W — ruban 3,5 mm (code seul)', sheet: 'ruban', device: 'ptouch', w: 30, h: 3.5, layout: 'libre', symbol: 'aucun', fields: ['code'], padding: 0.5, styles: { code: { size: 140, wrap: false } } }),
  std({ id: 'pt-6', textScale: 150,  name: 'PT-P750W — ruban 6 mm (code seul)', sheet: 'ruban', device: 'ptouch', w: 35, h: 6, layout: 'libre', symbol: 'aucun', fields: ['code'], padding: 0.5, styles: { code: { size: 150, wrap: false } } }),
  std({ id: 'pt-9', textScale: 150,  name: 'PT-P750W — ruban 9 mm (QR + code)', sheet: 'ruban', device: 'ptouch', w: 38, h: 9, layout: 'libre', symbol: 'qr', symbolPos: 'gauche', fields: ['code', 'title'], padding: 0.6, gap: 1, styles: { code: { wrap: false }, title: { wrap: false } } }),
  std({ id: 'pt-12', textScale: 165,  name: 'PT-P750W — ruban 12 mm (QR + code + nom)', sheet: 'ruban', device: 'ptouch', w: 45, h: 12, layout: 'libre', symbol: 'qr', symbolPos: 'gauche', fields: ['code', 'title'], padding: 0.6, gap: 1.2, styles: { code: { wrap: false }, title: { wrap: false }, contents: { wrap: false } } }),
  std({ id: 'pt-18', textScale: 150,  name: 'PT-P750W — ruban 18 mm', sheet: 'ruban', device: 'ptouch', w: 55, h: 18, layout: 'libre', symbol: 'qr', symbolPos: 'gauche', fields: ['title', 'code', 'serial', 'contents'], padding: 0.6, gap: 1.5, styles: { title: { wrap: false }, contents: { wrap: false } } }),
  std({ id: 'pt-24', textScale: 140,  name: 'PT-P750W — ruban 24 mm', sheet: 'ruban', device: 'ptouch', w: 65, h: 24, layout: 'libre', symbol: 'qr', symbolPos: 'gauche', fields: ['title', 'code', 'serial', 'contents', 'company'], padding: 0.8, gap: 1.8 }),
  // Dymo LabelManager : rubans D1 (impression par le pilote Dymo)
  std({ id: 'dymo-d1-6', textScale: 150,  name: 'Dymo LabelManager — ruban D1 6 mm', sheet: 'ruban', device: 'dymo-lm', w: 35, h: 6, layout: 'libre', symbol: 'aucun', fields: ['code'], padding: 0.5, styles: { code: { wrap: false } } }),
  std({ id: 'dymo-d1-9', textScale: 150,  name: 'Dymo LabelManager — ruban D1 9 mm', sheet: 'ruban', device: 'dymo-lm', w: 40, h: 9, layout: 'libre', symbol: 'qr', fields: ['code', 'title'], padding: 0.5, gap: 1, styles: { code: { wrap: false }, title: { wrap: false } } }),
  std({ id: 'dymo-d1-12', textScale: 160,  name: 'Dymo LabelManager — ruban D1 12 mm', sheet: 'ruban', device: 'dymo-lm', w: 45, h: 12, layout: 'libre', symbol: 'qr', fields: ['code', 'title'], padding: 0.5, gap: 1.2, styles: { code: { wrap: false }, title: { wrap: false } } }),
  std({ id: 'dymo-d1-19', textScale: 150,  name: 'Dymo LabelManager — ruban D1 19 mm', sheet: 'ruban', device: 'dymo-lm', w: 55, h: 19, layout: 'libre', symbol: 'qr', fields: ['code', 'title', 'contents'], padding: 0.5, gap: 1.2, styles: { title: { wrap: false } } }),
  std({ id: 'dymo-d1-24', textScale: 140,  name: 'Dymo LabelManager — ruban D1 24 mm', sheet: 'ruban', device: 'dymo-lm', w: 60, h: 24, layout: 'libre', symbol: 'qr', fields: ['title', 'code', 'serial', 'contents'], padding: 0.5, gap: 1.5 }),
  // Dymo LabelWriter : étiquettes prédécoupées (référence Dymo entre parenthèses)
  std({ id: 'dymo-11355', name: 'Dymo LabelWriter — 51 × 19 mm (11355)', sheet: 'rouleau', device: 'dymo-lw', w: 51, h: 19, layout: 'qr-gauche', fields: ['code', 'title'] }),
  std({ id: 'dymo-11352', name: 'Dymo LabelWriter — 54 × 25 mm (11352)', sheet: 'rouleau', device: 'dymo-lw', w: 54, h: 25, layout: 'qr-gauche', fields: ['title', 'code', 'contents'] }),
  std({ id: 'dymo-11354', name: 'Dymo LabelWriter — 57 × 32 mm (11354)', sheet: 'rouleau', device: 'dymo-lw', w: 57, h: 32, layout: 'qr-gauche', fields: ['title', 'code', 'serial', 'contents'] }),
  std({ id: 'dymo-30332', name: 'Dymo LabelWriter — 25 × 25 mm (30332)', sheet: 'rouleau', device: 'dymo-lw', w: 25, h: 25, layout: 'qr-seul', fields: ['code'] }),
  std({ id: 'dymo-99010', name: 'Dymo LabelWriter — 89 × 28 mm (99010)', sheet: 'rouleau', device: 'dymo-lw', w: 89, h: 28, layout: 'qr-gauche', fields: ['title', 'code', 'serial', 'company'] }),
  std({ id: 'dymo-99012', name: 'Dymo LabelWriter — 89 × 36 mm (99012)', sheet: 'rouleau', device: 'dymo-lw', w: 89, h: 36, layout: 'qr-gauche', fields: ['title', 'code', 'serial', 'contents', 'company'] }),
  std({ id: 'dymo-99014', name: 'Dymo LabelWriter — 101 × 54 mm (99014)', sheet: 'rouleau', device: 'dymo-lw', w: 101, h: 54, layout: 'qr-gauche', fields: ['title', 'code', 'serial', 'category', 'location', 'contents', 'company'] }),
  std({ id: 'dymo-s0904980', name: 'Dymo LabelWriter — 104 × 159 mm (S0904980)', sheet: 'rouleau', device: 'dymo-lw', w: 104, h: 159, layout: 'qr-dessus', fields: ['title', 'code', 'serial', 'category', 'location', 'contents', 'company'] }),
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
function lines(t: LabelTemplate, l: SheetLabel, company: string): { cls: string; text: string; part: LabelPart }[] {
  const raw: Record<LabelField, string | undefined> = { title: l.title, code: l.code, serial: l.serial, category: l.category, location: l.location, contents: l.contents, company };
  const pre = (f: LabelField) => t.styles?.[f]?.prefix ?? PREFIX[f] ?? '';
  return [
    ...(t.header ? [{ cls: 'f-header', text: t.header, part: 'header' as LabelPart }] : []),
    ...t.fields.filter((f) => raw[f]).map((f) => ({ cls: 'f-' + f, text: pre(f) + raw[f]!, part: f as LabelPart })),
    ...(t.footer ? [{ cls: 'f-footer', text: t.footer, part: 'footer' as LabelPart }] : []),
  ];
}

/** taille du QR (mm) d'une mise en page libre */
function freeSizes(t: LabelTemplate) {
  const pad = t.padding ?? 1.5, k = (t.symbolSize ?? 100) / 100;
  const side = t.symbolPos === 'dessus' || t.symbolPos === 'dessous' ? 'col' : 'row';
  const iw = t.w - 2 * pad, ih = t.h - 2 * pad;
  const both = t.symbol === 'les-deux';
  // taille normale × réglage, plafonnée à la place réelle (le code ne déborde jamais de l'étiquette)
  return side === 'row'
    ? { side, qr: Math.min(Math.min(ih * (both ? 0.62 : 1), iw * 0.55) * k, ih * (both ? 0.68 : 1), iw * 0.95), bcW: Math.min(iw * 0.55 * k, iw * 0.95), bcH: Math.min(ih * (both ? 0.3 : 0.8) * k, ih * (both ? 0.32 : 1)) }
    : { side, qr: Math.min(Math.min(iw, ih * 0.62) * k * (both ? 0.75 : 1), iw, ih * (both ? 0.6 : 0.95)), bcW: Math.min(iw * k, iw), bcH: Math.min(ih * 0.42 * k * (both ? 0.6 : 1), ih * (both ? 0.35 : 0.95)) };
}

/**
 * taille réelle du QR (mm) d'un modèle, et si le réglage est plafonné par la place disponible
 * (pour l'éditeur : « limité par la hauteur de l'étiquette »)
 */
export function qrSizeMm(t0: LabelTemplate): { mm: number; capped: boolean } {
  const t = { ...t0, h: printableHeight(t0) };
  const pad = t.padding ?? 1.5, k = (t.symbolSize ?? 100) / 100;
  const iw = t.w - 2 * pad, ih = t.h - 2 * pad;
  if (hasBelow(t)) {
    const basePt = Math.max(5, Math.min(16, t.h * 0.23)) * ((t.textScale || 100) / 100);
    const nBelow = (['header', 'footer', ...t.fields] as LabelPart[]).filter((x) => (x === 'header' ? t.header : x === 'footer' ? t.footer : true) && isBelow(t, x)).length;
    const room = Math.max(1, Math.min(ih - nBelow * basePt * 0.3528 * 1.12 - 0.8, iw * 0.7));
    return { mm: room * Math.min(1, k), capped: k > 1 };
  }
  // QR au-dessus / en dessous : il remplit la hauteur laissée par le texte (estimée ici pour l'éditeur)
  const col = t.layout === 'qr-dessus' || t.layout === 'qr-seul' || (t.layout === 'libre' && (t.symbolPos === 'dessus' || t.symbolPos === 'dessous') && t.symbol !== 'aucun' && t.symbol !== 'code-barres');
  if (col) {
    const basePt = Math.max(5, Math.min(16, t.h * 0.23)) * ((t.textScale || 100) / 100);
    const nLines = t.layout === 'qr-seul' ? 1 : t.fields.length + (t.header ? 1 : 0) + (t.footer ? 1 : 0);
    const textMm = nLines * basePt * 0.3528 * 1.12 + (t.gap ?? 0.8) + (t.symbol === 'les-deux' ? ih * 0.25 : 0);
    const room = Math.max(1, Math.min(iw, ih - textMm));
    return { mm: room * Math.min(1, k), capped: k > 1 };
  }
  if (t.layout === 'libre') {
    const f = freeSizes(t);
    const want = (f.side === 'row' ? Math.min(ih * (t.symbol === 'les-deux' ? 0.62 : 1), iw * 0.55) : Math.min(iw, ih * 0.62) * (t.symbol === 'les-deux' ? 0.75 : 1)) * k;
    return { mm: f.qr, capped: want > f.qr + 0.05 };
  }
  const base = t.layout === 'qr-dessus' ? Math.min(t.w * 0.6, t.h * 0.58) : t.layout === 'qr-seul' ? Math.min(t.w, t.h) * 0.72 : t.layout === 'cable' ? t.h * 0.86 : Math.min(t.h - 3, t.w * 0.45);
  const max = t.layout === 'qr-dessus' ? Math.min(iw, ih * 0.8) : t.layout === 'qr-seul' ? Math.min(iw, ih * 0.85) : t.layout === 'cable' ? Math.min(ih, iw * 0.3) : Math.min(ih, iw * 0.8);
  const want = base * k;
  return { mm: Math.max(1, Math.min(want, Math.max(max, base))), capped: want > Math.max(max, base) + 0.05 };
}

/**
 * QR au-dessus (ou en dessous) du texte : il prend toute la hauteur laissée par le texte
 * (plus de blanc perdu en haut et sur les côtés) ; « Taille du code » < 100 % le réduit.
 */
function fillCss(t: LabelTemplate): string {
  if (hasBelow(t)) {
    // code à côté du texte, d'autres lignes dessous : le code remplit la hauteur laissée par les lignes du dessous
    const k = Math.min(1, (t.symbolSize ?? 100) / 100);
    const pad = t.padding ?? 1.5;
    return `\n.lab.libre{flex-direction:column;align-items:stretch}
.lab.libre .top{display:flex;flex-direction:${t.symbolPos === 'droite' ? 'row-reverse' : 'row'};flex:1 1 0;min-height:0;gap:${t.gap ?? 1.5}mm;align-items:center}
.lab.libre .top .sym{flex:none;height:${(k * 100).toFixed(0)}%;justify-content:center}
.lab.libre .top .qr{height:100%;min-height:0;display:flex}
.lab.libre .top .qr svg{height:100%;width:auto;aspect-ratio:1/1;max-width:${((t.w - 2 * pad) * 0.7).toFixed(1)}mm}
.lab.libre .top .tx{flex:1;min-width:0;align-self:stretch}
.lab.libre .tx-bas{flex:none}`;
  }
  const col = t.layout === 'qr-dessus' || t.layout === 'qr-seul' || (t.layout === 'libre' && (t.symbolPos === 'dessus' || t.symbolPos === 'dessous') && t.symbol !== 'aucun' && t.symbol !== 'code-barres');
  if (!col) return '';
  const k = Math.min(1, (t.symbolSize ?? 100) / 100);
  const L = `.lab.${t.layout}`;
  return `\n${L}{justify-content:flex-start}${L} .tx{flex:none}
${t.layout === 'libre' ? `${L} .sym{flex:1 1 0;min-height:0;width:100%}` : ''}
${L} .qr{flex:1 1 0;min-height:0;width:100%;display:flex;justify-content:center;align-items:center}
${L} .qr svg{width:auto;height:${(k * 100).toFixed(0)}%;max-width:100%;aspect-ratio:1/1}`;
}

/** taille normale d'une zone, en multiple de la taille de base */
function partSize(p: LabelPart, big: boolean): number {
  const m: Record<LabelPart, [number, number]> = { title: [1, 1.9], code: [0.9, 1.25], serial: [0.82, 1.05], category: [0.82, 1.05], location: [0.82, 1.05], contents: [0.72, 0.95], company: [0.68, 0.68], footer: [0.68, 0.68], header: [0.75, 0.9] };
  return m[p][big ? 1 : 0];
}

/** réglages fins communs à toutes les mises en page (police, alignements, marges, zones de texte, cadre, logo) */
function tuneCss(t: LabelTemplate, base: number): string {
  const out: string[] = [];
  if (t.font && t.font !== 'systeme') out.push(`.lab{font-family:${FONT_CSS[t.font]}}`);
  if (t.padding !== undefined) out.push(`.lab{padding:${t.padding}mm}`);
  if (t.gap !== undefined) out.push(`.lab{gap:${t.gap}mm}`);
  if (t.align) { const a = t.align === 'gauche' ? 'left' : t.align === 'droite' ? 'right' : 'center'; out.push(`.lab .tx{text-align:${a};align-items:${a === 'left' ? 'flex-start' : a === 'right' ? 'flex-end' : 'center'}}.lab .tx div{max-width:100%}`); }
  if (t.vAlign) out.push(`.lab .tx{justify-content:${t.vAlign === 'haut' ? 'flex-start' : t.vAlign === 'bas' ? 'flex-end' : 'center'}}`);
  if (t.border && (t.borderWidth || t.radius)) out.push(`.lab{border-width:${t.borderWidth ?? 0.3}mm;border-radius:${t.radius ?? 0}mm}`);
  else if (t.radius) out.push(`.lab{border-radius:${t.radius}mm}`);
  out.push(`.lab .f-header{font-weight:700;font-size:${(base * 0.75).toFixed(1)}pt;letter-spacing:.02em}`);
  for (const [part, st] of Object.entries(t.styles || {}) as [LabelPart, FieldStyle][]) {
    if (!st) continue;
    const r: string[] = [];
    if (st.size && st.size !== 100) r.push(`font-size:${(base * partSize(part, t.layout === 'texte') * st.size / 100).toFixed(1)}pt`);
    if (st.bold !== undefined) r.push(`font-weight:${st.bold ? 700 : 400}`);
    if (st.italic) r.push('font-style:italic');
    if (st.upper) r.push('text-transform:uppercase');
    if (st.wrap === false) r.push('white-space:nowrap');
    if (st.wrap) r.push('white-space:normal;overflow-wrap:anywhere');
    if (r.length) out.push(`.lab .f-${part}{${r.join(';')}}`);
  }
  if (t.logo && t.logo !== 'aucun') out.push(`.lab .logo{display:block;max-width:100%;max-height:${(t.h * 0.22).toFixed(1)}mm;object-fit:contain;${t.align === 'droite' ? 'margin-left:auto' : t.align === 'gauche' ? '' : 'margin:0 auto'}}`);
  // texte à côté du code tourné d'un quart de tour
  if (t.sideRotate && (t.layout === 'qr-gauche' || sideLayout(t))) {
    const sel = t.layout === 'qr-gauche' ? '.lab.qr-gauche > .tx' : '.lab.libre > .tx:not(.tx-bas),.lab.libre .top > .tx';
    out.push(`${sel}{writing-mode:vertical-rl;text-orientation:mixed;align-self:stretch;justify-content:center${t.sideRotate === 270 ? ';transform:rotate(180deg)' : ''}}`);
  }
  if (t.layout === 'libre') {
    const f = freeSizes(t);
    const dir = { gauche: 'row', droite: 'row-reverse', dessus: 'column', dessous: 'column-reverse' }[t.symbolPos || 'gauche'];
    out.push(`.lab.libre{flex-direction:${dir};align-items:${f.side === 'row' ? 'center' : 'stretch'}}
.lab.libre .tx{flex:1}
.lab.libre .sym{flex:none;display:flex;flex-direction:column;align-items:center;gap:0.6mm}
.lab.libre .qr svg{width:${f.qr.toFixed(1)}mm;height:${f.qr.toFixed(1)}mm}
.lab.libre .bc svg{width:${f.bcW.toFixed(1)}mm;height:${f.bcH.toFixed(1)}mm;display:block}`);
  }
  return out.join('\n');
}

export function labelCss(t0: LabelTemplate): string {
  // ruban d'étiqueteuse : tout est calculé sur la largeur imprimable, centrée dans la largeur du ruban
  const t = { ...t0, h: printableHeight(t0) };
  const my = (t0.h - t.h) / 2;
  const k = (t.textScale || 100) / 100;
  const base = Math.max(5, Math.min(16, t.h * 0.23)) * k; // pt, selon la hauteur
  const qr = qrSizeMm(t).mm;
  const bk = Math.min(2, (t.symbolSize ?? 100) / 100);
  const big = t.layout === 'texte';
  return `.lab{width:${t.w}mm;height:${t0.h}mm;box-sizing:border-box;padding:1.5mm;overflow:hidden;display:flex;gap:1.5mm;font-family:system-ui,sans-serif;color:#000;background:#fff;${t.border ? 'border:0.3mm solid #000;' : ''}}
.lab .qr svg{width:${qr.toFixed(1)}mm;height:${qr.toFixed(1)}mm;display:block}.lab .qr{flex:none}
.lab .tx{min-width:0;display:flex;flex-direction:column;justify-content:center}.lab .tx div{overflow:hidden;text-overflow:ellipsis;line-height:1.12}
.lab .f-title{font-weight:700;font-size:${(base * (big ? 1.9 : 1)).toFixed(1)}pt}.lab .f-code{font:700 ${(base * (big ? 1.25 : 0.9)).toFixed(1)}pt ui-monospace,Menlo,Consolas,monospace}
.lab .f-serial,.lab .f-category,.lab .f-location{font-size:${(base * (big ? 1.05 : 0.82)).toFixed(1)}pt}
.lab .f-contents{font-size:${(base * (big ? 0.95 : 0.72)).toFixed(1)}pt}.lab .f-company,.lab .f-footer{font-size:${(base * 0.68).toFixed(1)}pt;color:#444}
.lab.qr-gauche{align-items:center}
.lab.qr-dessus,.lab.qr-seul{flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:0.8mm}
.lab.qr-seul .tx div:not(.f-code){display:none}.lab.qr-seul .f-code{font-size:${(Math.max(5, t.h * 0.17) * k).toFixed(1)}pt}
.lab.code-barres{flex-direction:column;justify-content:center;gap:0.8mm}.lab.code-barres .bc svg{width:100%;height:${Math.min(t.h * 0.42 * bk, t.h - 2 * (t.padding ?? 1.5) - 2).toFixed(1)}mm;display:block}
.lab.code-barres .tx{text-align:center}
.lab.texte{flex-direction:column;justify-content:center}
.lab.cable{align-items:center;justify-content:space-between}.lab.cable .tx{flex:1;text-align:center}.lab.cable .fold{border-left:0.3mm dashed #999;align-self:stretch}
${tuneCss(t, base)}${fillCss(t)}${my > 0 ? `\n.lab{padding-top:${(my + (t.padding ?? 1.5)).toFixed(2)}mm;padding-bottom:${(my + (t.padding ?? 1.5)).toFixed(2)}mm}` : ''}`;
}

/** une étiquette (HTML) */
/** mise en page libre, code à gauche ou à droite : zones placées sous le code, sur toute la largeur */
export const sideLayout = (t: Pick<LabelTemplate, 'layout' | 'symbolPos' | 'symbol'>) => t.layout === 'libre' && t.symbol !== 'aucun' && (!t.symbolPos || t.symbolPos === 'gauche' || t.symbolPos === 'droite');
const isBelow = (t: LabelTemplate, p: LabelPart) => sideLayout(t) && t.styles?.[p]?.place === 'dessous';
export const hasBelow = (t: LabelTemplate) => sideLayout(t) && (['header', 'footer', ...t.fields] as LabelPart[]).some((p) => isBelow(t, p));

export function labelHtml(t: LabelTemplate, l: SheetLabel, company: string, qrPayload: (code: string) => string = (c) => c, logo?: string): string {
  const img = logo && t.logo && t.logo !== 'aucun' ? `<img class="logo" src="${esc(logo)}" alt="">` : '';
  const all = lines(t, l, company);
  const div = (x: { cls: string; text: string }) => `<div class="${x.cls}">${esc(x.text)}</div>`;
  const tx = `<div class="tx">${t.logo === 'haut' ? img : ''}${all.filter((x) => !isBelow(t, x.part)).map(div).join('')}${t.logo === 'bas' ? img : ''}</div>`;
  const below = all.filter((x) => isBelow(t, x.part));
  // pas de bordure blanche dans le QR : la marge de l'étiquette (et l'espace avec le texte) sert de zone blanche
  const qr = () => `<div class="qr">${qrSvg(qrPayload(l.code), 100, 0)}</div>`;
  const sym = t.symbol === 'aucun' ? '' : `<div class="sym">${t.symbol === 'code-barres' ? '' : qr()}${t.symbol === 'code-barres' || t.symbol === 'les-deux' ? `<div class="bc">${code128Svg(l.code)}</div>` : ''}</div>`;
  // texte à côté du code et texte dessous : le code et le texte d'à côté en haut, le reste sur toute la largeur
  const inner = t.layout === 'libre' && below.length ? `<div class="top">${sym}${tx}</div><div class="tx tx-bas">${below.map(div).join('')}</div>`
    : t.layout === 'libre' ? `${sym}${tx}`
    : t.layout === 'texte' ? tx
    : t.layout === 'code-barres' ? `<div class="bc">${code128Svg(l.code)}</div>${tx}`
      : t.layout === 'cable' ? `${qr()}${tx}<div class="fold"></div>${tx}${qr()}`
        : `${qr()}${tx}`;
  return `<div class="lab ${t.layout}">${inner}</div>`;
}

/** page complète à imprimer ; `skip` laisse vides les premières étiquettes d'une planche déjà entamée */
export function labelSheetHtml(t: LabelTemplate, labels: SheetLabel[], company: string, qrPayload?: (code: string) => string, skip = 0, logo?: string): string {
  const a4 = t.sheet === 'a4';
  const cols = a4 ? Math.max(1, t.cols || 1) : 1;
  const per = perSheet(t);
  const cells = [...(a4 ? Array.from({ length: Math.max(0, skip) }, () => '<div class="lab blank"></div>') : []), ...labels.map((l) => labelHtml(t, l, company, qrPayload, logo))];
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
