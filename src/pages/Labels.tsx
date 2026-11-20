import { useState } from 'react';
import { Empty, NumInput, PageHead, useSettings } from '../components/ui';
import { useAvailability } from '../data';
import { db } from '../db';
import { qrSvg } from '../payment';
import { save } from '../utils';
import { appBaseUrl } from '../db';
import { contentsText } from '../codes';

const FORMATS = {
  'a4-24': { label: 'Planche A4 — 24 étiquettes 70 × 37 mm', page: 'A4', cols: 3, w: 70, h: 37, qr: 26 },
  'a4-65': { label: 'Planche A4 — 65 étiquettes 38 × 21 mm', page: 'A4', cols: 5, w: 38.1, h: 21.2, qr: 17 },
  rouleau: { label: 'Rouleau — 50 × 25 mm (une étiquette par page)', page: '50mm 25mm', cols: 1, w: 50, h: 25, qr: 21 },
} as const;
type Format = keyof typeof FORMATS;

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Code imprimé : code-barres existant, sinon un code généré et enregistré sur l'article. */
function codeFor(e: { id: string; code?: string; barcode?: string }) {
  return e.barcode || e.code?.replace(/\s+/g, '') || `FE-${e.id.slice(0, 8).toUpperCase()}`;
}

/** Impression d'étiquettes QR pour le matériel (articles en vrac et unités numérotées). */
export default function Labels() {
  const av = useAvailability();
  const settings = useSettings();
  const [format, setFormat] = useState<Format>('a4-24');
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [showContents, setShowContents] = useState(true);
  const qrLink = !!settings.qrLink;
  /** contenu du QR : le code seul, ou un lien vers la fiche (lisible par l'appareil photo de tout téléphone) */
  const payload = (code: string) => (qrLink ? `${appBaseUrl(settings)}#/q/${encodeURIComponent(code)}` : code);
  const items = av.equipment.filter((e) => !e.isKit && !e.archived && [e.name, e.code].join(' ').toLowerCase().includes(q.toLowerCase()));
  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);

  const print = async () => {
    const labels: { code: string; title: string; sub: string; contents?: string }[] = [];
    for (const e of av.equipment) {
      if (e.trackSerials) {
        for (const u of av.units.filter((x) => x.equipmentId === e.id && x.status === 'ok')) {
          if (!counts['u:' + u.id]) continue;
          const code = u.barcode || u.serial;
          if (!u.barcode) await save(db.units, { ...u, barcode: code });
          for (let i = 0; i < counts['u:' + u.id]; i++) labels.push({ code, title: e.name, sub: u.serial === code ? code : `${code} · n° ${u.serial}`, contents: showContents ? contentsText(e) : undefined });
        }
      } else if (counts[e.id]) {
        const code = codeFor(e);
        if (!e.barcode) { const raw = await db.equipment.get(e.id); if (raw) await save(db.equipment, { ...raw, barcode: code }); }
        for (let i = 0; i < counts[e.id]; i++) labels.push({ code, title: e.name, sub: e.code || code, contents: showContents ? contentsText(e) : undefined });
      }
    }
    const f = FORMATS[format];
    const css = `@page{size:${f.page};margin:${format === 'rouleau' ? 0 : '8mm 0 0 4mm'}}body{margin:0;font-family:system-ui,sans-serif}
      .sheet{display:grid;grid-template-columns:repeat(${f.cols},${f.w}mm)}
      .lab{width:${f.w}mm;height:${f.h}mm;box-sizing:border-box;padding:1.5mm;display:flex;gap:1.5mm;align-items:center;overflow:hidden;${format === 'rouleau' ? 'page-break-after:always' : ''}}
      .lab svg{width:${f.qr}mm;height:${f.qr}mm;flex:none}.t{font-weight:700;font-size:${f.h < 25 ? 6.5 : 8.5}pt;line-height:1.1}
      .s{font-size:${f.h < 25 ? 6 : 7.5}pt;color:#333}.c{font-size:6pt;color:#666}.k{font-size:${f.h < 25 ? 5 : 6.5}pt;line-height:1.1;color:#111}
      @media screen{.lab{outline:1px dashed #ccc}}`;
    const body = `<div class="sheet">${labels.map((l) => `<div class="lab">${qrSvg(payload(l.code), 100)}<div><div class="t">${esc(l.title)}</div><div class="s">${esc(l.sub)}</div>${l.contents ? `<div class="k">+ ${esc(l.contents)}</div>` : ''}<div class="c">${esc(settings.company.name)}</div></div></div>`).join('')}</div>`;
    const w = window.open('', '_blank');
    if (!w) return alert('Autorise les fenêtres pop-up pour imprimer.');
    w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Étiquettes</title><style>${css}</style></head><body>${body}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  return (
    <>
      <PageHead title="Étiquettes QR">
        <select value={format} onChange={(e) => setFormat(e.target.value as Format)} style={{ width: 'auto' }}>
          {Object.entries(FORMATS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button disabled={!total} onClick={print}>Imprimer {total || ''} étiquette(s)</button>
      </PageHead>
      <div className="info">
        Le QR code se scanne à la douchette ou à la caméra dans l'entrepôt. Les articles sans code-barres en reçoivent un automatiquement à l'impression.
      </div>
      <div className="card label-options">
        <label className="check-row"><input type="checkbox" checked={qrLink} onChange={(e) => db.settings.get('main').then((s) => s && db.settings.put({ ...s, qrLink: e.target.checked }))} />
          QR = lien vers la fiche : scanné avec l'appareil photo de n'importe quel téléphone, il ouvre la fiche (contenu, emplacement, projet en cours). Le scanner FabEvent le lit toujours.</label>
        <label className="check-row"><input type="checkbox" checked={showContents} onChange={(e) => setShowContents(e.target.checked)} />
          Imprimer le contenu fourni sur l'étiquette (ex. « + Chargeur, Dock USB-C »)</label>
      </div>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="secondary small" onClick={() => {
            const all: Record<string, number> = {};
            for (const e of items) {
              if (e.trackSerials) for (const u of av.units.filter((x) => x.equipmentId === e.id && x.status === 'ok')) all['u:' + u.id] = 1;
              else all[e.id] = 1;
            }
            setCounts({ ...counts, ...all });
          }}>Tout cocher (1 par article / unité)</button>
          <button className="secondary small" onClick={() => setCounts({})}>Tout décocher</button>
        </div>
        {items.length === 0 ? <Empty>Aucun article.</Empty> : (
          <table className="list">
            <thead><tr><th>Article</th><th>Code imprimé</th><th>Étiquettes</th></tr></thead>
            <tbody>
              {items.flatMap((e) => e.trackSerials
                ? av.units.filter((u) => u.equipmentId === e.id && u.status === 'ok').map((u) => (
                  <tr key={u.id}>
                    <td>{e.name} <span className="muted">n° {u.serial}</span></td>
                    <td><code>{u.barcode || u.serial}</code></td>
                    <td><NumInput className="w-qty" step="1" min={0} value={counts['u:' + u.id] || 0} onChange={(n) => setCounts({ ...counts, ['u:' + u.id]: n })} /></td>
                  </tr>
                ))
                : [(
                  <tr key={e.id}>
                    <td>{e.name} <span className="muted">({e.quantity} en stock)</span></td>
                    <td><code>{codeFor(e)}</code>{!e.barcode && <span className="muted"> (nouveau)</span>}</td>
                    <td>
                      <NumInput className="w-qty" step="1" min={0} value={counts[e.id] || 0} onChange={(n) => setCounts({ ...counts, [e.id]: n })} />
                      <button className="ghost small" onClick={() => setCounts({ ...counts, [e.id]: e.quantity })}>= stock</button>
                    </td>
                  </tr>
                )])}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
