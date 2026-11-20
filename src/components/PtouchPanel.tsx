import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { NumInput } from './ui';
import {
  type Bitmap, type LabelSpec, DOTS_PER_MM, PtouchUsb, TAPES, bitmapToCanvas, mediaName, qrModuleDots, renderLabel, tapeDots, usbErrorText, webUsbAvailable,
} from '../ptouch';

export interface LabelData { code: string; title: string; sub: string; serial?: string; contents?: string }

interface Prefs { tapeMm: number; halfCut: boolean; chain: boolean; minLengthMm: number; qr: 'code' | 'link'; title: boolean; extra: 'contents' | 'serial' | 'company' | 'none' }
const DEFAULTS: Prefs = { tapeMm: 12, halfCut: false, chain: false, minLengthMm: 0, qr: 'code', title: true, extra: 'contents' };
const KEY = 'fab.ptouch';
const loadPrefs = (): Prefs => { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return DEFAULTS; } };

const SAMPLE: LabelData = { code: 'F-S-0010-03', title: 'Exemple — Table de mix', sub: 'F-S-0010-03', contents: 'Alimentation, housse' };

/**
 * Impression sur l'étiqueteuse Brother PT-P750W :
 * directe en USB (WebUSB, Chrome / Edge), ou image PNG au format exact du ruban (iPrint&Label, P-touch Editor),
 * ou impression via le pilote Brother installé sur l'ordinateur.
 */
