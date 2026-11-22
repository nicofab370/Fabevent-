import { useId, useState } from 'react';
import {
  ALL_FIELDS, FIELD_LABELS, FONT_LABELS, LAYOUT_LABELS, PART_LABELS, fitsA4, labelCss, labelHtml, perSheet,
  type FieldStyle, type LabelField, type LabelFont, type LabelLayout, type LabelPart, type LabelTemplate, type SheetLabel,
} from '../labelTemplates';
import { Field, Modal, NumInput } from './ui';

/** aperçu d'une étiquette à sa taille réelle (mm à l'écran, agrandi par `zoom`), avec le CSS du modèle limité à l'aperçu */
export function LabelPreview({ t, label, company, qrPayload, logo, zoom = 1 }: { t: LabelTemplate; label: SheetLabel; company: string; qrPayload?: (c: string) => string; logo?: string; zoom?: number }) {
  // un style par aperçu : plusieurs aperçus de modèles différents peuvent être sur la même page
  const scope = 'ltp-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const css = labelCss(t).replace(/\.lab/g, `.${scope} .lab`);
  return (
    <div className={'lt-preview ' + scope} aria-label="Aperçu de l'étiquette">
      <style>{css}</style>
      <div style={zoom !== 1 ? { zoom } : undefined} dangerouslySetInnerHTML={{ __html: labelHtml(t, label, company, qrPayload, logo) }} />
    </div>
  );
}

/** valeur numérique facultative : vide = automatique */
function OptNum({ value, onChange, label, step = 'any', min }: { value?: number; onChange: (n?: number) => void; label: string; step?: string; min?: number }) {
  return <NumInput value={value ?? NaN} placeholder="auto" step={step} min={min} onChange={(n) => onChange(Number.isFinite(n) && n !== 0 ? n : undefined)} aria-label={label} />;
}

/**
 * Formulaire d'un modèle d'étiquette : support et planche, mise en page (dont « libre »), texte
 * (police, alignements, marges), chaque zone de texte (ordre, taille, gras, italique, majuscules,
 * retour à la ligne, préfixe), cadre, logo, textes libres ; aperçu à l'échelle choisie.
 */
