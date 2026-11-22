import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LabelPreview, LabelTemplateForm } from '../components/LabelTemplateEditor';
import { Icon } from '../components/Icon';
import { useSettings } from '../components/ui';
import { contentsText, labelCode } from '../codes';
import { categoryLabel } from '../categories';
import { db, getSettings } from '../db';
import { BUILTIN_TEMPLATES, DEVICE_LABELS, LAYOUT_LABELS, emptyTemplate, perSheet, type LabelTemplate, type SheetLabel } from '../labelTemplates';
import { unitNo } from '../unitNumbers';
import { uid } from '../utils';

/** format d'étiquette : support et taille (les modèles d'un même format s'impriment sur les mêmes étiquettes) */
// ruban : même format = même machine et même largeur de ruban (la longueur se règle dans chaque modèle)
const formatKey = (t: LabelTemplate) => (t.sheet === 'ruban' ? `ruban|${t.device || ''}|${t.h}` : `${t.sheet}|${t.device || ''}|${t.w}|${t.h}|${t.sheet === 'a4' ? `${t.cols || 1}x${t.rows || 1}` : ''}`);
const mm = (n: number) => String(n).replace('.', ',');
const formatName = (t: LabelTemplate) => (t.sheet === 'ruban'
  ? `${DEVICE_LABELS[t.device || 'autre']} · ruban ${mm(t.h)} mm`
  : `${mm(t.w)} × ${mm(t.h)} mm · ${t.sheet === 'a4' ? `planche A4 de ${perSheet(t)}` : t.device ? DEVICE_LABELS[t.device] : 'rouleau'}`);
const DEV_ORDER = ['', 'dymo-lw', 'ptouch', 'dymo-lm', 'autre'];
const fmtSort = (t: LabelTemplate) => `${t.sheet === 'a4' ? 0 : t.sheet === 'rouleau' ? 1 : 2}${DEV_ORDER.indexOf(t.device || '')}${String(Math.round((t.sheet === 'ruban' ? t.h : t.w) * 10)).padStart(5, '0')}${String(Math.round(t.h * 10)).padStart(5, '0')}`;

/**
 * Modèles de documents → Étiquettes : les modèles rangés par format d'étiquette ;
 * pour chaque format, dupliquer un modèle standard ou en créer un ; éditeur avec aperçu sur un vrai article.
 */
