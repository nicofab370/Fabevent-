/**
 * PDF généré dans le navigateur (hors ligne compris) à partir du HTML d'un document.
 * Les bibliothèques ne sont chargées qu'au premier PDF, pour garder l'application légère.
 */

const A4_WIDTH_PX = 794; // 210 mm à 96 ppp
const MARGIN_MM = 10;

/**
 * Rend `html` (avec sa feuille de style) hors écran, puis le découpe en pages A4
 * sans couper une ligne de tableau ni un paragraphe en deux.
 */
export async function htmlToPdf(html: string, css: string): Promise<Blob> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas-pro')]);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_WIDTH_PX}px;background:#fff;color:#111;z-index:-1`;
  host.innerHTML = `<style>${css}</style><style>.pdf-root .doc{width:${A4_WIDTH_PX}px;max-width:none}</style><div class="pdf-root">${html}</div>`;
  document.body.appendChild(host);
  try {
    const root = host.querySelector('.pdf-root') as HTMLElement;
    // images (logo, QR) : on attend qu'elles soient chargées
    await Promise.all([...root.querySelectorAll('img')].map((img) => (img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; }))));
    const scale = 2;
    const canvas = await html2canvas(root, { scale, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: A4_WIDTH_PX });

    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
    const pageW = 210 - 2 * MARGIN_MM;
    const pageH = 297 - 2 * MARGIN_MM;
    const pxPerMm = canvas.width / pageW;
    const pagePx = Math.floor(pageH * pxPerMm);

    // endroits où l'on peut couper : bas des lignes, titres, paragraphes
    const top = root.getBoundingClientRect().top;
    const cuts = [...root.querySelectorAll('tr, h1, h2, h3, p, section, .sign, .totals, .text, .foot')]
      .map((el) => Math.round((el.getBoundingClientRect().bottom - top) * scale))
      .filter((y) => y > 0)
      .sort((a, b) => a - b);

    let y = 0;
    let first = true;
    while (y < canvas.height - 2) {
      let end = Math.min(canvas.height, y + pagePx);
      if (end < canvas.height) {
        const best = cuts.filter((c) => c > y + pagePx * 0.5 && c <= end).pop();
        if (best) end = best;
      }
      const slice = document.createElement('canvas');
      slice.width = canvas.width;
      slice.height = end - y;
      slice.getContext('2d')!.drawImage(canvas, 0, y, canvas.width, end - y, 0, 0, canvas.width, end - y);
      if (!first) pdf.addPage();
      pdf.addImage(slice.toDataURL('image/jpeg', 0.85), 'JPEG', MARGIN_MM, MARGIN_MM, pageW, (end - y) / pxPerMm);
      first = false;
      y = end;
    }
    return pdf.output('blob');
  } finally {
    host.remove();
  }
}

export const safeFileName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
