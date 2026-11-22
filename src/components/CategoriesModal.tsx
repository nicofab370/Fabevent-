import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { inCategory, mainCategories, subCategories } from '../categories';
import { cleanLetter, suggestCategoryLetter } from '../codegen';
import { db } from '../db';
import type { Category } from '../types';
import { patch, save } from '../utils';
import { Modal } from './ui';

/**
 * Catégories et sous-catégories du matériel : créer, renommer, déplacer, supprimer.
 * Supprimer une catégorie ne supprime pas son matériel : il passe dans la catégorie principale
 * (ou sans catégorie), et ses sous-catégories deviennent des catégories principales.
 */
export function CategoriesModal({ onClose }: { onClose: () => void }) {
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const equipment = useLiveQuery(() => db.equipment.toArray(), []) || [];
  const [newMain, setNewMain] = useState('');
  const [newSub, setNewSub] = useState<Record<string, string>>({});
  /** articles de la catégorie (une catégorie principale compte aussi ses sous-catégories) */
  const count = (id: string) => equipment.filter((e) => inCategory(cats, e.categoryId, id) && !e.archived).length;
  const direct = (id: string) => equipment.filter((e) => e.categoryId === id).length;
  const taken = cats.map((c) => c.letter || '');
  const mains = mainCategories(cats);

  const rename = (c: Category, name: string) => { if (name.trim() && name.trim() !== c.name) patch(db.categories, c.id, { name: name.trim() }); };
  const remove = async (c: Category) => {
    const n = direct(c.id);
    const subs = subCategories(cats, c.id);
    const parent = c.parentId ? cats.find((x) => x.id === c.parentId) : undefined;
    const msg = [`Supprimer la catégorie « ${c.name} » ?`,
      n ? `${n} article(s) passeront ${parent ? `dans « ${parent.name} »` : 'sans catégorie'}.` : '',
      subs.length ? `Ses ${subs.length} sous-catégorie(s) deviendront des catégories principales.` : ''].filter(Boolean).join('\n');
    if (!confirm(msg)) return;
    await db.transaction('rw', db.categories, db.equipment, async () => {
      for (const e of equipment.filter((x) => x.categoryId === c.id)) await patch(db.equipment, e.id, { categoryId: parent?.id });
      for (const s of subs) await patch(db.categories, s.id, { parentId: undefined, letter: s.letter || c.letter });
      await db.categories.delete(c.id);
    });
  };
  const addSub = async (parent: Category) => {
    const name = (newSub[parent.id] || '').trim();
    if (!name) return;
    await save(db.categories, { name, parentId: parent.id });
    setNewSub({ ...newSub, [parent.id]: '' });
  };

  return (
    <Modal title="Catégories du matériel" onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>
        Une catégorie (Son, Lumière, Vidéo…) peut contenir des sous-catégories (Micro, Console, Haut-parleurs…).
        Filtrer sur une catégorie montre aussi le matériel de ses sous-catégories. La lettre sert dans les codes des articles
        (F-S-0010) ; une sous-catégorie prend la lettre de sa catégorie.
      </p>
      <div className="cat-tree">
        {mains.map((m) => (
          <div key={m.id} className="cat-node">
            <div className="cat-row">
              <input className="cat-name" defaultValue={m.name} aria-label={`Nom de la catégorie ${m.name}`} onBlur={(e) => rename(m, e.target.value)} />
              <input className="cat-letter" value={m.letter || ''} maxLength={3} placeholder={suggestCategoryLetter(m.name, taken)} title="Lettre dans les codes"
                aria-label={`Lettre de la catégorie ${m.name}`} onChange={(e) => patch(db.categories, m.id, { letter: cleanLetter(e.target.value) || undefined })} />
              <span className="muted">{count(m.id) ? `${count(m.id)} article(s)` : ''}</span>
              <button type="button" className="ghost small" aria-label={`Supprimer la catégorie ${m.name}`} onClick={() => remove(m)}>Supprimer</button>
            </div>
            {subCategories(cats, m.id).map((s) => (
              <div key={s.id} className="cat-row sub">
                <span className="muted">›</span>
                <input className="cat-name" defaultValue={s.name} aria-label={`Nom de la sous-catégorie ${s.name}`} onBlur={(e) => rename(s, e.target.value)} />
                <select value={s.parentId} aria-label={`Catégorie de ${s.name}`} title="Déplacer dans une autre catégorie"
                  onChange={(e) => patch(db.categories, s.id, { parentId: e.target.value || undefined })}>
                  {mains.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  <option value="">(catégorie principale)</option>
                </select>
                <span className="muted">{count(s.id) ? `${count(s.id)} article(s)` : ''}</span>
                <button type="button" className="ghost small" aria-label={`Supprimer la sous-catégorie ${s.name}`} onClick={() => remove(s)}>Supprimer</button>
              </div>
            ))}
            <div className="cat-row sub">
              <span className="muted">+</span>
              <input className="cat-name" placeholder="Nouvelle sous-catégorie" value={newSub[m.id] || ''} aria-label={`Nouvelle sous-catégorie de ${m.name}`}
                onChange={(e) => setNewSub({ ...newSub, [m.id]: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(m); } }} />
              <button type="button" className="secondary small" disabled={!(newSub[m.id] || '').trim()} onClick={() => addSub(m)}>Ajouter</button>
            </div>
          </div>
        ))}
      </div>
      <div className="cat-row" style={{ marginTop: 12 }}>
        <input className="cat-name" placeholder="Nouvelle catégorie (ex. Son)" value={newMain} onChange={(e) => setNewMain(e.target.value)} aria-label="Nouvelle catégorie" />
        <button type="button" disabled={!newMain.trim()} onClick={async () => {
          await save(db.categories, { name: newMain.trim(), letter: suggestCategoryLetter(newMain, taken) });
          setNewMain('');
        }}>+ Catégorie</button>
      </div>
    </Modal>
  );
}
