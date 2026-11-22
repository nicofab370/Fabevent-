import { useState } from 'react';
import { ALL_FIELDS, FIELD_LABELS, LAYOUT_LABELS, fitsA4, labelCss, labelHtml, perSheet, type LabelField, type LabelLayout, type LabelTemplate, type SheetLabel } from '../labelTemplates';
import { Field, Modal, NumInput } from './ui';

/** aperçu d'une étiquette à sa taille réelle (mm à l'écran), avec le CSS du modèle limité à l'aperçu */
export function LabelPreview({ t, label, company, qrPayload }: { t: LabelTemplate; label: SheetLabel; company: string; qrPayload?: (c: string) => string }) {
  const css = labelCss(t).replace(/\.lab/g, '.lt-preview .lab');
  return (
    <div className="lt-preview" aria-label="Aperçu de l'étiquette">
      <style>{css}</style>
      <div dangerouslySetInnerHTML={{ __html: labelHtml(t, label, company, qrPayload) }} />
    </div>
  );
}

/**
 * Créer ou modifier un modèle d'étiquette : support, taille, planche (colonnes, lignes, marges),
 * mise en page, champs imprimés et leur ordre, taille du texte, cadre, texte libre.
 */
export function LabelTemplateEditor({ initial, sample, company, onSave, onDelete, onClose }: {
  initial: LabelTemplate;
  sample: SheetLabel;
  company: string;
  onSave: (t: LabelTemplate) => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  const [t, setT] = useState<LabelTemplate>({ ...initial, builtin: undefined });
  const set = <K extends keyof LabelTemplate>(k: K, v: LabelTemplate[K]) => setT((x) => ({ ...x, [k]: v }));
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

  return (
    <Modal title={initial.id ? `Modèle : ${initial.name}` : 'Nouveau modèle d’étiquette'} onClose={onClose} wide>
      <form className="form" onSubmit={(e) => { e.preventDefault(); if (!overflow && t.name.trim() && t.fields.length + (t.footer ? 1 : 0) > 0) onSave({ ...t, name: t.name.trim() }); }}>
        <Field label="Nom du modèle *" full><input required value={t.name} onChange={(e) => set('name', e.target.value)} aria-label="Nom du modèle" /></Field>
        <Field label="Support">
          <select value={t.sheet} onChange={(e) => set('sheet', e.target.value as LabelTemplate['sheet'])} aria-label="Support">
            <option value="a4">Planche A4 (plusieurs étiquettes)</option>
            <option value="rouleau">Rouleau (une étiquette par page)</option>
          </select>
        </Field>
        <Field label="Mise en page">
          <select value={t.layout} onChange={(e) => set('layout', e.target.value as LabelLayout)} aria-label="Mise en page">
            {Object.entries(LAYOUT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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
          </div>
        </>}
        <Field label="Taille du texte (%)"><NumInput value={t.textScale || 100} min={40} step="5" onChange={(n) => set('textScale', n || 100)} aria-label="Taille du texte" /></Field>
        <Field label=" "><label className="check-row"><input type="checkbox" checked={!!t.border} onChange={(e) => set('border', e.target.checked)} /> Cadre autour de l'étiquette (à découper)</label></Field>
        <Field label="Texte libre en bas (facultatif)" full><input value={t.footer || ''} onChange={(e) => set('footer', e.target.value || undefined)} placeholder="ex. Propriété de Ma société — 0470 00 00 00" aria-label="Texte libre" /></Field>
        <div className="field full">
          <label>Informations imprimées (dans cet ordre)</label>
          <div className="lt-fields">
            {[...t.fields, ...ALL_FIELDS.filter((f) => !t.fields.includes(f))].map((f) => {
              const on = t.fields.includes(f);
              return (
                <div key={f} className={'lt-field' + (on ? ' on' : '')}>
                  <label className="check-row"><input type="checkbox" checked={on} onChange={() => toggle(f)} aria-label={`Imprimer : ${FIELD_LABELS[f]}`} /> {FIELD_LABELS[f]}</label>
                  {on && <span>
                    <button type="button" className="ghost small" aria-label={`Monter ${FIELD_LABELS[f]}`} onClick={() => move(f, -1)}>↑</button>
                    <button type="button" className="ghost small" aria-label={`Descendre ${FIELD_LABELS[f]}`} onClick={() => move(f, 1)}>↓</button>
                  </span>}
                </div>
              );
            })}
          </div>
          {t.layout === 'qr-seul' && <p className="muted">Mise en page « QR seul » : seul le code est imprimé sous le QR.</p>}
        </div>
        <div className="field full">
          <label>Aperçu (taille réelle)</label>
          <LabelPreview t={t} label={sample} company={company} />
        </div>
        <div className="form-actions">
          {onDelete && <button type="button" className="danger" onClick={() => { if (confirm(`Supprimer le modèle « ${initial.name} » ?`)) onDelete(); }}>Supprimer</button>}
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={overflow}>Enregistrer le modèle</button>
        </div>
      </form>
    </Modal>
  );
}
