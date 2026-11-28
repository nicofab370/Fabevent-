/**
 * Sélection de plusieurs lignes dans un tableau de liste : case par ligne, case « tout sélectionner »
 * (les lignes affichées, après filtres), et barre d'actions sur la sélection (supprimer, modifier, exporter…).
 */
import { useMemo, useState, type ReactNode } from 'react';

export interface Selection {
  ids: string[];
  size: number;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
  clear: () => void;
  allChecked: boolean;
  setAll: (on: boolean) => void;
}

/** Sélection limitée aux lignes encore affichées (une ligne filtrée ou supprimée sort de la sélection). */
export function useSelection(visibleIds: string[]): Selection {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const visible = useMemo(() => new Set(visibleIds), [visibleIds]);
  const ids = [...sel].filter((id) => visible.has(id));
  return {
    ids,
    size: ids.length,
    has: (id) => sel.has(id) && visible.has(id),
    toggle: (id) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    clear: () => setSel(new Set()),
    allChecked: visibleIds.length > 0 && visibleIds.every((id) => sel.has(id)),
    setAll: (on) => setSel(on ? new Set(visibleIds) : new Set()),
  };
}

/** Titre de la colonne des cases (pas triable). */
export function SelectAllTh({ sel }: { sel: Selection }) {
  return (
    <th className="no-sort sel-col">
      <input type="checkbox" aria-label="Tout sélectionner" title="Tout sélectionner / tout désélectionner" checked={sel.allChecked} onChange={(e) => sel.setAll(e.target.checked)} />
    </th>
  );
}

/** Case d'une ligne : le clic ne déclenche pas l'ouverture de la ligne. */
export function SelectTd({ sel, id, label }: { sel: Selection; id: string; label: string }) {
  return (
    <td className="sel-col" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" aria-label={`Sélectionner ${label}`} checked={sel.has(id)} onChange={() => sel.toggle(id)} />
    </td>
  );
}

/** Barre des actions sur la sélection (affichée dès qu'une ligne est cochée). */
export function BulkBar({ sel, noun, children }: { sel: Selection; noun: string; children: ReactNode }) {
  if (!sel.size) return null;
  return (
    <div className="info bulk-bar">
      <strong>{sel.size} {noun} sélectionné(s)</strong>
      {children}
      <button className="secondary small" onClick={sel.clear}>Désélectionner</button>
    </div>
  );
}

/** Choix d'une valeur appliquée à toute la sélection (statut, type, fonction…). */
export function BulkSet({ label, options, onApply }: { label: string; options: [string, string][]; onApply: (value: string) => void }) {
  return (
    <select className="small" aria-label={label} title={label} value="" onChange={(e) => { if (e.target.value) onApply(e.target.value); }}>
      <option value="">{label}…</option>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}
