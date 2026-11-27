import { useLiveQuery } from 'dexie-react-hooks';
import { unitNo } from '../unitNumbers';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, NumInput, PageHead, useSettings } from '../components/ui';
import { useAvailability } from '../data';
import { db, getSettings } from '../db';
import { isVirtualKit, save, uid } from '../utils';
import { appBaseUrl } from '../db';
import { contentsText, labelCode } from '../codes';
import { categoryLabel } from '../categories';
import PtouchPanel, { type LabelData } from '../components/PtouchPanel';
import { LabelPreview, LabelTemplateEditor } from '../components/LabelTemplateEditor';
import LabelDevicePanel from '../components/LabelDevicePanel';
import { BUILTIN_TEMPLATES, DEVICE_LABELS, LAYOUT_LABELS, emptyTemplate, labelSheetHtml, perSheet, type LabelTemplate, type SheetLabel } from '../labelTemplates';

/** identifiant d'un modèle (standard ou personnel), ou l'étiqueteuse PT-P750W */
type Format = string;

/** Code imprimé : code-barres existant, sinon un code généré et enregistré sur l'article. */
const codeFor = labelCode;

/** Impression d'étiquettes QR pour le matériel (articles en vrac et unités numérotées). */
export default function Labels() {
  const av = useAvailability();
  const settings = useSettings();
  const [chosen, setFormat] = useState<Format | null>(() => { try { return (localStorage.getItem('fab.labels.format') as Format) || null; } catch { return null; } });
  // sans choix sur cet appareil : le modèle « par défaut » (Modèles de documents → Étiquettes)
  const format: Format = chosen || settings.labelDefault || 'a4-24';
  const pickFormat = (f: Format) => { setFormat(f); try { localStorage.setItem('fab.labels.format', f); } catch { /* stockage indisponible */ } };
  const [q, setQ] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [showContents, setShowContents] = useState(true);
  const [skip, setSkip] = useState(0);
  const [editing, setEditing] = useState<{ t: LabelTemplate; existing: boolean } | null>(null);
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const mine = settings.labelTemplates || [];
  const templates = [...BUILTIN_TEMPLATES, ...mine];
  // modèles standard masqués (Modèles de documents → Étiquettes) : absents de la liste, sauf celui en cours
  const hiddenSet = new Set(settings.labelHidden || []);
  const shown = (l: LabelTemplate[]) => l.filter((t) => !hiddenSet.has(t.id) || t.id === format);
  const tpl = format === 'ptouch' ? undefined : templates.find((t) => t.id === format) || BUILTIN_TEMPLATES[0];
  const saveTemplates = async (list: LabelTemplate[]) => { const s = await getSettings(); await db.settings.put({ ...s, labelTemplates: list }); };
  const qrLink = !!settings.qrLink;
  /** contenu du QR : le code seul, ou un lien vers la fiche (lisible par l'appareil photo de tout téléphone) */
  const payload = (code: string) => (qrLink ? `${appBaseUrl(settings)}#/q/${encodeURIComponent(code)}` : code);
  const items = av.equipment.filter((e) => !isVirtualKit(e) && !e.archived && !e.accessoryOnly && [e.name, e.code].join(' ').toLowerCase().includes(q.toLowerCase()));
  const total = Object.values(counts).reduce((a, b) => a + (b || 0), 0);

  /** Étiquettes à imprimer ; `persist` enregistre le code sur les articles / unités qui n'en ont pas encore. */
  const collect = async (persist: boolean): Promise<(LabelData & SheetLabel)[]> => {
    const labels: (LabelData & SheetLabel)[] = [];
    for (const e of av.equipment) {
      if (e.trackSerials) {
        for (const u of av.units.filter((x) => x.equipmentId === e.id && x.status === 'ok')) {
          if (!counts['u:' + u.id]) continue;
          const code = u.barcode || u.serial;
          if (persist && !u.barcode) await save(db.units, { ...u, barcode: code });
          for (let i = 0; i < counts['u:' + u.id]; i++) labels.push({ code, title: [e.name, unitNo(u)].filter(Boolean).join(' '), sub: u.serial === code ? code : `${code} · n° ${u.serial}`, serial: u.serial === code ? undefined : u.serial, contents: showContents ? contentsText(e) : undefined, category: categoryLabel(cats, e.categoryId) || undefined, location: e.location });
        }
      }
      // étiquette générale (code de l'article) : aussi pour un article sérialisé (bac, étagère, flight case)
      if (counts[e.id]) {
        const code = codeFor(e);
        if (persist && !e.barcode) { const raw = await db.equipment.get(e.id); if (raw) await save(db.equipment, { ...raw, barcode: code }); }
        for (let i = 0; i < counts[e.id]; i++) labels.push({ code, title: e.name, sub: e.code || code, contents: showContents ? contentsText(e) : undefined, category: categoryLabel(cats, e.categoryId) || undefined, location: e.location });
      }
    }
    return labels;
  };

  const print = async () => {
    if (!tpl) return;
    const labels = await collect(true);
    const w = window.open('', '_blank');
    if (!w) return alert('Autorise les fenêtres pop-up pour imprimer.');
    w.document.write(labelSheetHtml(tpl, labels, settings.company.name, payload, tpl.sheet === 'a4' ? skip : 0, settings.company.logo));
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  /** article pour l'aperçu : le premier coché, sinon un exemple */
  const sample: SheetLabel = (() => {
    const e = av.equipment.find((x) => counts[x.id] || av.units.some((u) => u.equipmentId === x.id && counts['u:' + u.id]));
    if (!e) return { code: 'F-S-0010-03', title: 'Table de mix (exemple)', serial: 'SN 4521', category: 'Son › Console', location: 'Flight F2', contents: showContents ? 'Alimentation, housse' : undefined };
    const u = e.trackSerials ? av.units.find((x) => x.equipmentId === e.id && counts['u:' + x.id]) : undefined;
    return { code: u ? u.barcode || u.serial : codeFor(e), title: u ? [e.name, unitNo(u)].filter(Boolean).join(' ') : e.name, serial: u && u.serial !== (u.barcode || u.serial) ? u.serial : undefined, category: categoryLabel(cats, e.categoryId) || undefined, location: e.location, contents: showContents ? contentsText(e) : undefined };
  })();

  return (
    <>
      <PageHead title="Étiquettes QR">
        <select aria-label="Format d'étiquette" value={tpl ? tpl.id : 'ptouch'} onChange={(e) => pickFormat(e.target.value as Format)} style={{ width: 'auto', maxWidth: '100%' }}>
          {mine.length > 0 && <optgroup label="Mes modèles">{mine.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
          {shown(BUILTIN_TEMPLATES.filter((t) => !t.device)).length > 0 && <optgroup label="Planches A4 et rouleaux">{shown(BUILTIN_TEMPLATES.filter((t) => !t.device)).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
          <optgroup label="Brother PT-P750W (ruban TZe)">{shown(BUILTIN_TEMPLATES.filter((t) => t.device === 'ptouch')).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            <option value="ptouch">PT-P750W — réglages simples (ancien mode)</option></optgroup>
          {shown(BUILTIN_TEMPLATES.filter((t) => t.device === 'dymo-lm' || t.device === 'dymo-lw')).length > 0 && <optgroup label="Dymo">{shown(BUILTIN_TEMPLATES.filter((t) => t.device === 'dymo-lm' || t.device === 'dymo-lw')).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
        </select>
        {tpl && <button disabled={!total} onClick={print}>Imprimer {total || ''} étiquette(s)</button>}
      </PageHead>
      {tpl && (
        <div className="card label-template">
          <div className="lt-head">
            <div>
              <strong>{tpl.name}</strong>
              <div className="muted">{LAYOUT_LABELS[tpl.layout]} · {tpl.w} × {tpl.h} mm{tpl.sheet === 'a4' ? ` · ${perSheet(tpl)} par planche A4` : tpl.sheet === 'ruban' ? ' · ruban' : ' · rouleau'}{tpl.device ? ` · ${DEVICE_LABELS[tpl.device]}` : ''}</div>
            </div>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              {tpl.builtin
                ? <button className="secondary small" onClick={() => setEditing({ t: { ...tpl, id: '', name: `${tpl.name} (copie)` }, existing: false })}>Dupliquer et modifier</button>
                : <button className="secondary small" onClick={() => setEditing({ t: tpl, existing: true })}>Modifier le modèle</button>}
              <button className="secondary small" onClick={() => setEditing({ t: emptyTemplate(), existing: false })}>+ Nouveau modèle</button>
            </div>
          </div>
          <LabelPreview t={tpl} label={sample} company={settings.company.name} qrPayload={payload} logo={settings.company.logo} />
          <p className="muted" style={{ margin: '0 0 6px' }}>Tous les réglages et les modèles par format : <Link to="/modeles?onglet=etiquettes">Modèles de documents → Étiquettes</Link>.</p>
          {tpl.sheet === 'a4' && (
            <label className="check-row">Commencer à l'étiquette n°
              <NumInput className="w-qty" step="1" min={1} value={skip + 1} onChange={(n) => setSkip(Math.max(0, Math.min(perSheet(tpl) - 1, Math.round(n) - 1)))} aria-label="Commencer à l'étiquette n°" />
              <span className="muted">(planche déjà entamée : les {skip || 'premières'} étiquette(s) restent vides)</span>
            </label>
          )}
        </div>
      )}
      {editing && (
        <LabelTemplateEditor initial={editing.t} sample={sample} company={settings.company.name} logo={settings.company.logo} onClose={() => setEditing(null)}
          onDelete={editing.existing ? async () => { await saveTemplates(mine.filter((x) => x.id !== editing.t.id)); pickFormat(BUILTIN_TEMPLATES[0].id); setEditing(null); } : undefined}
          onSave={async (t) => {
            const saved = { ...t, id: editing.existing ? t.id : uid(), builtin: undefined };
            await saveTemplates(editing.existing ? mine.map((x) => (x.id === saved.id ? saved : x)) : [...mine, saved]);
            pickFormat(saved.id); setEditing(null);
          }} />
      )}
      {tpl?.device && <LabelDevicePanel t={tpl} total={total} collect={collect} sample={sample} company={settings.company.name} logo={settings.company.logo} qrPayload={payload} />}
      {format === 'ptouch' && <PtouchPanel total={total} collect={collect} linkFor={qrLink ? payload : undefined} company={settings.company.name} />}
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
                ? [(
                  <tr key={e.id} className="label-general">
                    <td>{e.name} <span className="badge">étiquette générale</span> <span className="muted">(code de l'article, sans numéro d'unité)</span></td>
                    <td><code>{codeFor(e)}</code>{!e.barcode && <span className="muted"> (nouveau)</span>}</td>
                    <td><NumInput className="w-qty" step="1" min={0} value={counts[e.id] || 0} onChange={(n) => setCounts({ ...counts, [e.id]: n })} aria-label={`Étiquettes générales ${e.name}`} /></td>
                  </tr>
                ), ...av.units.filter((u) => u.equipmentId === e.id && u.status === 'ok').map((u) => (
                  <tr key={u.id}>
                    <td>{e.name} {u.number ? <strong className="unit-no">#{u.number}</strong> : null} <span className="muted">n° {u.serial}</span></td>
                    <td><code>{u.barcode || u.serial}</code></td>
                    <td><NumInput className="w-qty" step="1" min={0} value={counts['u:' + u.id] || 0} aria-label={`Nombre d'exemplaires de l'unité ${u.barcode || u.serial}`} title="Nombre d'étiquettes à imprimer pour cette unité" onChange={(n) => setCounts({ ...counts, ['u:' + u.id]: n })} /></td>
                  </tr>
                ))]
                : [(
                  <tr key={e.id}>
                    <td>{e.name} <span className="muted">({e.quantity} en stock)</span></td>
                    <td><code>{codeFor(e)}</code>{!e.barcode && <span className="muted"> (nouveau)</span>}</td>
                    <td>
                      <NumInput className="w-qty" step="1" min={0} value={counts[e.id] || 0} aria-label={`Nombre d'exemplaires de ${e.name}`} title="Nombre d'étiquettes à imprimer" onChange={(n) => setCounts({ ...counts, [e.id]: n })} />
                      <button className="ghost small" title={`Remplir avec tout le stock (${e.quantity})`} aria-label={`Tout le stock de ${e.name} (${e.quantity})`} onClick={() => setCounts({ ...counts, [e.id]: e.quantity })}>= stock</button>
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
