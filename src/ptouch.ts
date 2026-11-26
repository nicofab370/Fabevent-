/*
 * Impression directe sur étiqueteuse Brother P-touch PT-P750W (ruban TZe, 180 dpi, tête de 128 points).
 *
 * Protocole « raster » de Brother (Raster Command Reference PT-E550W / PT-P750W), écrit pour FabEvent à
 * partir de la documentation et recoupé avec des pilotes libres qui fonctionnent sur cette machine :
 *   100 × NUL (vide le tampon) · ESC @ (initialise) · ESC i a 01 (mode raster)
 *   par étiquette : ESC i z (infos : largeur du ruban, nombre de lignes) · ESC i M (découpe auto)
 *                   ESC i A 01 (couper chaque étiquette) · ESC i K (demi-découpe, pas de chaînage)
 *                   ESC i d (marge d'avance) · M 02 (compression TIFF/PackBits)
 *                   une ligne raster « G n1 n2 données » (ou « Z » si blanche) par colonne de l'étiquette
 *                   FF entre deux étiquettes, Ctrl-Z (imprime et éjecte) après la dernière
 * Statut : ESC i S → 32 octets (octet 10 = largeur du ruban en mm, 8-9 = erreurs, 18 = type de message).
 *
 * L'étiquette est une « bande » : largeur = longueur du ruban (une colonne = une ligne raster),
 * hauteur = points imprimables en travers du ruban, centrés sur la tête (bit 0x80 du 1er octet = point 0).
 */

const HEAD_DOTS = 128;
const DPI = 180;
export const DOTS_PER_MM = DPI / 25.4;
const BROTHER_VENDOR = 0x04f9;
const PT_P750W_PRODUCT = 0x2062;

/**
 * Rubans TZe : points imprimables en travers, d'après la table officielle Brother (Raster Command Reference
 * PT-E550W/P750W/P710BT v1.01, § 2.3.5) : marge gauche = marge droite = (128 − points) / 2.
 *   3,5 mm : 24 (marges 52) · 6 mm : 32 (48) · 9 mm : 50 (39) · 12 mm : 70 (29) · 18 mm : 112 (8) · 24 mm : 128 (0)
 * Le ruban de 3,5 mm est annoncé « 4 mm » par la machine (statut et commande ESC i z).
 */
export const TAPES: { mm: number; dots: number; label: string }[] = [
  { mm: 3.5, dots: 24, label: '3,5 mm' },
  { mm: 6, dots: 32, label: '6 mm' },
  { mm: 9, dots: 50, label: '9 mm' },
  { mm: 12, dots: 70, label: '12 mm' },
  { mm: 18, dots: 112, label: '18 mm' },
  { mm: 24, dots: 128, label: '24 mm' },
];
export const tapeDots = (mm: number) => TAPES.find((t) => t.mm === mm)?.dots ?? 70;
/** largeur du ruban telle que la machine la code (3,5 mm → 4) */
const tapeCode = (mm: number) => (mm === 3.5 ? 4 : Math.round(mm));
/** largeur imprimable en travers du ruban (mm) */
export const printableMm = (mm: number) => tapeDots(mm) / (180 / 25.4);
/** Longueur minimale de ruban sortie par la machine (position du coupe-ruban) : 24,5 mm. */
export const MIN_FEED_MM = 24.5;
/** Marge d'avance minimale avant et après l'étiquette : 2 mm = 14 points (§ 2.3.3). */
const MIN_MARGIN_DOTS = 14;

/** Image 1 bit : width = longueur (lignes raster), height = points en travers ; data[y * width + x] = 1 si noir. */
export interface Bitmap { width: number; height: number; data: Uint8Array }

/** Compression PackBits (TIFF) d'une ligne. */
export function packBits(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    // longueur de la répétition à partir de i
    let run = 1;
    while (i + run < src.length && run < 128 && src[i + run] === src[i]) run++;
    if (run >= 2) {
      out.push((257 - run) & 0xff, src[i]);
      i += run;
      continue;
    }
    // suite littérale jusqu'à la prochaine répétition
    const start = i;
    while (i < src.length && i - start < 128 && !(i + 1 < src.length && src[i] === src[i + 1])) i++;
    out.push(i - start - 1, ...src.subarray(start, i));
  }
  return Uint8Array.from(out);
}

