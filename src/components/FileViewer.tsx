import { useEffect, useRef, useState } from 'react';
import { download } from '../utils';
import { Icon } from './Icon';

/*
 * Ouvre un fichier joint DANS FabEvent, sans le télécharger :
 * PDF (rendu page par page, comme sur iPhone où un PDF intégré n'affiche que la 1re page), images, texte.
 * Les autres formats (Word, Excel…) proposent le téléchargement.
 */

export interface ViewFile { name: string; type: string; blob: Blob }

const kindOf = (f: ViewFile): 'pdf' | 'image' | 'text' | 'other' => {
  const n = f.name.toLowerCase();
  if (f.type === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
  if (f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg|bmp)$/.test(n)) return 'image';
  if (f.type.startsWith('text/') || /\.(txt|csv|md|json|ics|xml|log)$/.test(n)) return 'text';
  return 'other';
};

function PdfPages({ blob, zoom }: { blob: Blob; zoom: number }) {
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<{ pages: number; error?: string }>({ pages: 0 });
  useEffect(() => {
    let cancelled = false;
    const el = box.current;
    if (!el) return;
    el.innerHTML = '';
    (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const pdf = await pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
        if (cancelled) return;
        setState({ pages: pdf.numPages });
        const width = Math.max(280, el.clientWidth - 8) * zoom;
        for (let i = 1; i <= pdf.numPages && !cancelled; i++) {
          const page = await pdf.getPage(i);
          const base = page.getViewport({ scale: 1 });
          const scale = width / base.width;
          const vp = page.getViewport({ scale: scale * (window.devicePixelRatio || 1) });
          const c = document.createElement('canvas');
          c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
          c.style.width = `${Math.floor(width)}px`;
          c.className = 'fv-page';
          c.setAttribute('aria-label', `Page ${i}`);
          el.appendChild(c);
          await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise;
        }
      } catch (e) {
        if (!cancelled) setState({ pages: 0, error: (e as Error).message });
      }
    })();
    return () => { cancelled = true; };
  }, [blob, zoom]);
  return (
    <>
      {state.error && <p className="avail ko">PDF illisible : {state.error}</p>}
      {state.pages > 0 && <div className="muted fv-count">{state.pages} page(s)</div>}
      <div ref={box} className="fv-pdf" />
    </>
  );
}

export function FileViewer({ file, onClose }: { file: ViewFile; onClose: () => void }) {
  const kind = kindOf(file);
  const [url, setUrl] = useState('');
  const [text, setText] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const u = URL.createObjectURL(file.blob);
    setUrl(u);
    if (kind === 'text') file.blob.text().then((t) => setText(t.slice(0, 500000)));
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => { URL.revokeObjectURL(u); window.removeEventListener('keydown', esc); };
  }, [file, kind, onClose]);
  return (
    <div className="fv-bg" role="dialog" aria-label={`Aperçu de ${file.name}`}>
      <div className="fv-bar">
        <strong className="fv-name">{file.name}</strong>
        {(kind === 'pdf' || kind === 'image') && <>
          <button type="button" className="ghost small" aria-label="Réduire" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}><Icon name="minus" /></button>
          <button type="button" className="ghost small" aria-label="Agrandir" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}><Icon name="plus" /></button>
        </>}
        <button type="button" className="secondary small" onClick={() => download(file.name, file.blob, file.type)}><Icon name="arrow-down" />Télécharger</button>
        <button type="button" className="small" onClick={onClose} aria-label="Fermer l'aperçu"><Icon name="x" />Fermer</button>
      </div>
      <div className="fv-body">
        {kind === 'pdf' && <PdfPages blob={file.blob} zoom={zoom} />}
        {kind === 'image' && url && <img src={url} alt={file.name} className="fv-img" style={{ width: `${zoom * 100}%` }} />}
        {kind === 'text' && <pre className="fv-text">{text ?? 'Chargement…'}</pre>}
        {kind === 'other' && (
          <div className="fv-other">
            <Icon name="file" size={48} />
            <p>Pas d'aperçu pour ce type de fichier ({file.name.split('.').pop()?.toUpperCase()}).</p>
            <button type="button" onClick={() => download(file.name, file.blob, file.type)}><Icon name="arrow-down" />Télécharger</button>
          </div>
        )}
      </div>
    </div>
  );
}
