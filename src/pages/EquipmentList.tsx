import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { cleanLetter, newArticleCode, suggestCategoryLetter } from '../codegen';
import { useNavigate } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead, useSettings } from '../components/ui';
import { db } from '../db';
import type { Category, Equipment } from '../types';
import { useAvailability } from '../data';
import { resizeImage } from '../image';
import { CsvButton, CustomFieldsEditor, exportCsv, TagInput, Tags } from '../components/extra';
import { availableQty, money, save, stockIn, toLocalInput } from '../utils';
import PrintLabelModal from '../components/PrintLabelModal';
import { Icon } from '../components/Icon';
import { CategoryOptions } from '../components/CategoryOptions';
import { CategoriesModal } from '../components/CategoriesModal';
import { categoryLabel, inCategory, mainCategories } from '../categories';

type Draft = Omit<Equipment, 'id' | 'createdAt' | 'updatedAt'> & Partial<Equipment>;
const blank = (): Draft => ({ name: '', quantity: 1, dailyPrice: 0, isKit: false, kitItems: [] });

export function EquipmentForm({ initial, onDone, onPrint }: { initial?: Draft; onDone: () => void; /** « Enregistrer et imprimer l'étiquette » */ onPrint?: (equipmentId: string) => void }) {
  const [e, setE] = useState<Draft>(initial || blank());
  const [newCat, setNewCat] = useState('');
  const [newLetter, setNewLetter] = useState('');
  const [newParent, setNewParent] = useState('');
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const settings = useSettings();
  const depots = settings.depots || [];
  // code automatique F-S-0010 tant qu'il n'a pas été saisi à la main (jamais changé pour un article existant)
  const [codeAuto, setCodeAuto] = useState(!initial?.code);
  const letterSuggest = suggestCategoryLetter(newCat, cats.map((c) => c.letter || ''));
  const previewCats = newCat.trim() ? [...cats, { id: '__new', name: newCat, parentId: newParent || undefined, letter: newParent ? undefined : cleanLetter(newLetter) || letterSuggest } as Category] : cats;
  const all = useLiveQuery(() => db.equipment.orderBy('name').toArray(), []) || [];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setE({ ...e, [k]: v });

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const print = (ev.nativeEvent as SubmitEvent).submitter?.getAttribute('data-print') === '1';
    let categoryId = e.categoryId;
    if (newCat.trim()) categoryId = (await save(db.categories, newParent ? { name: newCat.trim(), parentId: newParent } : { name: newCat.trim(), letter: cleanLetter(newLetter) || letterSuggest })).id;
    let code = e.code?.trim();
    if (!code && codeAuto) code = newArticleCode({ ...e, categoryId }, settings, await db.categories.toArray(), await db.equipment.toArray());
    const contents = (e.contents || []).filter((c) => c.name.trim()).map((c) => ({ name: c.name.trim(), qty: c.qty || 1 }));
    const rec = await save(db.equipment, { ...e, categoryId, code, contents: contents.length ? contents : undefined } as Equipment);
    onDone();
    if (print) onPrint?.(rec.id);
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Désignation *" full><input required autoFocus value={e.name} onChange={(x) => set('name', x.target.value)} /></Field>
      <Field label="Code (automatique : dépôt-catégorie-numéro)">
        <input value={e.code || ''} onChange={(x) => { set('code', x.target.value); setCodeAuto(!x.target.value); }}
          placeholder={codeAuto ? `auto : ${newArticleCode({ ...e, categoryId: newCat.trim() ? '__new' : e.categoryId }, settings, previewCats, all)}` : ''} />
      </Field>
      <Field label="Code-barres / QR"><input value={e.barcode || ''} onChange={(x) => set('barcode', x.target.value)} /></Field>
      <Field label="Catégorie">
        <select value={e.categoryId || ''} onChange={(x) => set('categoryId', x.target.value || undefined)}>
          <option value="">—</option>
          <CategoryOptions cats={cats} />
        </select>
      </Field>
      <Field label="…ou nouvelle catégorie"><input value={newCat} onChange={(x) => setNewCat(x.target.value)} placeholder="ex. Son, Lumière, Micro" /></Field>
      {newCat.trim() && (
        <Field label="Sous-catégorie de">
          <select value={newParent} onChange={(x) => setNewParent(x.target.value)} aria-label="Catégorie principale de la nouvelle catégorie">
            <option value="">— aucune (catégorie principale) —</option>
            {mainCategories(cats).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      )}
      {newCat.trim() && !newParent && (
        <Field label="Lettre de la nouvelle catégorie (dans les codes)">
          <input value={newLetter} maxLength={3} onChange={(x) => setNewLetter(cleanLetter(x.target.value))} placeholder={letterSuggest} aria-label="Lettre de la catégorie" />
        </Field>
      )}
      {depots.length > 1 && (
        <Field label="Dépôt de base (lettre du code)">
          <select value={e.homeDepotId || depots[0].id} onChange={(x) => set('homeDepotId', x.target.value)}>
            {depots.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.letter || '?'})</option>)}
          </select>
        </Field>
      )}
      <Field label="Type">
        <select value={e.kind || 'location'} onChange={(x) => set('kind', x.target.value as Draft['kind'])}>
          <option value="location">Location (facturé par jour, revient au dépôt)</option>
          <option value="vente">Consommable / vente (facturé à la pièce)</option>
        </select>
      </Field>
      <Field label=" ">
        <label className="check-row"><input type="checkbox" checked={!!e.trackSerials} onChange={(x) => set('trackSerials', x.target.checked)} /> Suivi par numéro de série</label>
      </Field>
      <Field label=" ">
        <label className="check-row" title="Chargeur, dock, housse… : seulement comme accessoire d'autres articles"><input type="checkbox" checked={!!e.accessoryOnly} onChange={(x) => set('accessoryOnly', x.target.checked || undefined)} /> Élément hors inventaire (accessoire seulement)</label>
      </Field>
      {e.accessoryOnly ? <Field label="Quantité en stock"><span className="muted">pas de stock : l'élément suit l'article dont il est l'accessoire</span></Field> : e.trackSerials
        ? <Field label="Quantité en stock"><span className="muted">= nombre d'unités en service (gérées sur la fiche article)</span></Field>
        : depots.length > 1 ? (
          <div className="field full">
            <span>Stock par dépôt (total : {e.quantity})</span>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {depots.map((dp, i) => {
                const others = depots.slice(1).reduce((a, x) => a + (e.stock?.[x.id] || 0), 0);
                const val = i === 0 ? Math.max(0, e.quantity - others) : e.stock?.[dp.id] || 0;
                return (
                  <label key={dp.id} className="check-row">{dp.name}
                    <NumInput className="w-qty" step="1" min={0} value={val} onChange={(n) => {
                      if (i === 0) set('quantity', n + others);
                      else {
                        const stock = { ...(e.stock || {}), [dp.id]: n };
                        setE({ ...e, stock, quantity: Math.max(0, e.quantity - others) + depots.slice(1).reduce((a, x) => a + (stock[x.id] || 0), 0) });
                      }
                    }} />
                  </label>
                );
              })}
            </div>
          </div>
        )
        : <Field label="Quantité en stock"><NumInput value={e.quantity} onChange={(n) => set('quantity', n)} step="1" min={0} /></Field>}
      <Field label={e.kind === 'vente' ? 'Prix de vente unitaire HT (€)' : 'Prix location / jour HT (€)'}><NumInput value={e.dailyPrice} onChange={(n) => set('dailyPrice', n)} /></Field>
      {e.kind === 'vente' && <Field label="Prix d'achat unitaire HT (€)"><NumInput value={e.costPrice || 0} onChange={(n) => set('costPrice', n)} /></Field>}
      <Field label="Contrôle périodique tous les (mois, 0 = aucun)"><NumInput value={e.inspectionMonths || 0} step="1" min={0} onChange={(n) => set('inspectionMonths', n)} /></Field>
      <Field label="Valeur de remplacement (€)"><NumInput value={e.replacementValue || 0} onChange={(n) => set('replacementValue', n)} /></Field>
      <Field label="Poids unitaire (kg)"><NumInput value={e.weight || 0} onChange={(n) => set('weight', n)} /></Field>
      <Field label="Emplacement dépôt"><input value={e.location || ''} onChange={(x) => set('location', x.target.value)} placeholder="ex. Rack A3" /></Field>
      <Field label=" ">
        <label className="check-row"><input type="checkbox" checked={e.isKit} onChange={(x) => set('isKit', x.target.checked)} /> C'est un kit / pack</label>
      </Field>
      {e.isKit && (
        <div className="field full">
          <span>Contenu du kit (la disponibilité est calculée à partir des composants)</span>
          {e.kitItems.map((k, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
              <NumInput className="w-qty" value={k.qty} step="1" min={1} onChange={(n) => set('kitItems', e.kitItems.map((x, j) => (j === i ? { ...x, qty: n } : x)))} />
              <select value={k.equipmentId} onChange={(x) => set('kitItems', e.kitItems.map((y, j) => (j === i ? { ...y, equipmentId: x.target.value } : y)))}>
                {all.filter((a) => a.id !== e.id).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <button type="button" className="ghost" onClick={() => set('kitItems', e.kitItems.filter((_, j) => j !== i))}><Icon name="x" /></button>
            </div>
          ))}
          <div>
            <button type="button" className="secondary small" disabled={!all.length}
              onClick={() => set('kitItems', [...e.kitItems, { equipmentId: all.find((a) => a.id !== e.id)?.id || '', qty: 1 }])}>+ Composant</button>
          </div>
        </div>
      )}
      <div className="field full contents-editor">
        <span>Contenu fourni avec l'article (sans fiche ni stock à part : chargeur, câble, housse…)</span>
        {(e.contents || []).map((c, i) => {
          const upd = (patch: Partial<typeof c>) => set('contents', (e.contents || []).map((y, j) => (j === i ? { ...y, ...patch } : y)));
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <NumInput className="w-qty" value={c.qty} onChange={(n) => upd({ qty: n || 1 })} aria-label="Quantité du contenu" />
              <input value={c.name} onChange={(x) => upd({ name: x.target.value })} placeholder="ex. Chargeur 65 W" aria-label="Élément du contenu" />
              <button type="button" className="ghost" onClick={() => set('contents', (e.contents || []).filter((_, j) => j !== i))} aria-label="Retirer"><Icon name="x" /></button>
            </div>
          );
        })}
        <div><button type="button" className="secondary small" onClick={() => set('contents', [...(e.contents || []), { name: '', qty: 1 }])}>+ Élément du contenu</button></div>
        <small className="muted">Affiché au scan, sur la checklist, le bon de sortie, la feuille de route et (au choix) l'étiquette. Pour un accessoire suivi en stock ou facturé, utilise plutôt les accessoires ci-dessous.</small>
      </div>
      <div className="field full">
        <span>Accessoires ajoutés automatiquement (par unité de cet article)</span>
        {(e.accessories || []).map((a, i) => {
          const upd = (patch: Partial<typeof a>) => set('accessories', (e.accessories || []).map((y, j) => (j === i ? { ...y, ...patch } : y)));
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <NumInput className="w-qty" value={a.qty} step="1" min={1} onChange={(n) => upd({ qty: n })} />
              <select value={a.equipmentId} onChange={(x) => upd({ equipmentId: x.target.value })}>
                {all.filter((o) => o.id !== e.id).map((o) => <option key={o.id} value={o.id}>{o.name}{o.accessoryOnly ? ' (hors inventaire)' : ''}</option>)}
              </select>
              <label className="check-row" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={a.free} onChange={(x) => upd({ free: x.target.checked })} /> gratuit</label>
              <button type="button" className="ghost" onClick={() => set('accessories', (e.accessories || []).filter((_, j) => j !== i))}><Icon name="x" /></button>
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="secondary small" disabled={all.length < 2 && !all.some((o) => o.id !== e.id)}
            onClick={() => set('accessories', [...(e.accessories || []), { equipmentId: all.find((o) => o.id !== e.id)?.id || '', qty: 1, free: true }])}>+ Accessoire existant</button>
          <button type="button" className="secondary small" onClick={async () => {
            const name = prompt('Nom du nouvel élément d\'accessoire (ex. Chargeur 65 W, Dock USB-C) :')?.trim();
            if (!name) return;
            // élément hors inventaire : pas de stock ni de disponibilité, il suit son article
            const acc = await save(db.equipment, { name, accessoryOnly: true, quantity: 0, dailyPrice: 0, isKit: false, kitItems: [], categoryId: e.categoryId });
            set('accessories', [...(e.accessories || []), { equipmentId: acc.id, qty: 1, free: true }]);
          }}>+ Nouvel élément (hors inventaire)</button>
        </div>
        <small className="muted">Un élément hors inventaire (chargeur, dock, housse…) n'apparaît ni dans le catalogue ni dans l'inventaire : il est ajouté avec son article et se coche à la sortie et au retour.</small>
      </div>
      <div className="field full">
        <span>Articles de remplacement (proposés en cas de manque)</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {(e.alternatives || []).map((id) => (
            <span key={id} className="badge">{all.find((a) => a.id === id)?.name || '?'} <button type="button" className="ghost small" onClick={() => set('alternatives', (e.alternatives || []).filter((x) => x !== id))}><Icon name="x" /></button></span>
          ))}
          <select value="" style={{ width: 'auto' }} onChange={(x) => x.target.value && set('alternatives', [...(e.alternatives || []), x.target.value])}>
            <option value="">+ Ajouter…</option>
            {all.filter((a) => a.id !== e.id && !a.archived && !(e.alternatives || []).includes(a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>
      <Field label="Photo">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {e.photo && <img src={e.photo} alt="" style={{ height: 48, borderRadius: 6 }} />}
          <input type="file" accept="image/*" onChange={async (x) => { const f = x.target.files?.[0]; if (f) set('photo', await resizeImage(f)); }} />
          {e.photo && <button type="button" className="ghost small" onClick={() => set('photo', undefined)}>Retirer</button>}
        </div>
      </Field>
      <Field label=" "><label className="check-row"><input type="checkbox" checked={!!e.archived} onChange={(x) => set('archived', x.target.checked)} /> Archivé (n'est plus proposé dans les projets)</label></Field>
      <Field label="Étiquettes"><TagInput value={e.tags} onChange={(tags) => set('tags', tags)} /></Field>
      <CustomFieldsEditor entity="materiel" value={e.custom} onChange={(custom) => set('custom', custom)} />
      <Field label="Notes" full><textarea value={e.notes || ''} onChange={(x) => set('notes', x.target.value)} /></Field>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onDone}>Annuler</button>
        <button type="submit">Enregistrer</button>
        {/* après « Enregistrer » dans le code (Entrée enregistre sans imprimer), affiché à gauche */}
        {onPrint && !e.isKit && !e.accessoryOnly && (
          <button type="submit" className="secondary" data-print="1" style={{ order: -1, marginRight: 'auto' }} title="Enregistre l'article puis ouvre l'impression de son étiquette (Brother PT-P750W)"><Icon name="tag" />Enregistrer et imprimer l'étiquette</button>
        )}
      </div>
    </form>
  );
}

export default function EquipmentList() {
  const nav = useNavigate();
  const { equipment, res, depots } = useAvailability();
  const [depot, setDepot] = useState('');
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [tag, setTag] = useState('');
  const [creating, setCreating] = useState(false);
  const [printId, setPrintId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState(false);
  const now = new Date();
  const [from, setFrom] = useState(toLocalInput(now));
  const [to, setTo] = useState(toLocalInput(new Date(now.getTime() + 86400000)));

  const catName = new Map(cats.map((c) => [c.id, categoryLabel(cats, c.id)]));
  const [showCats, setShowCats] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [showAcc, setShowAcc] = useState(false);
  const allTags = Array.from(new Set(equipment.flatMap((e) => e.tags || []))).sort();
  const filtered = equipment.filter((e) =>
    !!e.archived === showArchived &&
    !!e.accessoryOnly === showAcc &&
    inCategory(cats, e.categoryId, cat) &&
    (!tag || e.tags?.includes(tag)) &&
    [e.name, e.code, e.barcode, ...(e.tags || [])].join(' ').toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n); };

  const csv = () => exportCsv('materiel.csv', ['Désignation', 'Référence', 'Catégorie', 'Type', 'Stock', 'Prix HT', "Valeur de remplacement", 'Poids', 'Code-barres', 'Emplacement', 'Étiquettes', 'Archivé'],
    filtered.map((e) => [e.name, e.code, e.categoryId ? catName.get(e.categoryId) : '', e.isKit ? 'kit' : e.kind || 'location', e.quantity, e.dailyPrice, e.replacementValue, e.weight, e.barcode, e.location, (e.tags || []).join(', '), e.archived ? 'oui' : '']));

  return (
    <>
      <PageHead title="Matériel">
        <CsvButton onClick={csv} />
        <button className="secondary" onClick={() => nav('/etiquettes')}>Étiquettes QR</button>
        <button className="secondary" onClick={() => nav('/inventaire')}>Inventaire</button>
        <button className="secondary" onClick={() => setShowCats(true)}>Catégories</button>
        <button onClick={() => setCreating(true)}>+ Nouvel article</button>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Rechercher (nom, réf, code-barres, étiquette)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Toutes catégories</option>
            <CategoryOptions cats={cats} />
          </select>
          {depots.length > 1 && (
            <select value={depot} onChange={(e) => setDepot(e.target.value)}>
              <option value="">Tous les dépôts</option>
              {depots.map((dp) => <option key={dp.id} value={dp.id}>{dp.name}</option>)}
            </select>
          )}
          {allTags.length > 0 && (
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="">Toutes étiquettes</option>
              {allTags.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <label className="check-row"><input type="checkbox" checked={showArchived} onChange={(x) => setShowArchived(x.target.checked)} /> Archivés</label>
          <label className="check-row" title="Chargeurs, docks… qui n'existent que comme accessoires d'autres articles"><input type="checkbox" checked={showAcc} onChange={(x) => setShowAcc(x.target.checked)} /> Éléments hors inventaire</label>
          <span className="muted" style={{ alignSelf: 'center' }}>Dispo du</span>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted" style={{ alignSelf: 'center' }}>au</span>
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {selected.size > 0 && (
          <div className="info bulk-bar">
            <strong>{selected.size} article(s) sélectionné(s)</strong>
            <button className="small" onClick={() => setBulk(true)}>Modifier en groupe…</button>
            <button className="secondary small" onClick={() => setSelected(new Set())}>Désélectionner</button>
          </div>
        )}
        {filtered.length === 0 ? <Empty>Aucun article. Crée-en un ou importe ton catalogue (menu Import).</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr>
                <th><input type="checkbox" aria-label="Tout sélectionner" checked={filtered.length > 0 && filtered.every((e) => selected.has(e.id))}
                  onChange={(x) => setSelected(x.target.checked ? new Set(filtered.map((e) => e.id)) : new Set())} /></th>
                <th>Désignation</th><th>Réf.</th><th>Catégorie</th><th className="n">Stock</th><th className="n">Dispo période</th><th className="n">Prix/j HT</th>
              </tr></thead>
              <tbody>
                {filtered.map((e) => {
                  const av = availableQty(e, equipment, res, from, to, undefined, depot || undefined);
                  return (
                    <tr key={e.id} className="click" onClick={() => nav('/materiel/' + e.id)}>
                      <td onClick={(x) => x.stopPropagation()}><input type="checkbox" aria-label={`Sélectionner ${e.name}`} checked={selected.has(e.id)} onChange={() => toggle(e.id)} /></td>
                      <td>{e.photo && <img src={e.photo} alt="" className="thumb" />}<strong>{e.name}</strong> {e.isKit && <span className="badge">Kit</span>} {e.kind === 'vente' && <span className="badge">vente</span>} {e.trackSerials && <span className="badge">n° série</span>} <Tags tags={e.tags} /></td>
                      <td>{e.code}</td>
                      <td>{e.categoryId ? catName.get(e.categoryId) : ''}</td>
                      <td className="n" title={e._stock ? depots.map((dp) => `${dp.name} : ${e._stock?.[dp.id] || 0}`).join('\n') : undefined}>{e.isKit || e.accessoryOnly ? '—' : depot ? stockIn(e, depot) : e.quantity}</td>
                      <td className="n">{e.accessoryOnly ? <span className="muted">hors inventaire</span> : <span className={'avail ' + (av > 0 ? 'ok' : 'ko')}>{av}</span>}</td>
                      <td className="n">{money(e.dailyPrice)}{e.kind === 'vente' ? ' /pce' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <Modal title="Nouvel article" onClose={() => setCreating(false)} wide><EquipmentForm onDone={() => setCreating(false)} onPrint={setPrintId} /></Modal>}
      {printId && <PrintLabelModal equipmentId={printId} onClose={() => setPrintId(null)} />}
      {showCats && <CategoriesModal onClose={() => setShowCats(false)} />}
      {bulk && <BulkEdit ids={[...selected]} onClose={(done) => { setBulk(false); if (done) setSelected(new Set()); }} />}
    </>
  );
}

/** Modification groupée : prix (%), catégorie, étiquette, archivage. */
function BulkEdit({ ids, onClose }: { ids: string[]; onClose: (done: boolean) => void }) {
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const [pct, setPct] = useState(0);
  const [round, setRound] = useState(true);
  const [catId, setCatId] = useState('');
  const [addTag, setAddTag] = useState('');
  const [archive, setArchive] = useState<'' | 'oui' | 'non'>('');
  const [msg, setMsg] = useState('');
  return (
    <Modal title={`Modifier ${ids.length} article(s)`} onClose={() => onClose(false)}>
      <form className="form" onSubmit={async (ev) => {
        ev.preventDefault();
        let n = 0;
        for (const id of ids) {
          const e = await db.equipment.get(id);
          if (!e) continue;
          const price = pct ? e.dailyPrice * (1 + pct / 100) : e.dailyPrice;
          await save(db.equipment, {
            ...e,
            dailyPrice: pct ? (round ? Math.round(price * 2) / 2 : Math.round(price * 100) / 100) : e.dailyPrice,
            categoryId: catId || e.categoryId,
            tags: addTag.trim() ? Array.from(new Set([...(e.tags || []), addTag.trim()])) : e.tags,
            archived: archive === '' ? e.archived : archive === 'oui',
          });
          n++;
        }
        setMsg(`${n} article(s) mis à jour.`);
        setTimeout(() => onClose(true), 700);
      }}>
        <Field label="Variation des prix (%)"><NumInput step="any" value={pct} onChange={(n) => setPct(n)} /></Field>
        <Field label=" "><label className="check-row"><input type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} /> Arrondir aux 0,50 €</label></Field>
        <Field label="Catégorie">
          <select value={catId} onChange={(e) => setCatId(e.target.value)}>
            <option value="">— inchangée —</option>
            <CategoryOptions cats={cats} />
          </select>
        </Field>
        <Field label="Ajouter l'étiquette"><input value={addTag} onChange={(e) => setAddTag(e.target.value)} /></Field>
        <Field label="Archivage">
          <select value={archive} onChange={(e) => setArchive(e.target.value as typeof archive)}>
            <option value="">— inchangé —</option><option value="oui">Archiver</option><option value="non">Désarchiver</option>
          </select>
        </Field>
        {msg && <p className="avail ok field full">{msg}</p>}
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => onClose(false)}>Annuler</button>
          <button type="submit">Appliquer</button>
        </div>
      </form>
    </Modal>
  );
}