export interface JobOptions {
  tapeMm: number;
  /** couper après chaque étiquette (défaut : oui) */
  autoCut?: boolean;
  /** demi-découpe entre les étiquettes : elles restent sur une bande, faciles à décoller */
  halfCut?: boolean;
  /** impression chaînée : la dernière étiquette n'est pas éjectée (économise le ruban de la suivante) */
  chain?: boolean;
  /** marge d'avance avant/après chaque étiquette, en points (14 ≈ 2 mm) */
  marginDots?: number;
}

/** Ligne raster de 16 octets d'une colonne de la bande, centrée sur la tête. */
export function rasterLine(b: Bitmap, x: number): Uint8Array {
  const line = new Uint8Array(HEAD_DOTS / 8);
  const top = Math.floor((HEAD_DOTS - b.height) / 2);
  for (let y = 0; y < b.height; y++) {
    if (!b.data[y * b.width + x]) continue;
    const dot = top + y;
    if (dot >= 0 && dot < HEAD_DOTS) line[dot >> 3] |= 0x80 >> (dot & 7);
  }
  return line;
}

/**
 * Ligne compressée pour la commande G. La doc Brother (§ 4, « M ») impose au plus 17 octets :
 * si la compression dépasse 16 octets, on envoie la ligne telle quelle (0F + 16 octets).
 */
export function compressLine(line: Uint8Array): Uint8Array {
  const c = packBits(line);
  return c.length > 16 ? Uint8Array.from([line.length - 1, ...line]) : c;
}

/** Début du travail : vide le tampon (100 × NUL) et initialise (ESC @). Une seule fois par travail. */
export function jobStart(): Uint8Array {
  return Uint8Array.from([...new Array(100).fill(0), 0x1b, 0x40]);
}

/**
 * Une étiquette (page) : codes de contrôle + lignes raster + commande d'impression.
 * FF si d'autres étiquettes suivent, Ctrl-Z (imprime, avance et coupe) pour la dernière.
 */
export function encodePage(p: Bitmap, page: number, last: boolean, o: JobOptions): Uint8Array {
  const out: number[] = [];
  const push = (...b: number[]) => { for (const v of b) out.push(v & 0xff); };
  const autoCut = o.autoCut ?? true;
  const margin = Math.max(MIN_MARGIN_DOTS, Math.min(900, o.marginDots ?? MIN_MARGIN_DOTS));
  const n = p.width;
  push(0x1b, 0x69, 0x61, 0x01); // ESC i a 01 : mode raster
  // ESC i z : comme l'exemple Brother (84h = reprise auto + largeur vérifiée), nombre de lignes, page
  push(0x1b, 0x69, 0x7a, 0x84, 0x00, tapeCode(o.tapeMm), 0x00, n, n >> 8, n >> 16, n >>> 24, page === 0 ? 0 : 1, 0x00);
  push(0x1b, 0x69, 0x4d, autoCut ? 0x40 : 0x00); // ESC i M : découpe auto
  if (autoCut) push(0x1b, 0x69, 0x41, 0x01); // ESC i A 01 : couper chaque étiquette
  push(0x1b, 0x69, 0x4b, (o.halfCut ? 0x04 : 0) | (o.chain ? 0 : 0x08)); // ESC i K
  push(0x1b, 0x69, 0x64, margin, margin >> 8); // ESC i d : marge (2 mm minimum)
  push(0x4d, 0x02); // compression TIFF (PackBits)
  for (let x = 0; x < n; x++) {
    const line = rasterLine(p, x);
    if (line.every((v) => v === 0)) { push(0x5a); continue; } // Z : ligne blanche
    const c = compressLine(line);
    push(0x47, c.length, c.length >> 8, ...c);
  }
  push(last ? 0x1a : 0x0c);
  return Uint8Array.from(out);
}

