import { labelCss, labelHtml, printableHeight, type LabelTemplate, type SheetLabel } from './labelTemplates';
import { DOTS_PER_MM, tapeDots, type Bitmap } from './ptouch';

/*
 * Une étiquette d'un modèle en image : le HTML du modèle est dessiné (SVG foreignObject) sur un canvas
 * à la résolution de la machine, puis converti en noir et blanc.
 *   PT-P750W : 180 dpi, hauteur = points imprimables du ruban (table Brother), envoyée telle quelle en USB.
 *   Autres (Dymo…) : image PNG à importer dans le logiciel de l'étiqueteuse.
 */

/** résolution (points par mm) de chaque machine */
const deviceDotsPerMm = (t: Pick<LabelTemplate, 'device'>) => (t.device === 'ptouch' || t.device === 'dymo-lm' ? DOTS_PER_MM : 300 / 25.4);

/** HTML → XHTML (le SVG n'accepte que du XML bien formé : <img …/>, entités…) */
function xhtml(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return Array.from(div.childNodes).map((n) => new XMLSerializer().serializeToString(n)).join('');
}

/**
 * Dessine l'étiquette sur un canvas de `wDots` × `hDots`.
 * `band` : seulement la zone imprimable du ruban (pour la PT-P750W), sinon l'étiquette entière.
 */
export async function drawLabel(t: LabelTemplate, l: SheetLabel, company: string, opts: { qrPayload?: (c: string) => string; logo?: string; band?: boolean; dotsPerMm?: number } = {}): Promise<HTMLCanvasElement> {
  const dpm = opts.dotsPerMm ?? deviceDotsPerMm(t);
  // zone imprimable seule : même mise en page, hauteur = largeur imprimable du ruban
  const eff: LabelTemplate = opts.band ? { ...t, sheet: 'rouleau', h: printableHeight(t), border: false } : t;
  const wDots = Math.max(1, Math.round(eff.w * dpm));
  const hDots = opts.band && t.device === 'ptouch' ? tapeDots(t.h) : Math.max(1, Math.round(eff.h * dpm));
  const pxPerMm = 96 / 25.4;
  const wPx = eff.w * pxPerMm, hPx = (hDots / dpm) * pxPerMm;
  const body = xhtml(`<style>${labelCss({ ...eff, h: hDots / dpm })}</style>${labelHtml({ ...eff, h: hDots / dpm }, l, company, opts.qrPayload, opts.logo)}`);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${wDots}" height="${hDots}" viewBox="0 0 ${wPx.toFixed(3)} ${hPx.toFixed(3)}">`
    + `<foreignObject x="0" y="0" width="${wPx.toFixed(3)}" height="${hPx.toFixed(3)}"><div xmlns="http://www.w3.org/1999/xhtml" style="margin:0">${body}</div></foreignObject></svg>`;
  const img = new Image();
  img.decoding = 'sync';
  await new Promise<void>((ok, ko) => { img.onload = () => ok(); img.onerror = () => ko(new Error("Impossible de dessiner l'étiquette.")); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
  const c = document.createElement('canvas');
  c.width = wDots; c.height = hDots;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, wDots, hDots);
  ctx.drawImage(img, 0, 0, wDots, hDots);
  return c;
}

/** canvas → image 1 bit (noir si assez foncé) */
export function toBitmap(c: HTMLCanvasElement, threshold = 150): Bitmap {
  const { width, height } = c;
  let px: Uint8ClampedArray;
  try { px = c.getContext('2d')!.getImageData(0, 0, width, height).data; } catch { throw new Error("Ce navigateur ne permet pas de convertir l'étiquette en image : imprime « via le pilote »."); }
  const data = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) data[i] = px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11 < threshold ? 1 : 0;
  return { width, height, data };
}

/** canvas 1 bit (net à l'impression) */
export function bitmapCanvas(b: Bitmap): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = b.width; c.height = b.height;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(b.width, b.height);
  for (let i = 0; i < b.data.length; i++) { const v = b.data[i] ? 0 : 255; img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  return c;
}