export default function PtouchPanel({ total, collect, linkFor, company }: {
  total: number;
  collect: (persist: boolean) => Promise<LabelData[]>;
  /** lien vers la fiche si l'option « QR = lien » est active */
  linkFor?: (code: string) => string;
  company: string;
}) {
  const [p, setP] = useState<Prefs>(loadPrefs);
  const set = (patch: Partial<Prefs>) => setP((old) => { const n = { ...old, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* stockage indisponible */ } return n; });
  const [printer, setPrinter] = useState<PtouchUsb | null>(null);
  const [state, setState] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ url: string; mm: number; note?: string } | null>(null);
  const usbOk = webUsbAvailable();
  const collectRef = useRef(collect);
  collectRef.current = collect;

  useEffect(() => { PtouchUsb.remembered().then((d) => d && setPrinter(d)).catch(() => undefined); }, []);

  /** Spécification d'une étiquette (et remarque si le lien ne tient pas sur ce ruban). */
  const specOf = (l: LabelData): { spec: LabelSpec; qr: ReturnType<typeof qrMatrix>; note?: string } => {
    let qrText = p.qr === 'link' && linkFor ? linkFor(l.code) : l.code;
    let qr = qrMatrix(qrText);
    let note: string | undefined;
    const band = tapeDots(p.tapeMm);
    if (qr && qrText !== l.code && qrModuleDots(qr.size, band) < 2) {
      qrText = l.code;
      qr = qrMatrix(qrText);
      note = `Le lien est trop long pour un QR lisible sur ${p.tapeMm} mm : le QR contient le code seul (lu par le scanner FabEvent).`;
    }
    if (qr && qrModuleDots(qr.size, band) < 2) note = 'Ruban de 6 mm : trop étroit pour un QR lisible, seul le code est imprimé. Prends du 9 mm ou plus pour le QR.';
    const extra = p.extra === 'contents' ? (l.contents ? `+ ${l.contents}` : undefined) : p.extra === 'serial' ? (l.serial ? `n° ${l.serial}` : undefined) : p.extra === 'company' ? company : undefined;
    return { spec: { qr: qrText, code: l.code, title: p.title ? l.title : undefined, extra }, qr, note };
  };
  const render = (l: LabelData) => {
    const { spec, qr, note } = specOf(l);
    return { bmp: renderLabel(spec, { tapeMm: p.tapeMm, minLengthMm: p.minLengthMm }, qr), note };
  };

  // aperçu de la première étiquette choisie
  useEffect(() => {
    let live = true;
    collectRef.current(false).then((ls) => {
      if (!live) return;
      const { bmp, note } = render(ls[0] || SAMPLE);
      const c = bitmapToCanvas(bmp, p.tapeMm);
      setPreview({ url: c.toDataURL('image/png'), mm: bmp.width / DOTS_PER_MM, note });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, total, !!linkFor, company]);

  const pages = async (): Promise<{ bmps: Bitmap[]; labels: LabelData[] }> => {
    const labels = await collect(true);
    return { labels, bmps: labels.map((l) => render(l).bmp) };
  };

  const connect = async () => {
    setState(null);
    try {
      const d = await PtouchUsb.request();
      setPrinter(d);
      await detect(d);
    } catch (e) { setState({ kind: 'error', text: usbErrorText(e) }); }
  };

  const detect = async (d = printer) => {
    if (!d) return;
    setBusy(true);
    try {
      await d.open();
      const st = await d.status();
      if (st.tapeMm && TAPES.some((t) => t.mm === st.tapeMm)) set({ tapeMm: st.tapeMm });
      setState(st.errors.length
        ? { kind: 'error', text: `${d.name} : ${st.errors.join(', ')}.` }
        : { kind: 'ok', text: `${d.name} prête — ${st.tapeMm ? `ruban ${st.tapeMm} mm (${mediaName(st.mediaType)})` : 'aucun ruban'}.` });
    } catch (e) {
      setState({ kind: 'error', text: usbErrorText(e) });
    } finally {
      await d.close();
      setBusy(false);
    }
  };

  const printUsb = async () => {
    setState(null);
    let d = printer;
    try {
      if (!d) { d = await PtouchUsb.request(); setPrinter(d); }
    } catch (e) { setState({ kind: 'error', text: usbErrorText(e) }); return; }
    setBusy(true);
    try {
      const { bmps } = await pages();
      if (!bmps.length) return;
      await d.open();
      setState({ kind: 'info', text: 'Vérification du ruban…' });
      await d.print(bmps, { tapeMm: p.tapeMm, halfCut: p.halfCut, chain: p.chain }, (text) => setState({ kind: 'info', text }));
      setState({ kind: 'ok', text: `${bmps.length} étiquette(s) imprimée(s) sur ${d.name}.${p.chain ? ' Impression chaînée : la dernière sort avec la prochaine impression (ou appuie sur l\'avance).' : ''}` });
    } catch (e) {
      setState({ kind: 'error', text: usbErrorText(e) });
    } finally {
      await d.close();
      setBusy(false);
    }
  };

  /** Images PNG au format exact du ruban (180 dpi), une par code. */
  const downloadPng = async () => {
    const { labels, bmps } = await pages();
    const seen = new Set<string>();
    const files: { name: string; blob: Blob }[] = [];
    for (let i = 0; i < labels.length; i++) {
      if (seen.has(labels[i].code)) continue;
      seen.add(labels[i].code);
      const blob = dataUrlBlob(bitmapToCanvas(bmps[i], p.tapeMm).toDataURL('image/png'));
      files.push({ name: `${labels[i].code.replace(/[^\w.-]+/g, '_')}_${p.tapeMm}mm.png`, blob });
    }
    if (!files.length) return;
    let out = files[0].blob, name = files[0].name;
    if (files.length > 1) {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const f of files) zip.file(f.name, f.blob);
      out = await zip.generateAsync({ type: 'blob' });
      name = `etiquettes_${p.tapeMm}mm.zip`;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(out);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  /** Impression via le pilote Brother : une page par étiquette, au format exact (longueur × largeur du ruban). */
  const printDriver = async () => {
    const { bmps } = await pages();
    if (!bmps.length) return;
    const w = window.open('', '_blank');
    if (!w) return alert('Autorise les fenêtres pop-up pour imprimer.');
    const imgs = bmps.map((b) => {
      const mm = (b.width / DOTS_PER_MM).toFixed(1);
      return `<div class="pg" style="width:${mm}mm"><img src="${bitmapToCanvas(b, p.tapeMm).toDataURL('image/png')}" style="width:${mm}mm;height:${p.tapeMm}mm"></div>`;
    });
    const len = Math.max(...bmps.map((b) => b.width)) / DOTS_PER_MM;
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes ${p.tapeMm} mm</title><style>
      @page{size:${len.toFixed(1)}mm ${p.tapeMm}mm;margin:0}body{margin:0}.pg{height:${p.tapeMm}mm;page-break-after:always;overflow:hidden}
      img{display:block;image-rendering:pixelated}</style></head><body>${imgs.join('')}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  return (
    <div className="card ptouch">
      <h3>Étiqueteuse Brother PT-P750W</h3>
      <div className="pt-grid">
        <label><span>Ruban TZe</span>
          <select value={p.tapeMm} onChange={(e) => set({ tapeMm: Number(e.target.value) })}>
            {TAPES.map((t) => <option key={t.mm} value={t.mm}>{t.label}{t.mm === 12 ? ' (conseillé)' : ''}</option>)}
          </select>
        </label>
        <label><span>Contenu du QR</span>
          <select value={p.qr} onChange={(e) => set({ qr: e.target.value as Prefs['qr'] })}>
            <option value="code">Code interne seul (QR plus gros, conseillé)</option>
            <option value="link" disabled={!linkFor}>Lien vers la fiche{linkFor ? '' : ' (active « QR = lien » ci-dessous)'}</option>
          </select>
        </label>
        <label><span>Ligne du bas</span>
          <select value={p.extra} onChange={(e) => set({ extra: e.target.value as Prefs['extra'] })}>
            <option value="contents">Contenu fourni (+ chargeur…)</option>
            <option value="serial">N° de série du fabricant</option>
            <option value="company">Nom de la société</option>
            <option value="none">Rien</option>
          </select>
        </label>
        <label><span>Longueur minimale (mm)</span>
          <NumInput step="1" min={0} placeholder="au plus juste" value={p.minLengthMm} onChange={(n) => set({ minLengthMm: Math.max(0, Math.min(300, n || 0)) })} />
        </label>
      </div>
      <label className="check-row"><input type="checkbox" checked={p.title} onChange={(e) => set({ title: e.target.checked })} /> Nom de l'article sous le code (rubans de 9 mm et plus)</label>
      <label className="check-row"><input type="checkbox" checked={p.halfCut} onChange={(e) => set({ halfCut: e.target.checked })} /> Demi-découpe entre les étiquettes : elles restent sur une bande, faciles à décoller (ruban laminé)</label>
      <label className="check-row"><input type="checkbox" checked={p.chain} onChange={(e) => set({ chain: e.target.checked })} /> Impression chaînée : économise ~2 cm de ruban par impression (la dernière étiquette sort à la suivante)</label>

      {preview && (
        <div className="ptouch-preview">
          <div className="muted">Aperçu — {preview.mm.toFixed(0)} × {p.tapeMm} mm{total ? '' : ' (exemple)'}</div>
          <img alt="Aperçu de l'étiquette" src={preview.url} style={{ width: `${preview.mm * 8}px`, height: `${p.tapeMm * 8}px` }} />
          {preview.note && <div className="muted">{preview.note}</div>}
        </div>
      )}

      <div className="toolbar">
        <button disabled={!total || busy || !usbOk} onClick={printUsb}>🖨 Imprimer {total || ''} étiquette(s) sur la PT-P750W</button>
        {usbOk && <button className="secondary" disabled={busy} onClick={() => (printer ? detect() : connect())}>{printer ? 'Lire le ruban' : 'Connecter en USB'}</button>}
        <button className="secondary" disabled={!total || busy} onClick={downloadPng}>Image PNG (iPrint&Label)</button>
        <button className="secondary" disabled={!total || busy} onClick={printDriver}>Via le pilote Brother</button>
      </div>
      {state && <div className={state.kind === "error" ? "alert" : state.kind === "ok" ? "info pt-ok" : "info"} role="status">{state.text}</div>}

      <details className="ptouch-help">
        <summary>Comment brancher l'étiqueteuse</summary>
        <ul>
          <li><b>Impression directe (USB)</b> : Chrome ou Edge, sur ordinateur (macOS, Linux, ChromeOS) ou sur Android avec un câble USB-C/OTG. Branche la PT-P750W, allume-la, clique « Imprimer » et choisis-la dans la fenêtre. Le ruban est vérifié avant chaque impression.{!usbOk && <b> Ce navigateur ne le permet pas (Safari, Firefox, iPhone/iPad, ou page non sécurisée).</b>}</li>
          <li>Le bouton <b>Editor Lite</b> (voyant vert) doit être <b>éteint</b> : sinon l'étiqueteuse se présente comme une clé USB et ne peut pas imprimer.</li>
          <li><b>Windows</b> : le pilote Brother garde la machine pour lui. Soit tu installes le pilote WinUSB pour la PT-P750W avec l'outil Zadig (l'impression directe marche alors, mais plus P-touch Editor), soit tu utilises « Via le pilote Brother » (choisis la PT-P750W et le ruban dans la fenêtre d'impression).</li>
          <li><b>iPhone / iPad / Wi-Fi</b> : un navigateur ne peut pas parler à l'étiqueteuse en Wi-Fi. Télécharge l'image PNG et imprime-la avec l'app Brother iPrint&Label (bouton Wi-Fi Direct de la machine, réseau DIRECT-brPT-P750W…), ou via AirPrint.</li>
          <li>Les QR des unités contiennent le code interne (ex. F-S-0010-03) : le scanner FabEvent retrouve directement l'unité.</li>
        </ul>
      </details>
    </div>
  );
}

function dataUrlBlob(url: string): Blob {
  const bin = atob(url.slice(url.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: 'image/png' });
}

function qrMatrix(text: string) {
  if (!text) return null;
  try {
    const m = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
    return { size: m.size, get: (r: number, c: number) => !!m.get(r, c) };
  } catch { return null; }
}