/** Demande de statut (à faire précéder d'une initialisation). */
const STATUS_REQUEST = Uint8Array.from([...new Array(100).fill(0), 0x1b, 0x40, 0x1b, 0x69, 0x53]);

interface PtStatus {
  tapeMm: number;
  mediaType: number;
  /** 0 réponse au statut, 1 impression terminée, 2 erreur, 4 éteinte, 5 notification, 6 changement de phase */
  type: number;
  errors: string[];
  tapeColor: number;
}

const MEDIA_NAMES: Record<number, string> = { 0x00: 'aucun ruban', 0x01: 'ruban laminé', 0x03: 'ruban non laminé', 0x04: 'ruban tissu', 0x11: 'gaine thermorétractable', 0x13: 'ruban flexible', 0x14: 'ruban Flexible ID', 0x15: 'ruban satiné', 0x17: 'gaine thermorétractable', 0xff: 'ruban incompatible' };
export const mediaName = (t: number) => MEDIA_NAMES[t] || `support ${t}`;

export function parseStatus(buf: Uint8Array): PtStatus | null {
  if (!buf || buf.length < 32 || buf[0] !== 0x80 || buf[1] !== 0x20) return null;
  const e1 = buf[8], e2 = buf[9];
  const errors: string[] = [];
  if (e1 & 0x01) errors.push('pas de ruban');
  if (e1 & 0x02) errors.push('fin du ruban');
  if (e1 & 0x04) errors.push('coupe-ruban bloqué');
  if (e1 & 0x08) errors.push('batterie faible');
  if (e1 & 0x40) errors.push('adaptateur secteur inadapté');
  if (e2 & 0x01) errors.push('mauvais ruban (largeur différente de celle demandée)');
  if (e2 & 0x04) errors.push('tampon plein');
  if (e2 & 0x08) errors.push('erreur de transmission');
  if (e2 & 0x10) errors.push('capot ouvert');
  if (e2 & 0x20) errors.push('surchauffe');
  if (buf[11] === 0xff || buf[24] === 0xff) errors.push('ruban incompatible');
  if (buf[24] === 0xf0) errors.push('cassette de nettoyage en place');
  return { tapeMm: buf[10] === 4 ? 3.5 : buf[10], mediaType: buf[11], type: buf[18], errors, tapeColor: buf[24] };
}

/* ---------- mise en page d'une étiquette ---------- */

export interface LabelSpec {
  /** contenu du QR (code interne, ou lien vers la fiche) ; vide = pas de QR */
  qr?: string;
  /** code imprimé en gras (ex. F-S-0010-03) */
  code: string;
  title?: string;
  extra?: string;
}

interface LayoutOptions {
  tapeMm: number;
  /** longueur minimale de l'étiquette en mm (0 = au plus juste) */
  minLengthMm?: number;
  /** longueur maximale de la zone de texte en mm */
  maxTextMm?: number;
}

/** Matrice du QR (modules) ; renvoie null si impossible. */
type QrMatrix = { size: number; get: (r: number, c: number) => boolean };

/** Taille d'un module QR en points pour un ruban donné (2 au minimum pour rester lisible). */
export function qrModuleDots(modules: number, bandDots: number): number {
  return Math.floor(bandDots / (modules + 2));
}

/**
 * Dessine l'étiquette sur un canvas (navigateur) puis la convertit en 1 bit.
 * `canvasFactory` permet de fournir un canvas hors DOM.
 */
