import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { articleCode, categoryLetter, cleanLetter, nextArticleNumber, nextUnitCode, suggestCategoryLetter } from '../codegen';
import { db } from '../db';
import { patch } from '../utils';

/**
 * Lettres des catégories et génération des codes manquants (F-S-0010, unités F-S-0010-03).
 * Les codes déjà attribués ne sont jamais modifiés : ils sont sur les étiquettes.
 */
export function CodesPanel({ letterOf }: { letterOf: (depotId?: string) => string }) {
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const equipment = useLiveQuery(() => db.equipment.toArray(), []) || [];
  const units = useLiveQuery(() => db.units.toArray(), []) || [];
  const [msg, setMsg] = useState('');
  const missingEq = equipment.filter((e) => !e.code?.trim() && !e.archived);
  const missingUnits = units.filter((u) => !u.barcode?.trim());
  const taken = cats.map((c) => c.letter || '');
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Chaque nouvel article reçoit un code <strong>dépôt-catégorie-numéro</strong>, ex. <code>{letterOf()}-S-0010</code> (S son, V vidéo, L lumière,
        IT informatique, R rigging… ; K pour un kit). Le numéro est unique et jamais réutilisé. Une unité à numéro de série reçoit le code de son
        article suivi de son rang : <code>{letterOf()}-S-0010-03</code> ; au-delà de 99 unités, le rang passe en hexadécimal (0A, 0B… FF).
      </p>
      <div className="cat-letters" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {cats.map((c) => (
          <label key={c.id} className="check-row">{c.name}
            <input value={c.letter || ''} maxLength={3} placeholder={suggestCategoryLetter(c.name, taken)} style={{ width: 56 }} aria-label={`Lettre de la catégorie ${c.name}`}
              onChange={(e) => patch(db.categories, c.id, { letter: cleanLetter(e.target.value) || undefined })} />
          </label>
        ))}
      </div>
      <button type="button" className="secondary small" disabled={!missingEq.length && !missingUnits.length} onClick={async () => {
        if (!confirm(`Donner un code à ${missingEq.length} article(s) et ${missingUnits.length} unité(s) qui n'en ont pas ? Les codes existants ne changent pas.`)) return;
        const all = await db.equipment.toArray();
        let n = nextArticleNumber(all);
        // lettres proposées enregistrées pour les catégories qui n'en ont pas
        for (const c of cats) if (!c.letter) await patch(db.categories, c.id, { letter: suggestCategoryLetter(c.name, taken) });
        const fresh = await db.categories.toArray();
        for (const e of missingEq.sort((a, b) => a.name.localeCompare(b.name))) {
          const cat = e.isKit ? 'K' : categoryLetter(fresh.find((c) => c.id === e.categoryId));
          await patch(db.equipment, e.id, { code: articleCode(letterOf(e.homeDepotId), cat, n++) });
        }
        const eqs = await db.equipment.toArray();
        const allUnits = await db.units.toArray();
        for (const u of missingUnits) {
          const e = eqs.find((x) => x.id === u.equipmentId);
          if (!e) continue;
          const code = nextUnitCode(e, allUnits.filter((x) => x.equipmentId === e.id));
          await patch(db.units, u.id, { barcode: code });
          const i = allUnits.findIndex((x) => x.id === u.id);
          allUnits[i] = { ...allUnits[i], barcode: code };
        }
        setMsg(`${missingEq.length} article(s) et ${missingUnits.length} unité(s) codés.`);
      }}>Générer les codes manquants ({missingEq.length} article(s), {missingUnits.length} unité(s))</button>
      {msg && <span className="avail ok" style={{ marginLeft: 8 }}>{msg}</span>}
    </>
  );
}
