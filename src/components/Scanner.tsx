import { useEffect, useRef, useState } from 'react';
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';

/*
 * Scanner caméra (repris de la version FABRI.live en production) :
 * - décodeur du téléphone quand il existe (Android/Chrome : BarcodeDetector), sinon ZXing (zxing-cpp en WebAssembly),
 *   bien plus fiable sur iPhone : petits codes, faible contraste, gravé, inversé, un peu flou ;
 * - image caméra en haute définition, on ne décode que le carré visible, en alternant 4 façons de regarder
 *   (carré entier, centre agrandi, autre échelle, centre lissé) ;
 * - choix de l'objectif, zoom 1× 2× 3× 5× et lampe quand le téléphone les propose (choix retenus).
 * Tout est embarqué dans l'application : il fonctionne hors ligne.
 */

const NATIVE_FORMATS = ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'data_matrix', 'itf'];
const ZX_FORMATS = ['QRCode', 'MicroQRCode', 'Code128', 'Code39', 'EAN13', 'EAN8', 'UPCA', 'UPCE', 'DataMatrix', 'ITF'] as const;
const CAM_KEY = 'fab.scan.cam';
const ZOOM_KEY = 'fab.scan.zoom';

interface Detector { detect(src: CanvasImageSource): Promise<{ rawValue: string }[]> }
let nativeDet: Detector | null | undefined;
async function nativeDetector(): Promise<Detector | null> {
  if (nativeDet !== undefined) return nativeDet;
  nativeDet = null;
  try {
    const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
    if (BD) {
      const ok = await BD.getSupportedFormats();
      if (ok.includes('qr_code')) nativeDet = new BD({ formats: NATIVE_FORMATS.filter((f) => ok.includes(f)) });
    }
  } catch { /* pas de détecteur natif */ }
  return nativeDet;
}

type ZxModule = typeof import('zxing-wasm/reader');
let zx: Promise<ZxModule> | null = null;
function loadZxing(): Promise<ZxModule> {
  if (!zx) {
    zx = import('zxing-wasm/reader').then(async (m) => {
      await m.prepareZXingModule({ overrides: { locateFile: (p: string, prefix: string) => (p.endsWith('.wasm') ? wasmUrl : prefix + p) }, fireImmediately: true });
      return m;
    });
    zx.catch(() => { zx = null; });
  }
  return zx;
}

/** Décode un code dans un canvas (texte ou ''). */
export async function decodeCanvas(c: HTMLCanvasElement, g: CanvasRenderingContext2D): Promise<string> {
  const det = await nativeDetector();
  if (det) {
    const r = await det.detect(c);
    return r?.[0]?.rawValue ? String(r[0].rawValue) : '';
  }
  const m = await loadZxing();
  const r = await m.readBarcodes(g.getImageData(0, 0, c.width, c.height), {
    formats: [...ZX_FORMATS], tryHarder: true, tryRotate: true, tryInvert: true, tryDownscale: true, binarizer: 'LocalAverage', maxNumberOfSymbols: 1,
  });
  const ok = r.find((x) => x.isValid && x.text);
  return ok ? ok.text : '';
}

/** Prépare le décodeur en avance (le scanner s'ouvre plus vite). */
export function warmUpScanner() {
  nativeDetector().then((d) => { if (!d) loadZxing().catch(() => {}); });
}

const camRank = (label: string) => {
  const l = (label || '').toLowerCase();
  if (/front|avant|facetime|user/.test(l)) return -1;
  if (/tele|télé/.test(l)) return 50;
  if (/ultra/.test(l)) return 5;
  if (/dual wide|double grand/.test(l)) return 10;
  if (/triple/.test(l)) return 20;
  if (/dual|double/.test(l)) return 30;
  if (/back|arri[eè]re|rear|environment/.test(l)) return 40;
  return 0;
};
const camShort = (l: string) => { const r = camRank(l); return r === 50 ? 'Télé' : r === 5 ? '0,5×' : r === 40 ? '1×' : r === 10 || r === 20 || r === 30 ? 'Auto' : 'Cam'; };
const jGet = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : d; } catch { return d; } };
const jSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sans stockage */ } };