export default function LabelTemplatesTab() {
  const settings = useSettings();
  const mine = settings.labelTemplates || [];
  const all = [...BUILTIN_TEMPLATES, ...mine];
  const [editing, setEditing] = useState<{ t: LabelTemplate; existing: boolean } | null>(null);
  const [sampleId, setSampleId] = useState('');
  const equipment = useLiveQuery(() => db.equipment.orderBy('name').filter((e) => !e.archived && !e.isKit && !e.accessoryOnly).toArray(), []) || [];
  const units = useLiveQuery(() => db.units.toArray(), []) || [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const saveTemplates = async (list: LabelTemplate[], extra: Partial<typeof settings> = {}) => { const s = await getSettings(); await db.settings.put({ ...s, labelTemplates: list, ...extra }); };
  const setDefault = async (id: string) => { const s = await getSettings(); await db.settings.put({ ...s, labelDefault: id }); };
  const def = settings.labelDefault || BUILTIN_TEMPLATES[0].id;
  /** modèles standard masqués : ils ne s'affichent plus ici ni sur la page Étiquettes (réaffichables) */
  const hidden = new Set(settings.labelHidden || []);
  const [showHidden, setShowHidden] = useState(false);
  const setHidden = async (ids: string[], hide: boolean) => {
    const s = await getSettings();
    const h = new Set(s.labelHidden || []);
    for (const id of ids) { if (hide) h.add(id); else h.delete(id); }
    // un modèle masqué n'est plus « par défaut »
    await db.settings.put({ ...s, labelHidden: [...h], ...(hide && s.labelDefault && ids.includes(s.labelDefault) ? { labelDefault: undefined } : {}) });
  };
  const removeMine = async (t: LabelTemplate) => {
    if (!confirm(`Supprimer le modèle « ${t.name} » ?`)) return;
    await saveTemplates(mine.filter((x) => x.id !== t.id), settings.labelDefault === t.id ? { labelDefault: undefined } : {});
  };

  /** aperçu : un vrai article (ou une de ses unités), sinon un exemple */
  const sample: SheetLabel = (() => {
    const e = equipment.find((x) => x.id === sampleId);
    if (!e) return { code: 'F-S-0010-03', title: 'Table de mix #3', serial: 'SN 4521', category: 'Son › Console', location: 'Flight F2', contents: 'Alimentation, housse' };
    const u = e.trackSerials ? units.filter((x) => x.equipmentId === e.id).sort((a, b) => (a.number || 1e9) - (b.number || 1e9))[0] : undefined;
    return {
      code: u ? u.barcode || u.serial : labelCode(e), title: u ? [e.name, unitNo(u)].filter(Boolean).join(' ') : e.name,
      serial: u && u.serial !== (u.barcode || u.serial) ? u.serial : undefined, category: categoryLabel(cats, e.categoryId) || undefined, location: e.location, contents: contentsText(e) || undefined,
    };
  })();

  const groups = new Map<string, LabelTemplate[]>();
  for (const t of [...all].filter((x) => showHidden || !hidden.has(x.id)).sort((a, b) => fmtSort(a).localeCompare(fmtSort(b)))) groups.set(formatKey(t), [...(groups.get(formatKey(t)) || []), t]);

  if (editing) {
    return (
      <div className="card">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>{editing.existing ? `Modèle : ${editing.t.name}` : 'Nouveau modèle d’étiquette'}</h2>
          <label className="check-row">Aperçu avec
            <select value={sampleId} onChange={(e) => setSampleId(e.target.value)} aria-label="Article de l'aperçu" style={{ width: 'auto', maxWidth: 260 }}>
              <option value="">un exemple</option>
              {equipment.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
        </div>
        <LabelTemplateForm key={editing.t.id || 'nouveau'} initial={editing.t} sample={sample} company={settings.company.name} logo={settings.company.logo}
          onCancel={() => setEditing(null)}
          onDelete={editing.existing ? async () => { await saveTemplates(mine.filter((x) => x.id !== editing.t.id), settings.labelDefault === editing.t.id ? { labelDefault: undefined } : {}); setEditing(null); } : undefined}
          onSave={async (t) => {
            const saved = { ...t, id: editing.existing ? t.id : uid(), builtin: undefined };
            await saveTemplates(editing.existing ? mine.map((x) => (x.id === saved.id ? saved : x)) : [...mine, saved]);
            setEditing(null);
          }} />
      </div>
    );
  }

  return (
    <>
      <div className="info">
        Un modèle = un format d'étiquette (planche A4 ou rouleau, taille) et sa mise en page. Les modèles standard se dupliquent ; les tiens se modifient librement
        (position et taille du QR ou du code-barres, police, alignements, chaque information, cadre, logo). Ils s'impriment depuis la page <Link to="/etiquettes">Étiquettes</Link>.
      </div>
      <div className="toolbar">
        <button onClick={() => setEditing({ t: emptyTemplate(), existing: false })}>+ Nouveau modèle</button>
        <button className="secondary" onClick={() => setEditing({ t: { ...emptyTemplate(), name: 'Mon modèle libre', layout: 'libre', symbol: 'qr', symbolPos: 'gauche' }, existing: false })}>+ Modèle libre</button>
        <button className="secondary" onClick={() => setEditing({ t: { ...emptyTemplate(), name: 'PT-P750W — mon ruban 12 mm', sheet: 'ruban', device: 'ptouch', w: 45, h: 12, layout: 'libre', symbol: 'qr', symbolPos: 'gauche', padding: 0.6, fields: ['code', 'title'] }, existing: false })}>+ Modèle Brother P-touch</button>
        <button className="secondary" onClick={() => setEditing({ t: { ...emptyTemplate(), name: 'Dymo — mon modèle 89 × 36 mm', sheet: 'rouleau', device: 'dymo-lw', w: 89, h: 36, cols: undefined, rows: undefined, fields: ['title', 'code', 'serial'] }, existing: false })}>+ Modèle Dymo</button>
        {hidden.size > 0 && <>
          <label className="check-row" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> Afficher les modèles masqués ({hidden.size})</label>
          <button className="ghost small" onClick={() => setHidden([...hidden], false)}>Tout réafficher</button>
        </>}
      </div>
      {[...groups.entries()].map(([key, list]) => (
        <div key={key} className="card lt-group">
          <div className="page-head" style={{ marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>{formatName(list[0])}</h3>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <button className="secondary small" onClick={() => setEditing({ t: { ...list[0], id: '', name: `${formatName(list[0])} — mon modèle`, builtin: undefined }, existing: false })}>+ Modèle pour ce format</button>
              {list.some((t) => t.builtin && !hidden.has(t.id)) && (
                <button className="ghost small" title="Masque les modèles standard de ce format (tes modèles restent)" onClick={() => setHidden(list.filter((t) => t.builtin).map((t) => t.id), true)}>Masquer ce format</button>
              )}
            </div>
          </div>
          <div className="lt-cards">
            {list.map((t) => (
              <div key={t.id} className={'lt-card' + (t.id === def ? ' is-default' : '') + (hidden.has(t.id) ? ' is-hidden' : '')}>
                <LabelPreview t={t} label={sample} company={settings.company.name} logo={settings.company.logo} />
                <div className="lt-card-info">
                  <strong>{t.name}</strong>
                  <span className="muted">{LAYOUT_LABELS[t.layout]}{t.builtin ? ' · standard' : ''}{hidden.has(t.id) ? ' · masqué' : ''}</span>
                </div>
                <div className="toolbar" style={{ marginBottom: 0 }}>
                  {t.builtin
                    ? <button className="secondary small" onClick={() => setEditing({ t: { ...t, id: '', name: `${t.name} (copie)` }, existing: false })}>Dupliquer et modifier</button>
                    : <>
                      <button className="secondary small" onClick={() => setEditing({ t, existing: true })}>Modifier</button>
                      <button className="ghost small" onClick={() => setEditing({ t: { ...t, id: '', name: `${t.name} (copie)` }, existing: false })}>Dupliquer</button>
                    </>}
                  {hidden.has(t.id) ? null : t.id === def
                    ? <span className="badge st-confirme"><Icon name="check" />Par défaut</span>
                    : <button className="ghost small" onClick={() => setDefault(t.id)} title="Proposé d'office sur la page Étiquettes">Par défaut</button>}
                  {t.builtin
                    ? <button className="ghost small" onClick={() => setHidden([t.id], !hidden.has(t.id))} title={hidden.has(t.id) ? 'Le remettre dans les listes' : "Modèle standard : il ne s'affiche plus (réaffichable)"}>{hidden.has(t.id) ? 'Réafficher' : 'Masquer'}</button>
                    : <button className="ghost small danger-txt" onClick={() => removeMine(t)} aria-label={`Supprimer ${t.name}`}><Icon name="x" />Supprimer</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