export function LabelTemplateForm({ initial, sample, company, logo, onSave, onDelete, onCancel, saveLabel = 'Enregistrer le modèle' }: {
  initial: LabelTemplate;
  sample: SheetLabel;
  company: string;
  logo?: string;
  onSave: (t: LabelTemplate) => void;
  onDelete?: () => void;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const [t, setT] = useState<LabelTemplate>({ ...initial, builtin: undefined });
  const [zoom, setZoom] = useState(1.5);
  const [openPart, setOpenPart] = useState<LabelPart | ''>('');
  const set = <K extends keyof LabelTemplate>(k: K, v: LabelTemplate[K]) => setT((x) => ({ ...x, [k]: v }));
  const setStyle = (p: LabelPart, patch: Partial<FieldStyle>) => setT((x) => ({ ...x, styles: { ...(x.styles || {}), [p]: { ...(x.styles?.[p] || {}), ...patch } } }));
  const a4 = t.sheet === 'a4';
  const wide = (t.marginLeft || 0) + (t.cols || 1) * t.w + ((t.cols || 1) - 1) * (t.gapX || 0);
  const tall = (t.marginTop || 0) + (t.rows || 1) * t.h + ((t.rows || 1) - 1) * (t.gapY || 0);
  const overflow = !fitsA4(t);
  const toggle = (f: LabelField) => set('fields', t.fields.includes(f) ? t.fields.filter((x) => x !== f) : [...t.fields, f]);
  const move = (f: LabelField, d: number) => {
    const l = [...t.fields]; const i = l.indexOf(f); const j = i + d;
    if (i < 0 || j < 0 || j >= l.length) return;
    [l[i], l[j]] = [l[j], l[i]]; set('fields', l);
  };
  /** remplit les lignes et colonnes possibles sur une feuille A4 */
  const fit = () => setT((x) => ({
    ...x,
    cols: Math.max(1, Math.floor((210 - 2 * (x.marginLeft || 0) + (x.gapX || 0)) / (x.w + (x.gapX || 0)))),
    rows: Math.max(1, Math.floor((297 - 2 * (x.marginTop || 0) + (x.gapY || 0)) / (x.h + (x.gapY || 0)))),
  }));
  /** centre la planche sur la feuille A4 */
  const center = () => setT((x) => {
    const c = x.cols || 1, r = x.rows || 1;
    return { ...x, marginLeft: Math.max(0, Math.round((210 - c * x.w - (c - 1) * (x.gapX || 0)) / 2 * 10) / 10), marginTop: Math.max(0, Math.round((297 - r * x.h - (r - 1) * (x.gapY || 0)) / 2 * 10) / 10) };
  });
  const free = t.layout === 'libre';
  const canSave = !overflow && !!t.name.trim() && t.fields.length + (t.footer ? 1 : 0) + (t.header ? 1 : 0) > 0;
  const parts: LabelPart[] = [...(t.header ? ['header' as const] : []), ...t.fields, ...(t.footer ? ['footer' as const] : [])];

  return (
    <form className="lt-form" onSubmit={(e) => { e.preventDefault(); if (canSave) onSave({ ...t, name: t.name.trim() }); }}>
      <div className="lt-preview-wrap">
        <div className="toolbar" style={{ marginBottom: 4 }}>
          <strong>Aperçu</strong>
          <label className="check-row">Échelle
            <select value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Échelle de l'aperçu" style={{ width: 'auto' }}>
              {[1, 1.5, 2, 3].map((z) => <option key={z} value={z}>{z === 1 ? 'taille réelle' : `× ${z}`}</option>)}
            </select>
          </label>
          <span className="muted">{t.w} × {t.h} mm</span>
        </div>
        <LabelPreview t={t} label={sample} company={company} logo={logo} zoom={zoom} />
      </div>

      <fieldset className="form lt-section">
        <legend>Format</legend>
        <Field label="Nom du modèle *" full><input required value={t.name} onChange={(e) => set('name', e.target.value)} aria-label="Nom du modèle" /></Field>
        <Field label="Support">
          <select value={t.sheet} onChange={(e) => set('sheet', e.target.value as LabelTemplate['sheet'])} aria-label="Support">
            <option value="a4">Planche A4 (plusieurs étiquettes)</option>
            <option value="rouleau">Rouleau (une étiquette par page)</option>
          </select>
        </Field>
        <Field label="Largeur (mm)"><NumInput value={t.w} min={10} onChange={(n) => set('w', n)} aria-label="Largeur en mm" /></Field>
        <Field label="Hauteur (mm)"><NumInput value={t.h} min={8} onChange={(n) => set('h', n)} aria-label="Hauteur en mm" /></Field>
        {a4 && <>
          <Field label="Colonnes"><NumInput value={t.cols || 1} min={1} step="1" onChange={(n) => set('cols', Math.max(1, Math.round(n)))} aria-label="Colonnes" /></Field>
          <Field label="Lignes"><NumInput value={t.rows || 1} min={1} step="1" onChange={(n) => set('rows', Math.max(1, Math.round(n)))} aria-label="Lignes" /></Field>
          <Field label="Marge du haut (mm)"><NumInput value={t.marginTop || 0} onChange={(n) => set('marginTop', n)} aria-label="Marge du haut" /></Field>
          <Field label="Marge de gauche (mm)"><NumInput value={t.marginLeft || 0} onChange={(n) => set('marginLeft', n)} aria-label="Marge de gauche" /></Field>
          <Field label="Espace entre colonnes (mm)"><NumInput value={t.gapX || 0} onChange={(n) => set('gapX', n)} aria-label="Espace entre colonnes" /></Field>
          <Field label="Espace entre lignes (mm)"><NumInput value={t.gapY || 0} onChange={(n) => set('gapY', n)} aria-label="Espace entre lignes" /></Field>
          <div className="field full">
            <span className={overflow ? 'avail ko' : 'muted'}>
              {perSheet(t)} étiquettes par planche · occupe {wide.toFixed(1)} × {tall.toFixed(1)} mm sur 210 × 297 mm{overflow ? ' : dépasse la feuille A4' : ''}
            </span>{' '}
            <button type="button" className="ghost small" onClick={fit}>Remplir la feuille</button>
            <button type="button" className="ghost small" onClick={center}>Centrer sur la feuille</button>
          </div>
        </>}
      </fieldset>

      <fieldset className="form lt-section">
        <legend>Mise en page</legend>
        <Field label="Disposition" full>
          <select value={t.layout} onChange={(e) => set('layout', e.target.value as LabelLayout)} aria-label="Mise en page">
            {Object.entries(LAYOUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        {free && <>
          <Field label="Code imprimé">
            <select value={t.symbol || 'qr'} onChange={(e) => set('symbol', e.target.value as LabelTemplate['symbol'])} aria-label="Code imprimé">
              <option value="qr">QR code</option><option value="code-barres">Code-barres (douchette)</option><option value="les-deux">QR + code-barres</option><option value="aucun">Aucun (texte seul)</option>
            </select>
          </Field>
          {t.symbol !== 'aucun' && <>
            <Field label="Position du code">
              <select value={t.symbolPos || 'gauche'} onChange={(e) => set('symbolPos', e.target.value as LabelTemplate['symbolPos'])} aria-label="Position du code">
                <option value="gauche">À gauche</option><option value="droite">À droite</option><option value="dessus">Au-dessus</option><option value="dessous">En dessous</option>
              </select>
            </Field>
            <Field label={`Taille du code : ${t.symbolSize ?? 100} %`}>
              <input type="range" min={30} max={100} step={5} value={t.symbolSize ?? 100} onChange={(e) => set('symbolSize', Number(e.target.value))} aria-label="Taille du code" />
            </Field>
          </>}
        </>}
        {t.layout === 'qr-seul' && <p className="muted field full">« QR seul » : seul le code est imprimé sous le QR (les autres zones sont masquées).</p>}
      </fieldset>

      <fieldset className="form lt-section">
        <legend>Texte</legend>
        <Field label="Police">
          <select value={t.font || 'systeme'} onChange={(e) => set('font', e.target.value as LabelFont)} aria-label="Police">
            {Object.entries(FONT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <Field label={`Taille générale : ${t.textScale || 100} %`}>
          <input type="range" min={40} max={200} step={5} value={t.textScale || 100} onChange={(e) => set('textScale', Number(e.target.value))} aria-label="Taille du texte" />
        </Field>
        <Field label="Alignement">
          <div className="seg" role="group" aria-label="Alignement du texte">
            {(['gauche', 'centre', 'droite'] as const).map((a) => <button key={a} type="button" aria-pressed={(t.align || '') === a} onClick={() => set('align', t.align === a ? undefined : a)}>{a}</button>)}
          </div>
        </Field>
        <Field label="Position verticale">
          <div className="seg" role="group" aria-label="Position verticale du texte">
            {(['haut', 'centre', 'bas'] as const).map((a) => <button key={a} type="button" aria-pressed={(t.vAlign || '') === a} onClick={() => set('vAlign', t.vAlign === a ? undefined : a)}>{a}</button>)}
          </div>
        </Field>
        <Field label="Marge intérieure (mm)"><OptNum value={t.padding} onChange={(n) => set('padding', n)} label="Marge intérieure" /></Field>
        <Field label="Espace code / texte (mm)"><OptNum value={t.gap} onChange={(n) => set('gap', n)} label="Espace entre le code et le texte" /></Field>
        <Field label="Texte libre en haut (facultatif)" full><input value={t.header || ''} onChange={(e) => set('header', e.target.value || undefined)} placeholder="ex. MATÉRIEL DE LOCATION" aria-label="Texte libre en haut" /></Field>
        <Field label="Texte libre en bas (facultatif)" full><input value={t.footer || ''} onChange={(e) => set('footer', e.target.value || undefined)} placeholder="ex. Propriété de Ma société — 0470 00 00 00" aria-label="Texte libre" /></Field>
      </fieldset>

      <fieldset className="form lt-section">
        <legend>Informations imprimées</legend>
        <div className="field full">
          <span className="muted">Coche ce qui est imprimé, dans cet ordre ; « Régler » change la taille, le gras, les majuscules, le préfixe…</span>
          <div className="lt-fields">
            {[...t.fields, ...ALL_FIELDS.filter((f) => !t.fields.includes(f))].map((f) => {
              const on = t.fields.includes(f);
              return (
                <div key={f}>
                  <div className={'lt-field' + (on ? ' on' : '')}>
                    <label className="check-row"><input type="checkbox" checked={on} onChange={() => toggle(f)} aria-label={`Imprimer : ${FIELD_LABELS[f]}`} /> {FIELD_LABELS[f]}</label>
                    {on && <span>
                      <button type="button" className="ghost small" aria-label={`Monter ${FIELD_LABELS[f]}`} onClick={() => move(f, -1)}>↑</button>
                      <button type="button" className="ghost small" aria-label={`Descendre ${FIELD_LABELS[f]}`} onClick={() => move(f, 1)}>↓</button>
                      <button type="button" className={'ghost small' + (openPart === f ? ' on' : '')} aria-expanded={openPart === f} onClick={() => setOpenPart(openPart === f ? '' : f)}>Régler</button>
                    </span>}
                  </div>
                  {on && openPart === f && <PartStyle part={f} st={t.styles?.[f] || {}} onChange={(p) => setStyle(f, p)} />}
                </div>
              );
            })}
            {(['header', 'footer'] as const).filter((p) => parts.includes(p)).map((p) => (
              <div key={p}>
                <div className="lt-field on">
                  <span>{PART_LABELS[p]}</span>
                  <button type="button" className={'ghost small' + (openPart === p ? ' on' : '')} aria-expanded={openPart === p} onClick={() => setOpenPart(openPart === p ? '' : p)}>Régler</button>
                </div>
                {openPart === p && <PartStyle part={p} st={t.styles?.[p] || {}} onChange={(x) => setStyle(p, x)} />}
              </div>
            ))}
          </div>
        </div>
      </fieldset>

      <fieldset className="form lt-section">
        <legend>Cadre et logo</legend>
        <Field label=" "><label className="check-row"><input type="checkbox" checked={!!t.border} onChange={(e) => set('border', e.target.checked)} /> Cadre autour de l'étiquette (à découper)</label></Field>
        {t.border && <Field label="Épaisseur du cadre (mm)"><OptNum value={t.borderWidth} onChange={(n) => set('borderWidth', n)} label="Épaisseur du cadre" /></Field>}
        <Field label="Coins arrondis (mm)"><OptNum value={t.radius} onChange={(n) => set('radius', n)} label="Coins arrondis" /></Field>
        <Field label="Logo de la société">
          <select value={t.logo || 'aucun'} onChange={(e) => set('logo', e.target.value as LabelTemplate['logo'])} aria-label="Logo de la société">
            <option value="aucun">Aucun</option><option value="haut">Au-dessus du texte</option><option value="bas">Sous le texte</option>
          </select>
        </Field>
        {t.logo && t.logo !== 'aucun' && !logo && <p className="muted field full">Pas encore de logo : ajoute-le dans Paramètres → Ma société.</p>}
      </fieldset>

      <div className="form-actions">
        {onDelete && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={() => { if (confirm(`Supprimer le modèle « ${initial.name} » ?`)) onDelete(); }}>Supprimer</button>}
        <button type="button" className="secondary" onClick={onCancel}>Annuler</button>
        <button type="submit" disabled={!canSave}>{saveLabel}</button>
      </div>
    </form>
  );
}

/** réglage d'une zone de texte */
function PartStyle({ part, st, onChange }: { part: LabelPart; st: FieldStyle; onChange: (p: Partial<FieldStyle>) => void }) {
  const name = PART_LABELS[part];
  return (
    <div className="lt-part">
      <label className="check-row">Taille {st.size ?? 100} %
        <input type="range" min={40} max={300} step={5} value={st.size ?? 100} onChange={(e) => onChange({ size: Number(e.target.value) })} aria-label={`Taille : ${name}`} />
      </label>
      <label className="check-row"><input type="checkbox" checked={st.bold ?? (part === 'title' || part === 'code' || part === 'header')} onChange={(e) => onChange({ bold: e.target.checked })} aria-label={`Gras : ${name}`} /> Gras</label>
      <label className="check-row"><input type="checkbox" checked={!!st.italic} onChange={(e) => onChange({ italic: e.target.checked })} /> Italique</label>
      <label className="check-row"><input type="checkbox" checked={!!st.upper} onChange={(e) => onChange({ upper: e.target.checked })} /> Majuscules</label>
      <label className="check-row"><input type="checkbox" checked={st.wrap ?? true} onChange={(e) => onChange({ wrap: e.target.checked })} /> Sur plusieurs lignes</label>
      {part !== 'header' && part !== 'footer' && (
        <label className="check-row">Préfixe
          <input value={st.prefix ?? ''} onChange={(e) => onChange({ prefix: e.target.value })} placeholder={part === 'serial' ? 'n° ' : part === 'contents' ? '+ ' : 'aucun'} aria-label={`Préfixe : ${name}`} style={{ width: 120 }} />
        </label>
      )}
    </div>
  );
}

/** le même formulaire dans une fenêtre (depuis la page Étiquettes) */
export function LabelTemplateEditor({ initial, sample, company, logo, onSave, onDelete, onClose }: {
  initial: LabelTemplate;
  sample: SheetLabel;
  company: string;
  logo?: string;
  onSave: (t: LabelTemplate) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={initial.id ? `Modèle : ${initial.name}` : 'Nouveau modèle d’étiquette'} onClose={onClose} wide>
      <LabelTemplateForm initial={initial} sample={sample} company={company} logo={logo} onSave={onSave} onDelete={onDelete} onCancel={onClose} />
    </Modal>
  );
}