/** Retour d'un scan : vibration + grand ✓ vert ou ✕ rouge. */
export function scanFeedback(ok: boolean) {
  if (navigator.vibrate) navigator.vibrate(ok ? 60 : [80, 60, 80]);
}

type Caps = MediaTrackCapabilities & { zoom?: { min: number; max: number; step?: number }; torch?: boolean };

/**
 * Caméra de scan. onCode reçoit chaque code lu (un même code n'est pas relu avant 1,5 s)
 * et renvoie true / false pour afficher ✓ ou ✕ (rien si undefined).
 */
export function Scanner({ onCode, onClose }: { onCode: (code: string) => boolean | void | Promise<boolean | void>; onClose?: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Ouverture de la caméra…');
  const [cams, setCams] = useState<{ id: string; label: string }[]>([]);
  const [camId, setCamId] = useState('');
  const [zoom, setZoom] = useState<{ min: number; max: number; cur: number } | null>(null);
  const [torch, setTorch] = useState<boolean | null>(null);
  const [flash, setFlash] = useState<null | boolean>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  useEffect(() => {
    let stopped = false, busy = false, pass = 0, timer = 0;
    let stream: MediaStream | null = null;
    let last = { code: '', at: 0 };
    const canvas = document.createElement('canvas');
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    const soft = document.createElement('canvas');
    const video = videoRef.current!;
    const kill = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; trackRef.current = null; };
    const open = async (id: string) => {
      kill();
      const base: MediaTrackConstraints = id ? { deviceId: { exact: id } } : { facingMode: { ideal: 'environment' } };
      let err: unknown = null;
      for (const v of [{ ...base, width: { ideal: 1920 }, height: { ideal: 1080 } }, base]) {
        try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: v }); break; } catch (e) { err = e; if (/permission|notallowed|secure/i.test(String((e as Error).name + (e as Error).message))) throw e; }
      }
      if (!stream) throw err || new Error('Caméra indisponible');
      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      video.srcObject = stream;
      try { await video.play(); } catch { /* lecture automatique */ }
      // zoom et lampe proposés par l'objectif
      let caps: Caps = {};
      try { caps = (track.getCapabilities?.() || {}) as Caps; } catch { /* pas de capacités */ }
      const settings = track.getSettings() as MediaTrackSettings & { zoom?: number; deviceId?: string };
      if (caps.zoom && caps.zoom.max > caps.zoom.min) {
        const saved = jGet<Record<string, number>>(ZOOM_KEY, {})[settings.deviceId || id];
        const cur = saved && saved >= caps.zoom.min && saved <= caps.zoom.max ? saved : settings.zoom || caps.zoom.min;
        if (saved) track.applyConstraints({ advanced: [{ zoom: saved } as MediaTrackConstraintSet] }).catch(() => {});
        setZoom({ min: caps.zoom.min, max: caps.zoom.max, cur });
      } else setZoom(null);
      setTorch(caps.torch ? false : null);
      setCamId(settings.deviceId || id);
      setStatus('');
    };
    const loop = async () => {
      if (stopped) return;
      if (!busy && video.readyState >= 2 && video.videoWidth) {
        busy = true;
        try {
          const vw = video.videoWidth, vh = video.videoHeight, side = Math.min(vw, vh);
          let sx = (vw - side) / 2, sy = (vh - side) / 2, sw = side;
          const p = pass++ % 4;
          if (p) { const m = side * 0.18; sx += m; sy += m; sw = side - 2 * m; }
          const out = Math.round(p === 0 ? Math.min(960, sw) : p === 1 ? Math.min(1000, Math.max(sw, 720)) : p === 2 ? 720 : 800);
          if (canvas.width !== out) { canvas.width = canvas.height = out; }
          if (p === 3) { soft.width = soft.height = out >> 1; soft.getContext('2d')!.drawImage(video, sx, sy, sw, sw, 0, 0, soft.width, soft.height); g.drawImage(soft, 0, 0, out, out); }
          else g.drawImage(video, sx, sy, sw, sw, 0, 0, out, out);
          const txt = (await decodeCanvas(canvas, g)).trim();
          const now = Date.now();
          if (txt && !stopped && (txt !== last.code || now - last.at > 1500)) {
            last = { code: txt, at: now };
            const ok = await onCodeRef.current(txt);
            if (ok !== undefined) { scanFeedback(!!ok); setFlash(!!ok); setTimeout(() => setFlash(null), 700); }
          }
        } catch { /* image suivante */ }
        busy = false;
      }
      if (!stopped) timer = window.setTimeout(loop, 30);
    };
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Caméra non disponible (page en https requise).');
        const saved = jGet<{ id?: string; label?: string }>(CAM_KEY, {});
        try { await open(saved.id || ''); } catch (e) { if (saved.id) await open(''); else throw e; }
        if (stopped) return kill();
        // objectifs arrière (noms connus une fois la caméra autorisée) ; par défaut le plus zoomé
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && camRank(d.label) >= 0)
          .map((d) => ({ id: d.deviceId, label: d.label })).sort((a, b) => camRank(a.label) - camRank(b.label));
        setCams(list);
        if (!saved.id && list.length > 1 && camRank(list[list.length - 1].label) > 0) {
          await open(list[list.length - 1].id).catch(() => open(''));
        }
        const cur = trackRef.current?.getSettings().deviceId || '';
        jSet(CAM_KEY, { id: cur, label: list.find((c) => c.id === cur)?.label || '' });
        loop();
      } catch (e) {
        setStatus(`Caméra impossible : ${(e as Error).message || e}. Autorise la caméra pour ce site, ou utilise une douchette.`);
      }
    })();
    (video as HTMLVideoElement & { _open?: (id: string) => Promise<void> })._open = open;
    return () => { stopped = true; clearTimeout(timer); kill(); };
  }, []);

  const switchCam = async (id: string) => {
    const v = videoRef.current as HTMLVideoElement & { _open?: (id: string) => Promise<void> };
    await v._open?.(id);
    jSet(CAM_KEY, { id, label: cams.find((c) => c.id === id)?.label || '' });
  };
  const applyZoom = (z: number) => {
    trackRef.current?.applyConstraints({ advanced: [{ zoom: z } as MediaTrackConstraintSet] }).then(() => {
      setZoom((o) => (o ? { ...o, cur: z } : o));
      jSet(ZOOM_KEY, { ...jGet<Record<string, number>>(ZOOM_KEY, {}), [camId]: z });
    }).catch(() => {});
  };
  const zoomSteps = zoom ? [1, 2, 3, 5].map((k) => zoom.min * k).filter((v) => v <= zoom.max + 1e-6) : [];

  return (
    <div className={'scanner' + (flash === true ? ' rd-ok' : flash === false ? ' rd-err' : '')}>
      <div className="scanner-view">
        <video ref={videoRef} playsInline muted autoPlay />
        <div className="scanner-aim" aria-hidden />
        {status && <div className="scanner-wait">{status}</div>}
        {flash !== null && <div className={'scanflash ' + (flash ? 'ok' : 'err')} aria-hidden>{flash ? '✓' : '✕'}</div>}
        <div className="scanner-ui">
          {cams.length > 1 && (
            <select aria-label="Objectif" value={camId} onChange={(e) => switchCam(e.target.value)}>
              {[...cams].reverse().map((c) => <option key={c.id} value={c.id}>{camShort(c.label)} · {c.label}</option>)}
            </select>
          )}
          {zoomSteps.length > 1 && zoomSteps.map((z) => (
            <button key={z} type="button" className={'campill' + (Math.abs(z - (zoom?.cur || 0)) < 0.05 ? ' on' : '')} onClick={() => applyZoom(z)}>{Math.round(z / zoom!.min)}×</button>
          ))}
          {torch !== null && (
            <button type="button" className={'campill' + (torch ? ' on' : '')} aria-label="Lampe" aria-pressed={torch}
              onClick={() => trackRef.current?.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).then(() => setTorch(!torch)).catch(() => {})}>⚡</button>
          )}
          {onClose && <button type="button" className="campill" onClick={onClose}>Fermer</button>}
        </div>
      </div>
    </div>
  );
}