export function renderLabel(spec: LabelSpec, o: LayoutOptions, qr: QrMatrix | null, canvasFactory: () => HTMLCanvasElement = () => document.createElement('canvas')): Bitmap {
  const H = tapeDots(o.tapeMm);
  const mm = (v: number) => Math.round(v * DOTS_PER_MM);
  const mod = qr ? qrModuleDots(qr.size, H) : 0;
  const showQr = !!qr && mod >= 2;
  const qrDots = showQr ? qr!.size * mod : 0;
  const lead = mm(1);
  const gap = showQr ? mm(1.5) : 0;

  // lignes de texte et tailles de police selon la hauteur disponible
  const lines: { text: string; size: number; bold: boolean }[] = [];
  const codeSize = Math.max(12, Math.round(H * (H <= 32 ? 0.62 : 0.32)));
  lines.push({ text: spec.code, size: codeSize, bold: true });
  if (spec.title && H >= 48) lines.push({ text: spec.title, size: Math.round(H * 0.24), bold: false });
  if (spec.extra && H >= 64) lines.push({ text: spec.extra, size: Math.round(H * 0.19), bold: false });

  const c = canvasFactory();
  const ctx = c.getContext('2d')!;
  const font = (l: { size: number; bold: boolean }) => `${l.bold ? '700' : '600'} ${l.size}px "Arial Narrow", Arial, system-ui, sans-serif`;
  const maxText = mm(o.maxTextMm ?? 70);
  const fit = (l: { text: string; size: number; bold: boolean }) => {
    ctx.font = font(l);
    if (ctx.measureText(l.text).width <= maxText) return l.text;
    // « Table de mix très longue #3 » : on raccourcit le nom, jamais le numéro d'unité #x
    const m = l.text.match(/^(.*\S)(\s+#\d+)$/);
    let t = m ? m[1] : l.text;
    const end = m ? m[2] : '';
    while (t.length > 1 && ctx.measureText(t + '…' + end).width > maxText) t = t.slice(0, -1);
    return t.trimEnd() + '…' + end;
  };
  const texts = lines.map((l) => ({ ...l, text: fit(l) }));
  const textW = Math.ceil(Math.max(...texts.map((l) => { ctx.font = font(l); return ctx.measureText(l.text).width; })));
  // fin : 1,5 mm après le texte + 3 mm blancs de sécurité (certaines P-touch rognent la fin des données)
  const W = Math.max(lead + qrDots + gap + textW + mm(4.5), mm(o.minLengthMm || 0), 31);

  c.width = W;
  c.height = H;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000';
  if (showQr) {
    const top = Math.floor((H - qrDots) / 2);
    for (let r = 0; r < qr!.size; r++) for (let col = 0; col < qr!.size; col++) if (qr!.get(r, col)) ctx.fillRect(lead + col * mod, top + r * mod, mod, mod);
  }
  const totalH = texts.reduce((a, l) => a + l.size * 1.05, 0);
  let y = Math.max(0, (H - totalH) / 2);
  ctx.textBaseline = 'top';
  for (const l of texts) {
    ctx.font = font(l);
    ctx.fillText(l.text, lead + qrDots + gap, Math.round(y + l.size * 0.02));
    y += l.size * 1.05;
  }
  const img = ctx.getImageData(0, 0, W, H).data;
  const data = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const lum = img[i * 4] * 0.3 + img[i * 4 + 1] * 0.59 + img[i * 4 + 2] * 0.11;
    data[i] = lum < 140 ? 1 : 0;
  }
  return { width: W, height: H, data };
}

/** Image du ruban entier (marges blanches comprises) à 180 dpi, pour iPrint&Label / P-touch Editor / AirPrint. */
export function bitmapToCanvas(b: Bitmap, tapeMm: number, canvasFactory: () => HTMLCanvasElement = () => document.createElement('canvas')): HTMLCanvasElement {
  const full = Math.max(b.height, Math.round(tapeMm * DOTS_PER_MM));
  const c = canvasFactory();
  c.width = b.width;
  c.height = full;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(b.width, full);
  const top = Math.floor((full - b.height) / 2);
  for (let y = 0; y < full; y++) for (let x = 0; x < b.width; x++) {
    const by = y - top;
    const black = by >= 0 && by < b.height && b.data[by * b.width + x];
    const i = (y * b.width + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = black ? 0 : 255;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ---------- WebUSB ---------- */

/* Types WebUSB minimaux (non fournis par lib.dom). */
interface UsbEndpoint { endpointNumber: number; direction: 'in' | 'out'; type: string }
interface UsbAlternate { interfaceClass: number; endpoints: UsbEndpoint[] }
interface UsbInterface { interfaceNumber: number; alternate: UsbAlternate; alternates: UsbAlternate[] }
interface UsbDevice {
  productName?: string; vendorId: number; productId: number; opened: boolean;
  configuration: { interfaces: UsbInterface[] } | null;
  open(): Promise<void>; close(): Promise<void>; selectConfiguration(n: number): Promise<void>;
  claimInterface(n: number): Promise<void>; releaseInterface(n: number): Promise<void>;
  transferOut(ep: number, data: BufferSource): Promise<{ status: string; bytesWritten: number }>;
  transferIn(ep: number, len: number): Promise<{ status: string; data?: DataView }>;
}
interface UsbApi { requestDevice(o: { filters: { vendorId: number; productId?: number }[] }): Promise<UsbDevice>; getDevices(): Promise<UsbDevice[]> }

const usbApi = (): UsbApi | undefined => (navigator as unknown as { usb?: UsbApi }).usb;
export const webUsbAvailable = () => !!usbApi() && window.isSecureContext;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Message clair pour les erreurs WebUSB courantes. */
export function usbErrorText(err: unknown): string {
  const e = err as { name?: string; message?: string };
  if (e?.name === 'NotFoundError') return 'Aucune étiqueteuse choisie.';
  if (e?.name === 'SecurityError' || e?.name === 'NetworkError' || /access denied|unable to claim|failed to open/i.test(e?.message || '')) {
    return "L'étiqueteuse est occupée par un autre pilote. Sous Windows, le pilote Brother la garde pour lui : installe le pilote WinUSB pour la PT-P750W (outil Zadig) ou passe par l'image PNG / l'impression via le pilote. Ferme aussi P-touch Editor s'il est ouvert.";
  }
  return e?.message || String(err);
}

export class PtouchUsb {
  private out = 2;
  private inp = 1;
  private iface = 0;
  /** lecture USB en cours : on la réutilise plutôt que d'en empiler une autre (sa réponse serait perdue) */
  private pending: Promise<{ status: string; data?: DataView }> | null = null;
  constructor(public device: UsbDevice) {}

  get name() { return this.device.productName || 'Brother P-touch'; }

  /** Étiqueteuse déjà autorisée dans ce navigateur (sans fenêtre de choix). */
  static async remembered(): Promise<PtouchUsb | null> {
    const usb = usbApi();
    if (!usb) return null;
    const list = await usb.getDevices();
    const d = list.find((x) => x.vendorId === BROTHER_VENDOR && x.productId === PT_P750W_PRODUCT) || list.find((x) => x.vendorId === BROTHER_VENDOR);
    return d ? new PtouchUsb(d) : null;
  }

  /** Ouvre la fenêtre de choix du navigateur (doit suivre un clic). */
  static async request(): Promise<PtouchUsb> {
    const usb = usbApi();
    if (!usb) throw new Error("Ce navigateur ne gère pas l'USB direct (WebUSB) : utilise Chrome ou Edge (ordinateur, Android).");
    const d = await usb.requestDevice({ filters: [{ vendorId: BROTHER_VENDOR, productId: PT_P750W_PRODUCT }, { vendorId: BROTHER_VENDOR }] });
    return new PtouchUsb(d);
  }

  async open() {
    const d = this.device;
    if (!d.opened) await d.open();
    if (!d.configuration) await d.selectConfiguration(1);
    const ifaces = d.configuration?.interfaces || [];
    // interface « imprimante » (classe 7) ou, à défaut, la première qui a un point de sortie bulk
    const pick = ifaces.find((i) => i.alternate.interfaceClass === 7) || ifaces.find((i) => i.alternate.endpoints.some((e) => e.direction === 'out' && e.type === 'bulk')) || ifaces[0];
    if (pick) {
      this.iface = pick.interfaceNumber;
      const eps = pick.alternate.endpoints;
      this.out = eps.find((e) => e.direction === 'out' && e.type === 'bulk')?.endpointNumber ?? 2;
      this.inp = eps.find((e) => e.direction === 'in' && e.type === 'bulk')?.endpointNumber ?? 1;
    }
    await d.claimInterface(this.iface);
  }

  async close() {
    this.pending = null;
    try { await this.device.releaseInterface(this.iface); } catch { /* déjà libérée */ }
    try { await this.device.close(); } catch { /* déjà fermée */ }
  }

  async write(data: Uint8Array) {
    for (let i = 0; i < data.length; i += 65536) {
      const r = await this.device.transferOut(this.out, data.slice(i, i + 65536));
      if (r.status !== 'ok') throw new Error(`Envoi USB interrompu (${r.status}).`);
    }
  }

  /** Lit un message de statut de 32 octets (null si rien avant le délai). */
  async readStatus(timeoutMs = 2000): Promise<PtStatus | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.pending) this.pending = this.device.transferIn(this.inp, 32);
      const r = await Promise.race([this.pending, sleep(Math.max(50, deadline - Date.now())).then(() => null)]);
      if (!r) return null;
      this.pending = null;
      if (r.data && r.data.byteLength >= 32) {
        const st = parseStatus(new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength));
        if (st) return st;
      }
      await sleep(100);
    }
    return null;
  }

  async status(): Promise<PtStatus> {
    await this.write(STATUS_REQUEST);
    // on saute les messages restés d'une impression précédente (fin, changement de phase) jusqu'à la réponse
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const st = await this.readStatus(deadline - Date.now());
      if (!st) break;
      if (st.type === 0) return st;
    }
    throw new Error("L'étiqueteuse ne répond pas. Vérifie qu'elle est allumée et que le mode « Editor Lite » est éteint (voyant vert du bouton éteint).");
  }

  /**
   * Suit le déroulement officiel Brother (§ 1 et § 5) : statut → si tout va bien, envoi d'UNE étiquette →
   * attente du statut « impression terminée » → étiquette suivante. Rien n'est envoyé tant que la machine
   * n'a pas confirmé : en cas d'erreur ou de silence, on s'arrête (pas de ruban qui défile pour rien).
   */
  async print(pages: Bitmap[], o: JobOptions, onStep?: (s: string) => void): Promise<PtStatus> {
    const st = await this.status(); // vide le tampon, initialise, lit le statut
    if (st.errors.length) throw new Error(`Étiqueteuse : ${st.errors.join(', ')}.`);
    if (!st.tapeMm) throw new Error('Aucun ruban détecté.');
    if (st.tapeMm !== o.tapeMm) throw new Error(`Le ruban en place fait ${st.tapeMm} mm, l'étiquette est prévue pour ${o.tapeMm} mm. Change de ruban ou de largeur.`);
    if (st.mediaType !== 0x01 && st.mediaType !== 0x03) throw new Error(`Support non prévu pour les étiquettes : ${mediaName(st.mediaType)}.`);
    let last = st;
    for (let i = 0; i < pages.length; i++) {
      onStep?.(pages.length > 1 ? `Impression ${i + 1} / ${pages.length}…` : 'Impression…');
      await this.write(encodePage(pages[i], i, i === pages.length - 1, o));
      last = await this.waitPrinted(i + 1, pages.length);
    }
    return last;
  }

  /** Attend « impression terminée » (les messages « changement de phase » sont ignorés). */
  private async waitPrinted(n: number, total: number): Promise<PtStatus> {
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const s = await this.readStatus(deadline - Date.now());
      if (!s) break;
      if (s.type === 2 || s.errors.length) {
        await this.write(jobStart()).catch(() => undefined); // annule le reste et remet la machine en attente
        throw new Error(`Étiqueteuse : ${s.errors.join(', ') || 'erreur pendant l\'impression'}${n > 1 ? ` (après ${n - 1} étiquette(s) réussie(s))` : ''}.`);
      }
      if (s.type === 4) throw new Error("L'étiqueteuse s'est éteinte.");
      if (s.type === 1) return s;
    }
    throw new Error(`L'étiqueteuse n'a pas confirmé la fin de l'étiquette ${n} / ${total} : impression arrêtée par sécurité.`);
  }
}
