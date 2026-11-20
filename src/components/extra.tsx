import { useState } from 'react';
import type { CustomField, CustomValues } from '../types';
import { download } from '../utils';
import { Field, useSettings } from './ui';

/** Saisie d'étiquettes (tags) : Entrée ou virgule pour valider. */
export function TagInput({ value = [], onChange, suggestions = [] }: { value?: string[]; onChange: (t: string[]) => void; suggestions?: string[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const t = raw.trim().replace(/,$/, '');
    if (t && !value.includes(t)) onChange([...value, t]);
    setText('');
  };
  const listId = 'tags-' + suggestions.length;
  return (
    <div className="tags-input">
      {value.map((t) => <span key={t} className="tag">{t} <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`Retirer ${t}`}>×</button></span>)}
      <input value={text} list={listId} placeholder="+ étiquette" onChange={(e) => (e.target.value.endsWith(',') ? add(e.target.value) : setText(e.target.value))}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(text); } }} onBlur={() => text && add(text)} />
      <datalist id={listId}>{suggestions.filter((s) => !value.includes(s)).map((s) => <option key={s} value={s} />)}</datalist>
    </div>
  );
}

export function Tags({ tags }: { tags?: string[] }) {
  return tags?.length ? <>{tags.map((t) => <span key={t} className="tag small">{t}</span>)}</> : null;
}

/** Champs personnalisés d'une entité, définis dans Paramètres. */
export function CustomFieldsEditor({ entity, value = {}, onChange }: { entity: CustomField['entity']; value?: CustomValues; onChange: (v: CustomValues) => void }) {
  const fields = (useSettings().customFields || []).filter((f) => f.entity === entity);
  if (!fields.length) return null;
  const set = (id: string, v: CustomValues[string]) => onChange({ ...value, [id]: v });
  return (
    <>
      {fields.map((f) => (
        <Field key={f.id} label={f.label}>
          {f.type === 'oui_non' ? (
            <label className="check-row"><input type="checkbox" checked={!!value[f.id]} onChange={(e) => set(f.id, e.target.checked)} /> Oui</label>
          ) : f.type === 'nombre' ? (
            <input type="number" step="any" value={value[f.id] as number ?? ''} onChange={(e) => set(f.id, e.target.value === '' ? undefined : parseFloat(e.target.value))} />
          ) : f.type === 'liste' ? (
            <select value={(value[f.id] as string) || ''} onChange={(e) => set(f.id, e.target.value || undefined)}>
              <option value="">—</option>
              {(f.choices || []).map((c) => <option key={c}>{c}</option>)}
            </select>
          ) : f.type === 'date' ? (
            <input type="date" value={(value[f.id] as string) || ''} onChange={(e) => set(f.id, e.target.value || undefined)} />
          ) : (
            <input value={(value[f.id] as string) || ''} onChange={(e) => set(f.id, e.target.value || undefined)} />
          )}
        </Field>
      ))}
    </>
  );
}

/** Valeur lisible d'un champ personnalisé. */
export function customText(f: CustomField, v: CustomValues[string]): string {
  if (v === undefined || v === '') return '';
  if (f.type === 'oui_non') return v ? 'Oui' : 'Non';
  if (f.type === 'date') return new Date(String(v)).toLocaleDateString('fr-FR');
  return String(v);
}

/** Export CSV compatible Excel (point-virgule, BOM UTF-8). */
export function exportCsv(filename: string, header: string[], rows: (string | number | undefined | null)[][]) {
  const cell = (v: unknown) => {
    const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  download(filename, '﻿' + [header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
}

/** Bouton « Exporter (CSV) » prêt à l'emploi. */
export function CsvButton({ onClick }: { onClick: () => void }) {
  return <button className="secondary" onClick={onClick}>Exporter (CSV)</button>;
}
