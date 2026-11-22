import { useEffect, useRef, useState } from 'react';
import { bitmapCanvas, drawLabel, toBitmap } from '../labelRaster';
import { DEVICE_LABELS, printableHeight, type LabelTemplate, type SheetLabel } from '../labelTemplates';
import { MIN_FEED_MM, PtouchUsb, bitmapToCanvas, mediaName, usbErrorText, webUsbAvailable, type Bitmap } from '../ptouch';
import { Icon } from './Icon';

const KEY = 'fab.ptouch.modele';
interface Prefs { halfCut: boolean; chain: boolean }
const load = (): Prefs => { try { return { halfCut: false, chain: false, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { halfCut: false, chain: false }; } };

/**
 * Impression d'un modèle sur une étiqueteuse :
 *   Brother PT-P750W : directe en USB (l'étiquette du modèle est convertie à 180 dpi, sur les points imprimables du ruban),
 *   image PNG au format du ruban, ou via le pilote (bouton « Imprimer » de la page) ;
 *   Dymo : via le pilote Dymo (bouton « Imprimer »), ou image PNG à importer dans Dymo Connect.
 */
export default function LabelDevicePanel({ t, total, collect, sample, company, logo, qrPayload }: {
  t: LabelTemplate;
  total: number;
  collect: (persist: boolean) => Promise<SheetLabel[]>;
  sample: SheetLabel;
  company: string;
  logo?: string;
  qrPayload?: (c: string) => string;
}) {
  const pt = t.device === 'ptouch';
  const [p, setP] = useState<Prefs>(load);
  const set = (patch: Partial<Prefs>) => setP((o) => { const n = { ...o, ...patch }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch { /* stockage indisponible */ } return n; });
  const [printer, setPrinter] = useState<PtouchUsb | null>(null);
  const [state, setState] = useState<{ kind: 'info' | 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string>('');
  const usbOk = webUsbAvailable();
  const sampleRef = useRef(sample);
  sampleRef.current = sample;

  useEffect(() => { if (pt) PtouchUsb.remembered().then((d) => d && setPrinter(d)).catch(() => undefined); }, [pt]);

  /** bande imprimée par la PT-P750W (ou étiquette entière pour les autres) */
  const bitmapOf = async (l: SheetLabel): Promise<Bitmap> => toBitmap(await drawLabel(t, l, company, { qrPayload, logo, band: pt }));

  // aperçu de ce qui sort vraiment (noir et blanc, résolution de la machine)
  useEffect(() => {
    let live = true;
    bitmapOf(sampleRef.current).then((b) => { if (live) setPreview((pt ? bitmapToCanvas(b, t.h) : bitmapCanvas(b)).toDataURL('image/png')); })
      .catch((e) => live && setState({ kind: 'error', text: (e as Error).message }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(t), sample.code, sample.title, company, logo]);

  const printUsb = async (test = false) => {
    setState(null);
    let d = printer;
    try { if (!d) { d = await PtouchUsb.request(); setPrinter(d); } } catch (e) { setState({ kind: 'error', text: usbErrorText(e) }); return; }
    setBusy(true);
    try {
      const labels = test ? [sampleRef.current] : await collect(true);
      if (!labels.length) return;
      setState({ kind: 'info', text: 'Préparation des étiquettes…' });
      const bmps: Bitmap[] = [];
      for (const l of labels) bmps.push(await bitmapOf(l));
      await d.open();
      setState({ kind: 'info', text: 'Vérification du ruban…' });
      await d.print(bmps, { tapeMm: t.h, halfCut: p.halfCut, chain: p.chain }, (text) => setState({ kind: 'info', text }));
      setState({ kind: 'ok', text: `${bmps.length} étiquette(s) imprimée(s) sur ${d.name}.${p.chain ? ' Impression chaînée : la dernière sort avec la prochaine impression.' : ''}` });
    } catch (e) {
      setState({ kind: 'error', text: usbErrorText(e) });
    } finally {
      await d.close().catch(() => undefined);
      setBusy(false);
    }
  };

  const readTape = async () => {
    setState(null);
    let d = printer;
    try { if (!d) { d = await PtouchUsb.request(); setPrinter(d); } } catch (e) { setState({ kind: 'error', text: usbErrorText(e) }); return; }
    setBusy(true);
    try {
      await d.open();
      const st = await d.status();
      setState(st.errors.length ? { kind: 'error', text: `${d.name} : ${st.errors.join(', ')}.` }
        : st.tapeMm && st.tapeMm !== t.h ? { kind: 'error', text: `Ruban en place : ${String(st.tapeMm).replace('.', ',')} mm ; ce modèle est prévu pour ${String(t.h).replace('.', ',')} mm. Choisis le modèle de ce ruban.` }
          : { kind: 'ok', text: `${d.name} prête — ${st.tapeMm ? `ruban ${String(st.tapeMm).replace('.', ',')} mm (${mediaName(st.mediaType)})` : 'aucun ruban'}.` });
    } catch (e) { setState({ kind: 'error', text: usbErrorText(e) }); } finally { await d.close().catch(() => undefined); setBusy(false); }
  };

  /** images PNG (une par code) à la résolution de la machine, ruban entier marges comprises */
  const downloadPng = async () => {
    const labels = await collect(true);
    const seen = new Set<string>();
    const files: { name: string; blob: Blob }[] = [];
    for (const l of labels) {
      if (seen.has(l.code)) continue;
      seen.add(l.code);
      const b = await bitmapOf(l);
      const c = pt ? bitmapToCanvas(b, t.h) : bitmapCanvas(b);
      files.push({ name: `${l.code.replace(/[^\w.-]+/g, '_')}_${t.w}x${t.h}mm.png`, blob: await new Promise<Blob>((ok) => c.toBlob((x) => ok(x!), 'image/png')) });
    }
    if (!files.length) return;
    let out = files[0].blob, name = files[0].name;
    if (files.length > 1) {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      for (const f of files) zip.file(f.name, f.blob);
      out = await zip.generateAsync({ type: 'blob' });
      name = `etiquettes_${t.w}x${t.h}mm.zip`;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(out); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  return (
    <div className="card ptouch">
      <h3>{DEVICE_LABELS[t.device || 'autre']}</h3>
      {preview && (
        <div className="ptouch-preview">
          <div className="muted">Ce qui sort de la machine (noir et blanc) — {t.w} × {String(t.h).replace('.', ',')} mm{t.sheet === 'ruban' ? `, zone imprimable ${printableHeight(t).toFixed(1).replace('.', ',')} mm` : ''}</div>
          <img alt="Aperçu de l'impression" src={preview} style={{ width: `${t.w * 6}px`, height: `${t.h * 6}px`, imageRendering: 'pixelated' }} />
          {pt && t.w < MIN_FEED_MM && <div className="muted">La PT-P750W sort toujours au moins 24,5 mm de ruban : l'étiquette coupée fera 24,5 mm.</div>}
        </div>
      )}
      {pt ? <>
        <label className="check-row"><input type="checkbox" checked={p.halfCut} onChange={(e) => set({ halfCut: e.target.checked })} /> Demi-découpe entre les étiquettes (elles restent sur une bande)</label>
        <label className="check-row"><input type="checkbox" checked={p.chain} onChange={(e) => set({ chain: e.target.checked })} /> Impression chaînée (économise ~2 cm de ruban ; la dernière sort à la suivante)</label>
        <div className="toolbar">
          <button disabled={!total || busy || !usbOk} onClick={() => printUsb()}><Icon name="printer" />Imprimer {total || ''} étiquette(s) sur la PT-P750W (USB)</button>
          {usbOk && <button className="secondary" disabled={busy} onClick={readTape}>{printer ? 'Lire le ruban' : 'Connecter en USB'}</button>}
          {usbOk && <button className="secondary" disabled={busy} onClick={() => printUsb(true)}>Étiquette d'essai</button>}
          <button className="secondary" disabled={!total || busy} onClick={downloadPng}>Image PNG (iPrint&Label)</button>
        </div>
        <p className="muted">Sans câble USB (Safari, iPhone, Windows avec le pilote Brother) : bouton « Imprimer » en haut de page, puis choisis la PT-P750W et le ruban de {String(t.h).replace('.', ',')} mm. {!usbOk && 'Ce navigateur ne permet pas l\'impression USB directe (Chrome ou Edge sur ordinateur ou Android).'}</p>
      </> : <>
        <div className="toolbar">
          <button className="secondary" disabled={!total || busy} onClick={downloadPng}>Image PNG ({t.device === 'dymo-lw' || t.device === 'dymo-lm' ? 'Dymo Connect' : 'logiciel de l\'étiqueteuse'})</button>
        </div>
        <ul className="muted" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {t.device === 'dymo-lw' && <li>Bouton « Imprimer » en haut de page, puis choisis la <b>Dymo LabelWriter</b>, le format d'étiquette <b>{t.name.match(/\((\w+)\)/)?.[1] || `${t.w} × ${t.h} mm`}</b>, orientation paysage, marges « aucune », échelle 100 %.</li>}
          {t.device === 'dymo-lm' && <li>Bouton « Imprimer » en haut de page, puis choisis la <b>Dymo LabelManager</b> (pilote Dymo installé), ruban D1 de <b>{t.h} mm</b>, marges « aucune », échelle 100 %. Avec Dymo Connect : importe l'image PNG.</li>}
          {(!t.device || t.device === 'autre') && <li>Bouton « Imprimer » en haut de page, puis choisis l'imprimante et le format {t.w} × {t.h} mm, marges « aucune », échelle 100 %.</li>}
        </ul>
      </>}
      {state && <div className={state.kind === 'error' ? 'alert' : state.kind === 'ok' ? 'info pt-ok' : 'info'} role="status">{state.text}</div>}
    </div>
  );
}

