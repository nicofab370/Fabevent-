import { useLiveQuery } from 'dexie-react-hooks';
import { isFixedKit } from '../utils';
import { useState } from 'react';
import { NO_CATEGORY, categoryLabel, inCategory, mainCategories, subCategories, topCategory } from '../categories';
import { db } from '../db';
import type { Equipment } from '../types';
import { Icon } from './Icon';
import { Empty, Modal, NumInput } from './ui';

/**
 * Choisir du matériel dans une fenêtre (jamais dans une simple liste déroulante) :
 * recherche, catégories et sous-catégories, étiquettes ; quantités avec − / + si `withQty`.
 * Utilisé pour les composants d'un kit, les accessoires, les articles de remplacement et les transferts.
 */
export function EquipmentChooser({ title, equipment, exclude = [], withQty = false, includeAccessoryOnly = false, info, onConfirm, onClose }: {
  title: string;
  equipment: Equipment[];
  exclude?: string[];
  withQty?: boolean;
  includeAccessoryOnly?: boolean;
  /** texte affiché à droite de chaque article (ex. « 12 au départ ») */
  info?: (e: Equipment) => string;
  onConfirm: (picked: { equipmentId: string; qty: number }[]) => void;
  onClose: () => void;
}) {
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [tag, setTag] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const base = equipment.filter((e) => !e.archived && !exclude.includes(e.id) && (includeAccessoryOnly || !e.accessoryOnly)
    && words.every((w) => [e.name, e.brand, e.model, e.summary, e.code, e.barcode, ...(e.extraCodes || []), categoryLabel(cats, e.categoryId), ...(e.tags || [])].join(' ').toLowerCase().includes(w)));
  const list = base.filter((e) => inCategory(cats, e.categoryId, cat) && (!tag || e.tags?.includes(tag))).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  const tags = Array.from(new Set(equipment.flatMap((e) => e.tags || []))).sort();
  const picked = Object.entries(qty).filter(([, n]) => n > 0).map(([equipmentId, n]) => ({ equipmentId, qty: n }));
  const bump = (id: string, d: number) => setQty((x) => ({ ...x, [id]: Math.max(0, (x[id] || 0) + d) }));
  const choose = (e: Equipment) => { if (withQty) bump(e.id, 1); else setQty((x) => ({ ...x, [e.id]: x[e.id] ? 0 : 1 })); };
  const parentId = cat === NO_CATEGORY ? undefined : topCategory(cats, cat)?.id;
  const subs = parentId ? subCategories(cats, parentId, true) : [];

  return (
    <Modal title={title} onClose={onClose} wide>
      {/* la fenêtre peut s'ouvrir dans un formulaire : Entrée ne doit pas l'envoyer */}
      <div className="picker" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault(); }}>
        <div className="picker-filters">
          <input autoFocus placeholder="Rechercher (nom, code, catégorie, étiquette)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher du matériel" />
          <div className="chips">
            <button type="button" className={'chip' + (!cat ? ' on' : '')} onClick={() => setCat('')}>Tout ({base.length})</button>
            {mainCategories(cats, true).map((c) => {
              const n = base.filter((e) => inCategory(cats, e.categoryId, c.id)).length;
              return n ? <button type="button" key={c.id} className={'chip' + (cat && inCategory(cats, cat, c.id) ? ' on' : '')} onClick={() => setCat(cat === c.id ? '' : c.id)}>{c.name} ({n})</button> : null;
            })}
            {(() => { const n = base.filter((e) => inCategory(cats, e.categoryId, NO_CATEGORY)).length; return n ? <button type="button" className={'chip' + (cat === NO_CATEGORY ? ' on' : '')} onClick={() => setCat(cat === NO_CATEGORY ? '' : NO_CATEGORY)}>Sans catégorie ({n})</button> : null; })()}
          </div>
          {subs.length > 0 && (
            <div className="chips sub-chips" aria-label="Sous-catégories">
              {subs.map((c) => {
                const n = base.filter((e) => inCategory(cats, e.categoryId, c.id)).length;
                return n ? <button type="button" key={c.id} className={'chip' + (cat === c.id ? ' on' : '')} onClick={() => setCat(cat === c.id ? parentId! : c.id)}>{c.name} ({n})</button> : null;
              })}
            </div>
          )}
          {tags.length > 0 && (
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 'auto' }} aria-label="Étiquette">
                <option value="">Toutes étiquettes</option>
                {tags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="pick-list">
          {list.length === 0 ? <Empty>Aucun article.</Empty> : list.map((e) => {
            const n = qty[e.id] || 0;
            return (
              <div key={e.id} className={'pick-row chooser-row' + (n ? ' on' : '')} onClick={(ev) => { if (!(ev.target as HTMLElement).closest('input,button')) choose(e); }}
                title={withQty ? 'Clic : +1' : 'Clic : choisir'}>
                {e.photo ? <img src={e.photo} alt="" className="thumb" /> : <span className="thumb" />}
                <div className="pick-name">
                  <div><strong>{e.name}</strong> {e.isKit && <span className="badge">{isFixedKit(e) ? 'Kit fixe' : 'Kit'}</span>} {e.accessoryOnly && <span className="badge">hors inventaire</span>}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{[e.code, categoryLabel(cats, e.categoryId)].filter(Boolean).join(' · ')}</div>
                </div>
                <span className="muted pick-price">{info?.(e)}</span>
                {withQty ? (
                  <div className="stepper">
                    <button type="button" className="ghost" aria-label={`Moins ${e.name}`} disabled={!n} onClick={() => bump(e.id, -1)}>−</button>
                    <NumInput className="w-qty" value={n} placeholder="0" onChange={(v) => setQty((x) => ({ ...x, [e.id]: v }))} aria-label={`Quantité ${e.name}`} />
                    <button type="button" className="ghost" aria-label={`Plus ${e.name}`} onClick={() => bump(e.id, 1)}>+</button>
                  </div>
                ) : (
                  <input type="checkbox" checked={!!n} onChange={() => choose(e)} aria-label={`Choisir ${e.name}`} />
                )}
              </div>
            );
          })}
        </div>
        {picked.length > 0 && (
          <div className="picker-selection">
            <strong>Sélection :</strong> {picked.map((p) => (
              <span key={p.equipmentId} className="tag small">{withQty ? `${p.qty} × ` : ''}{equipment.find((e) => e.id === p.equipmentId)?.name}
                <button type="button" className="ghost small" aria-label="Retirer" onClick={() => setQty((x) => ({ ...x, [p.equipmentId]: 0 }))}><Icon name="x" /></button></span>
            ))}
          </div>
        )}
      </div>
      <div className="form-actions" style={{ marginTop: 12, display: 'flex' }}>
        <button type="button" className="secondary" onClick={onClose}>Annuler</button>
        <button type="button" disabled={!picked.length} onClick={() => { onConfirm(picked); onClose(); }}>Ajouter{picked.length ? ` (${picked.length})` : ''}</button>
      </div>
    </Modal>
  );
}
