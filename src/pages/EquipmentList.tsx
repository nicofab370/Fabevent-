import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useState } from 'react';
import { cleanLetter, newArticleCode, suggestCategoryLetter } from '../codegen';
import { useNavigate } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead, useSettings } from '../components/ui';
import { db } from '../db';
import type { Category, Equipment } from '../types';
import { useAvailability } from '../data';
import { resizeImage } from '../image';
import { CsvButton, CustomFieldsEditor, exportCsv, TagInput, Tags } from '../components/extra';
import { availableQty, inDepot, kitBreakdown, money, save, stockAt, toLocalInput } from '../utils';
import PrintLabelModal from '../components/PrintLabelModal';
import { Icon } from '../components/Icon';
import { CategoryOptions } from '../components/CategoryOptions';
import { CategoriesModal } from '../components/CategoriesModal';
import { EquipmentChooser } from '../components/EquipmentChooser';
import { categoryLabel, inCategory, mainCategories } from '../categories';
import { composeName, splitName } from '../equipmentName';
import { useUser } from '../auth';
import { fillFromSimilar, similarEquipment, specSearchUrl } from '../lookup';
import { canEditEquipment, canEditPrices } from '../roles';

type Draft = Omit<Equipment, 'id' | 'createdAt' | 'updatedAt'> & Partial<Equipment>;
const blank = (): Draft => ({ name: '', quantity: 1, dailyPrice: 0, isKit: false, kitItems: [] });

export function EquipmentForm({ initial, onDone, onPrint }: { initial?: Draft; onDone: () => void; /** « Enregistrer et imprimer l'étiquette » */ onPrint?: (equipmentId: string) => void }) {
  const [e, setE] = useState<Draft>(initial || blank());
  // l'entrepôt modifie le matériel mais jamais les prix (réservés à l'admin)
  const lockPrices = !canEditPrices(useUser());
  const [newCat, setNewCat] = useState('');
  const [newLetter, setNewLetter] = useState('');
  const [newParent, setNewParent] = useState('');
  const [choosing, setChoosing] = useState<'' | 'kit' | 'acc' | 'alt'>('');
  const nameOf = (id: string) => all.find((a) => a.id === id)?.name || '?';
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const settings = useSettings();
  const depots = settings.depots || [];
  // code automatique F-S-0010 tant qu'il n'a pas été saisi à la main (jamais changé pour un article existant)
  const [codeAuto, setCodeAuto] = useState(!initial?.code);
  // désignation composée (marque modèle (description)) tant qu'elle n'a pas été écrite à la main
  const [nameAuto, setNameAuto] = useState(!initial?.name || initial.name === composeName(initial.brand, initial.model, initial.summary));
  const setPart = (k: 'brand' | 'model' | 'summary', v: string) => setE((x) => {
    const n = { ...x, [k]: v || undefined };
    return nameAuto ? { ...n, name: composeName(n.brand, n.model, n.summary) } : n;
  });
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
    const extraCodes = Array.from(new Set((e.extraCodes || []).map((x) => x.trim()).filter(Boolean)));
    const rec = await save(db.equipment, { ...e, categoryId, code, contents: contents.length ? contents : undefined, extraCodes: extraCodes.length ? extraCodes : undefined } as Equipment);
    onDone();
    if (print) onPrint?.(rec.id);
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Marque"><input autoFocus value={e.brand || ''} onChange={(x) => setPart('brand', x.target.value)} placeholder="ex. Shure" aria-label="Marque" list="fab-brands" /></Field>
      <Field label="Modèle"><input value={e.model || ''} onChange={(x) => setPart('model', x.target.value)} placeholder="ex. SM58s" aria-label="Modèle" /></Field>
      <Field label="Description courte" full><input value={e.summary || ''} onChange={(x) => setPart('summary', x.target.value)} placeholder="ex. Micro dynamique Switch" aria-label="Description courte" /></Field>
      <datalist id="fab-brands">{Array.from(new Set(all.map((a) => a.brand).filter(Boolean))).sort().map((b) => <option key={b} value={b} />)}</datalist>
      <Field label={nameAuto ? 'Désignation * (composée automatiquement)' : 'Désignation *'} full>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input required value={e.name} onChange={(x) => { set('name', x.target.value); setNameAuto(x.target.value === composeName(e.brand, e.model, e.summary)); }} aria-label="Désignation" />
          {!nameAuto && (e.brand || e.model || e.summary) && <button type="button" className="ghost small" style={{ whiteSpace: 'nowrap' }} onClick={() => { set('name', composeName(e.brand, e.model, e.summary)); setNameAuto(true); }} title="Marque modèle (description)">Recomposer</button>}
          {!e.brand && !e.model && !e.summary && e.name.trim() && <button type="button" className="ghost small" style={{ whiteSpace: 'nowrap' }} title="Remplit marque, modèle et description à partir de la désignation (à vérifier)" onClick={() => {
            const p = splitName(e.name, all.map((a) => a.brand || ''));
            setE({ ...e, brand: p.brand || undefined, model: p.model || undefined, summary: p.summary || undefined, name: composeName(p.brand, p.model, p.summary) || e.name });
            setNameAuto(true);
          }}>Découper</button>}
        </div>
      </Field>
      <EquipmentLookup e={e} all={all} onFill={(v) => setE(v)} />
      <Field label="Code (automatique : dépôt-catégorie-numéro)">
        <input value={e.code || ''} onChange={(x) => { set('code', x.target.value); setCodeAuto(!x.target.value); }}
          placeholder={codeAuto ? `auto : ${newArticleCode({ ...e, categoryId: newCat.trim() ? '__new' : e.categoryId }, settings, previewCats, all)}` : ''} />
      </Field>
      <Field label="Code-barres / QR"><input value={e.barcode || ''} onChange={(x) => set('barcode', x.target.value)} /></Field>
      <Field label="Autres codes reconnus au scan (alias)" full>
        <TagInput value={e.extraCodes || []} onChange={(t) => set('extraCodes', t.length ? t : undefined)} />
        <small className="muted">Ex. ancien code-barres, référence fournisseur, QR d'un autre système : le scan de l'un d'eux retrouve cet article.</small>
      </Field>
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
      {lockPrices
        ? <Field label={e.kind === 'vente' ? 'Prix de vente unitaire HT (€)' : 'Prix location / jour HT (€)'}><span className="muted">réservé à l'administrateur — valeur actuelle : {money(e.dailyPrice)} €</span></Field>
        : <Field label={e.kind === 'vente' ? 'Prix de vente unitaire HT (€)' : 'Prix location / jour HT (€)'}><NumInput value={e.dailyPrice} onChange={(n) => set('dailyPrice', n)} /></Field>}
      {e.kind === 'vente' && (lockPrices
        ? <Field label="Prix d'achat unitaire HT (€)"><span className="muted">réservé à l'administrateur</span></Field>
        : <Field label="Prix d'achat unitaire HT (€)"><NumInput value={e.costPrice || 0} onChange={(n) => set('costPrice', n)} /></Field>)}
      <Field label="Taux de TVA spécifique de l'article (%) — vide = taux du client / projet"><NumInput value={e.vatRate ?? NaN} placeholder={String(settings.vatRate)} onChange={(n) => set('vatRate', isNaN(n) ? undefined : n)} /></Field>
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
              <span className="chosen-name">{nameOf(k.equipmentId)}</span>
              <button type="button" className="ghost" onClick={() => set('kitItems', e.kitItems.filter((_, j) => j !== i))}><Icon name="x" /></button>
            </div>
          ))}
          <div>
            <button type="button" className="secondary small" disabled={!all.length} onClick={() => setChoosing('kit')}>+ Composants…</button>
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
        <span>Accessoires (par unité de cet article)</span>
        {(e.accessories || []).map((a, i) => {
          const upd = (patch: Partial<typeof a>) => set('accessories', (e.accessories || []).map((y, j) => (j === i ? { ...y, ...patch } : y)));
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <NumInput className="w-qty" value={a.qty} step="1" min={1} onChange={(n) => upd({ qty: n })} />
              <span className="chosen-name">{nameOf(a.equipmentId)}{all.find((o) => o.id === a.equipmentId)?.accessoryOnly ? <span className="muted"> (hors inventaire)</span> : null}</span>
              <label className="check-row" style={{ whiteSpace: 'nowrap' }} title="Coché = ajouté d'office avec l'article (ligne enfant automatique). Décoché = accessoire facultatif : proposé dans le sélecteur, ajouté seulement s'il est coché."><input type="checkbox" checked={!a.optional} onChange={(x) => upd({ optional: x.target.checked ? undefined : true })} aria-label={`Ajout automatique : ${nameOf(a.equipmentId)}`} /> auto</label>
              <label className="check-row" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={a.free} onChange={(x) => upd({ free: x.target.checked })} /> gratuit</label>
              <button type="button" className="ghost" onClick={() => set('accessories', (e.accessories || []).filter((_, j) => j !== i))}><Icon name="x" /></button>
            </div>
          );
        })}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button type="button" className="secondary small" disabled={!all.some((o) => o.id !== e.id)} onClick={() => setChoosing('acc')}>+ Accessoire existant…</button>
          <button type="button" className="secondary small" onClick={async () => {
            const name = prompt('Nom du nouvel élément d\'accessoire (ex. Chargeur 65 W, Dock USB-C) :')?.trim();
            if (!name) return;
            // élément hors inventaire : pas de stock ni de disponibilité, il suit son article
            const acc = await save(db.equipment, { name, accessoryOnly: true, quantity: 0, dailyPrice: 0, isKit: false, kitItems: [], categoryId: e.categoryId });
            set('accessories', [...(e.accessories || []), { equipmentId: acc.id, qty: 1, free: true }]);
          }}>+ Nouvel élément (hors inventaire)</button>
        </div>
        <small className="muted">« auto » = ajouté d'office avec l'article. Décoché = accessoire facultatif, proposé mais jamais ajouté sans être coché. Un élément hors inventaire (chargeur, dock, housse…) n'apparaît ni dans le catalogue ni dans l'inventaire : il se coche à la sortie et au retour.</small>
      </div>
      <div className="field full">
        <span>Articles de remplacement (proposés en cas de manque)</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {(e.alternatives || []).map((id) => (
            <span key={id} className="badge">{all.find((a) => a.id === id)?.name || '?'} <button type="button" className="ghost small" onClick={() => set('alternatives', (e.alternatives || []).filter((x) => x !== id))}><Icon name="x" /></button></span>
          ))}
          <button type="button" className="secondary small" onClick={() => setChoosing('alt')}>+ Ajouter…</button>
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
      {choosing && (
        <EquipmentChooser
          title={choosing === 'kit' ? 'Composants du kit' : choosing === 'acc' ? 'Accessoires ajoutés automatiquement' : 'Articles de remplacement'}
          equipment={all} withQty={choosing !== 'alt'} includeAccessoryOnly={choosing === 'acc'}
          exclude={[...(e.id ? [e.id] : []), ...(choosing === 'alt' ? e.alternatives || [] : [])]}
          onClose={() => setChoosing('')}
          onConfirm={(picked) => {
            if (choosing === 'kit') {
              const items = [...e.kitItems];
              for (const p of picked) { const k = items.find((x) => x.equipmentId === p.equipmentId); if (k) k.qty += p.qty; else items.push({ equipmentId: p.equipmentId, qty: p.qty }); }
              set('kitItems', items.map((x) => ({ ...x })));
            } else if (choosing === 'acc') {
              const acc = [...(e.accessories || [])];
              for (const p of picked) { const a = acc.find((x) => x.equipmentId === p.equipmentId); if (a) a.qty += p.qty; else acc.push({ equipmentId: p.equipmentId, qty: p.qty, free: true }); }
              set('accessories', acc.map((x) => ({ ...x })));
            } else set('alternatives', [...(e.alternatives || []), ...picked.map((p) => p.equipmentId)]);
          }} />
      )}
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
  const me = useUser();
  const { equipment, res, depots } = useAvailability();
  const [depot, setDepot] = useState('');
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const [q, setQ] = useState(() => new URLSearchParams(window.location.hash.split('?')[1] || '').get('q') || '');
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
  /** contenu des kits affiché sous chaque kit (mémorisé sur l'appareil) ; kits repliés un par un */
  const [kitContents, setKitContents] = useState(() => { try { return localStorage.getItem('fab.materiel.kits') !== '0'; } catch { return true; } });
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleKitContents = (on: boolean) => { setKitContents(on); setFolded(new Set()); try { localStorage.setItem('fab.materiel.kits', on ? '1' : '0'); } catch { /* stockage indisponible */ } };
  const allTags = Array.from(new Set(equipment.flatMap((e) => e.tags || []))).sort();
  const filtered = equipment.filter((e) =>
    !!e.archived === showArchived &&
    !!e.accessoryOnly === showAcc &&
    inCategory(cats, e.categoryId, cat) &&
    (!tag || e.tags?.includes(tag)) &&
    inDepot(e, depot, depots, res) &&
    [e.name, e.brand, e.model, e.summary, e.code, e.barcode, ...(e.tags || [])].join(' ').toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => { const n = new Set(selected); if (n.has(id)) n.delete(id); else n.add(id); setSelected(n); };

  const csv = () => exportCsv('materiel.csv', ['Désignation', 'Marque', 'Modèle', 'Description courte', 'Référence', 'Catégorie', 'Type', 'Stock', 'Prix HT', "Valeur de remplacement", 'Poids', 'Code-barres', 'Emplacement', 'Étiquettes', 'Archivé'],
    filtered.map((e) => [e.name, e.brand, e.model, e.summary, e.code, e.categoryId ? catName.get(e.categoryId) : '', e.isKit ? 'kit' : e.kind || 'location', e.quantity, e.dailyPrice, e.replacementValue, e.weight, e.barcode, e.location, (e.tags || []).join(', '), e.archived ? 'oui' : '']));

  return (
    <>
      <PageHead title="Matériel">
        <CsvButton onClick={csv} />
        <button className="secondary" onClick={() => nav('/etiquettes')}>Étiquettes QR</button>
        <button className="secondary" onClick={() => nav('/inventaire')}>Inventaire</button>
        <button className="secondary" onClick={() => setShowCats(true)}>Catégories</button>
        {canEditEquipment(me) && <button onClick={() => setCreating(true)}>+ Nouvel article</button>}
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Rechercher (nom, réf, code-barres, étiquette)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Toutes catégories</option>
            <CategoryOptions cats={cats} filter />
          </select>
          {depots.length > 1 && (
            <select value={depot} onChange={(e) => setDepot(e.target.value)} aria-label="Filtrer par dépôt">
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
          <label className="check-row" title="Les éléments de chaque kit, avec leur quantité, sous le kit"><input type="checkbox" checked={kitContents} onChange={(x) => toggleKitContents(x.target.checked)} /> Contenu des kits</label>
          <label className="check-row" title="Chargeurs, docks… qui n'existent que comme accessoires d'autres articles"><input type="checkbox" checked={showAcc} onChange={(x) => setShowAcc(x.target.checked)} /> Éléments hors inventaire</label>
          <span style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <span className="muted">Dispo du</span>
            <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="muted">au</span>
            <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
          </span>
        </div>
        {selected.size > 0 && (
          <div className="info bulk-bar">
            <strong>{selected.size} article(s) sélectionné(s)</strong>
            {canEditPrices(me) && <button className="small" onClick={() => setBulk(true)}>Modifier en groupe…</button>}
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
                  const kit = e.isKit && e.kitItems.length ? kitBreakdown(e, equipment, res, from, to, depot || undefined) : null;
                  const open = !!kit && kitContents && !folded.has(e.id);
                  return (
                    <Fragment key={e.id}>
                    <tr className={'click' + (kit ? ' kit-row' : '')} onClick={() => nav('/materiel/' + e.id)}>
                      <td onClick={(x) => x.stopPropagation()}><input type="checkbox" aria-label={`Sélectionner ${e.name}`} checked={selected.has(e.id)} onChange={() => toggle(e.id)} /></td>
                      <td>{kit && kitContents && (
                        <button type="button" className="ghost small kit-fold" aria-expanded={open} aria-label={`${open ? 'Replier' : 'Déplier'} le contenu de ${e.name}`}
                          onClick={(x) => { x.stopPropagation(); setFolded((f) => { const n = new Set(f); if (n.has(e.id)) n.delete(e.id); else n.add(e.id); return n; }); }}>{open ? '▾' : '▸'}</button>
                      )}{e.photo && <img src={e.photo} alt="" className="thumb" />}<strong>{e.name}</strong> {e.isKit && <span className="badge">Kit · {e.kitItems.reduce((a, k) => a + k.qty, 0)} élément(s)</span>} {e.kind === 'vente' && <span className="badge">vente</span>} {e.trackSerials && <span className="badge">n° série</span>} <Tags tags={e.tags} /></td>
                      <td>{e.code}</td>
                      <td>{e.categoryId ? catName.get(e.categoryId) : ''}</td>
                      <td className="n" title={e._stock ? depots.map((dp) => `${dp.name} : ${stockAt(e, dp.id, res)}`).join('\n') : undefined}>{kit ? <span title="Kits complets possibles avec le stock des éléments">{kit.kitsStock} kit{kit.kitsStock > 1 ? 's' : ''}</span> : e.isKit || e.accessoryOnly ? '—' : depot ? stockAt(e, depot, res) : e.quantity}</td>
                      <td className="n">{e.accessoryOnly ? <span className="muted">hors inventaire</span> : <span className={'avail ' + (av > 0 ? 'ok' : 'ko')}>{av}</span>}</td>
                      <td className="n">{money(e.dailyPrice)}{e.kind === 'vente' ? ' /pce' : ''}</td>
                    </tr>
                    {open && kit!.rows.map((r) => (
                      <tr key={e.id + '>' + r.equipment.id} className={'click kit-child' + (r.limiting ? ' limiting' : '')} onClick={() => nav('/materiel/' + r.equipment.id)}>
                        <td />
                        <td><span className="kit-qty">{r.perKit} ×</span> {r.equipment.name}{r.limiting && <span className="badge st-option" title="C'est cet élément qui limite le nombre de kits disponibles">limite le kit</span>}</td>
                        <td className="muted">{r.equipment.code}</td>
                        <td className="muted">dans le kit</td>
                        <td className="n" title={`${r.stock} en stock → ${r.kitsStock} kit(s)`}>{r.stock} <span className="muted">→ {r.kitsStock} kit{r.kitsStock > 1 ? 's' : ''}</span></td>
                        <td className="n"><span className={'avail ' + (r.kitsAvail > 0 ? 'ok' : 'ko')} title={`${r.avail} disponible(s) sur la période → ${r.kitsAvail} kit(s)`}>{r.avail}</span> <span className="muted">→ {r.kitsAvail}</span></td>
                        <td />
                      </tr>
                    ))}
                    </Fragment>
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

/** une ligne de la modification groupée : case « modifier » (cochée dès qu'on change la valeur), libellé, contrôle */
function BulkRow({ label, changed, mixed, onToggle, children, full }: { label: string; changed: boolean; mixed: boolean; onToggle: (on: boolean) => void; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={'field bulk-field' + (full ? ' full' : '') + (changed ? ' changed' : '')}>
      <label className="check-row bulk-head">
        <input type="checkbox" checked={changed} aria-label={`Modifier : ${label}`} onChange={(x) => onToggle(x.target.checked)} />
        <span>{label}</span>
        {mixed && <span className="muted"> · valeurs différentes</span>}
      </label>
      {children}
    </div>
  );
}

type BulkKey = 'brand' | 'summary' | 'categoryId' | 'homeDepotId' | 'kind' | 'dailyPrice' | 'costPrice' | 'replacementValue' | 'weight' | 'inspectionMonths' | 'location' | 'notes' | 'photo' | 'contents' | 'archived';

/**
 * Modification groupée : chaque information commune aux articles sélectionnés est pré-remplie
 * (« valeurs différentes » sinon) ; seules les informations modifiées (cochées) sont appliquées.
 * En plus : variation des prix en %, ajout / retrait d'étiquettes, champs personnalisés.
 */
function BulkEdit({ ids, onClose }: { ids: string[]; onClose: (done: boolean) => void }) {
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const items = (useLiveQuery(() => db.equipment.bulkGet(ids), [ids.join()]) || []).filter(Boolean) as Equipment[];
  const depots = useSettings().depots || [];
  const customFields = (useSettings().customFields || []).filter((f) => f.entity === 'materiel');
  const [vals, setVals] = useState<Partial<Record<BulkKey, unknown>>>({});
  const [on, setOn] = useState<Set<BulkKey>>(new Set());
  const [custom, setCustom] = useState<Record<string, string | number | boolean | undefined>>({});
  const [customOn, setCustomOn] = useState<Set<string>>(new Set());
  const [pct, setPct] = useState(0);
  const [round, setRound] = useState(true);
  const [addTags, setAddTags] = useState<string[]>([]);
  const [removeTags, setRemoveTags] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const norm = (k: BulkKey, e: Equipment): unknown => {
    const v = (e as unknown as Record<string, unknown>)[k];
    if (k === 'kind') return v || 'location';
    if (k === 'homeDepotId') return v || depots[0]?.id;
    if (k === 'archived') return !!v;
    if (k === 'contents') return (v as Equipment['contents'])?.length ? v : [];
    if (typeof v === 'undefined' && ['costPrice', 'replacementValue', 'weight', 'inspectionMonths'].includes(k)) return 0;
    return v ?? '';
  };
  /** valeur commune à tous les articles (undefined + mixed si elles diffèrent) */
  const common = (k: BulkKey) => {
    const l = items.map((e) => norm(k, e));
    const mixed = l.some((x) => JSON.stringify(x) !== JSON.stringify(l[0]));
    return { value: mixed ? undefined : l[0], mixed };
  };
  const get = (k: BulkKey) => (on.has(k) ? { value: vals[k], mixed: false } : common(k));
  const set = (k: BulkKey, v: unknown) => { setVals((x) => ({ ...x, [k]: v })); setOn((x) => new Set(x).add(k)); };
  const reset = (k: BulkKey) => setOn((x) => { const n = new Set(x); n.delete(k); return n; });
  const tagsInSel = Array.from(new Set(items.flatMap((e) => e.tags || []))).sort();
  const num = (k: BulkKey) => { const g = get(k); return g.mixed ? NaN : Number(g.value) || 0; };
  const str = (k: BulkKey) => { const g = get(k); return g.mixed ? '' : String(g.value ?? ''); };

  const rowProps = (k: BulkKey) => ({ changed: on.has(k), mixed: !on.has(k) && common(k).mixed, onToggle: (c: boolean) => (c ? set(k, get(k).mixed ? norm(k, items[0]) : get(k).value) : reset(k)) });
  const changes = on.size + customOn.size + (pct ? 1 : 0) + addTags.length + removeTags.length;

  return (
    <Modal title={`Modifier ${ids.length} article(s)`} onClose={() => onClose(false)} wide>
      <form className="form" onSubmit={async (ev) => {
        ev.preventDefault();
        let n = 0;
        for (const id of ids) {
          const e = await db.equipment.get(id);
          if (!e) continue;
          const next: Equipment = { ...e };
          for (const k of on) {
            const v = vals[k];
            if (k === 'categoryId') next.categoryId = (v as string) || undefined;
            else if (k === 'location' || k === 'notes' || k === 'brand' || k === 'summary') (next as unknown as Record<string, unknown>)[k] = (v as string) || undefined;
            else if (k === 'contents') next.contents = ((v as Equipment['contents']) || []).filter((c) => c.name.trim());
            else (next as unknown as Record<string, unknown>)[k] = v;
          }
          // désignation composée (marque modèle (description)) : recomposée avec la nouvelle marque / description
          if ((on.has('brand') || on.has('summary')) && e.name === composeName(e.brand, e.model, e.summary)) next.name = composeName(next.brand, next.model, next.summary) || e.name;
          if (pct) { const price = next.dailyPrice * (1 + pct / 100); next.dailyPrice = round ? Math.round(price * 2) / 2 : Math.round(price * 100) / 100; }
          if (addTags.length || removeTags.length) next.tags = Array.from(new Set([...(next.tags || []), ...addTags])).filter((t) => !removeTags.includes(t));
          if (customOn.size) { const c = { ...(next.custom || {}) }; for (const f of customOn) c[f] = custom[f]; next.custom = c; }
          await save(db.equipment, next);
          n++;
        }
        setMsg(`${n} article(s) mis à jour.`);
        setTimeout(() => onClose(true), 700);
      }}>
        <p className="muted field full" style={{ margin: 0 }}>Les informations identiques pour les {ids.length} articles sont pré-remplies. Seules les informations cochées (modifiées) sont appliquées ; le reste ne change pas.</p>
        <BulkRow {...rowProps('brand')} label="Marque"><input value={str('brand')} placeholder={common('brand').mixed ? 'valeurs différentes' : 'ex. Shure'} onChange={(e) => set('brand', e.target.value)} aria-label="Marque" /></BulkRow>
        <BulkRow {...rowProps('summary')} label="Description courte"><input value={str('summary')} placeholder={common('summary').mixed ? 'valeurs différentes' : 'ex. Micro dynamique'} onChange={(e) => set('summary', e.target.value)} aria-label="Description courte" /></BulkRow>
        <BulkRow {...rowProps('categoryId')} label="Catégorie">
          <select value={str('categoryId')} onChange={(e) => set('categoryId', e.target.value)} aria-label="Catégorie">
            {common('categoryId').mixed && !on.has('categoryId') && <option value="">— valeurs différentes —</option>}
            <option value="">— aucune —</option>
            <CategoryOptions cats={cats} />
          </select>
        </BulkRow>
        {depots.length > 1 && (
          <BulkRow {...rowProps('homeDepotId')} label="Dépôt de base">
            <select value={str('homeDepotId')} onChange={(e) => set('homeDepotId', e.target.value)} aria-label="Dépôt de base">
              {common('homeDepotId').mixed && !on.has('homeDepotId') && <option value="">— valeurs différentes —</option>}
              {depots.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </BulkRow>
        )}
        <BulkRow {...rowProps('kind')} label="Type">
          <select value={str('kind')} onChange={(e) => set('kind', e.target.value)} aria-label="Type">
            {common('kind').mixed && !on.has('kind') && <option value="">— valeurs différentes —</option>}
            <option value="location">Location (facturé par jour)</option>
            <option value="vente">Consommable / vente (à la pièce)</option>
          </select>
        </BulkRow>
        <BulkRow {...rowProps('dailyPrice')} label="Prix location / jour HT (€)"><NumInput value={num('dailyPrice')} placeholder="valeurs différentes" onChange={(n) => set('dailyPrice', n)} aria-label="Prix HT" /></BulkRow>
        <Field label="Variation des prix (%)"><NumInput step="any" value={pct} onChange={(n) => setPct(n)} /></Field>
        <Field label=" "><label className="check-row"><input type="checkbox" checked={round} onChange={(e) => setRound(e.target.checked)} /> Arrondir aux 0,50 €</label></Field>
        <BulkRow {...rowProps('costPrice')} label="Prix d'achat unitaire HT (€)"><NumInput value={num('costPrice')} placeholder="valeurs différentes" onChange={(n) => set('costPrice', n)} aria-label="Prix d'achat" /></BulkRow>
        <BulkRow {...rowProps('replacementValue')} label="Valeur de remplacement (€)"><NumInput value={num('replacementValue')} placeholder="valeurs différentes" onChange={(n) => set('replacementValue', n)} aria-label="Valeur de remplacement" /></BulkRow>
        <BulkRow {...rowProps('weight')} label="Poids unitaire (kg)"><NumInput value={num('weight')} placeholder="valeurs différentes" onChange={(n) => set('weight', n)} aria-label="Poids" /></BulkRow>
        <BulkRow {...rowProps('inspectionMonths')} label="Contrôle périodique (mois, 0 = aucun)"><NumInput value={num('inspectionMonths')} step="1" min={0} placeholder="valeurs différentes" onChange={(n) => set('inspectionMonths', n)} aria-label="Contrôle périodique" /></BulkRow>
        <BulkRow {...rowProps('location')} label="Emplacement dépôt"><input value={str('location')} placeholder={common('location').mixed ? 'valeurs différentes' : 'ex. Rack A3'} onChange={(e) => set('location', e.target.value)} aria-label="Emplacement" /></BulkRow>
        <BulkRow {...rowProps('archived')} label="Archivé">
          <select value={get('archived').mixed ? '' : get('archived').value ? 'oui' : 'non'} onChange={(e) => set('archived', e.target.value === 'oui')} aria-label="Archivage">
            {common('archived').mixed && !on.has('archived') && <option value="">— valeurs différentes —</option>}
            <option value="non">Non (proposé dans les projets)</option><option value="oui">Oui (archivé)</option>
          </select>
        </BulkRow>
        <Field label="Ajouter des étiquettes"><TagInput value={addTags} onChange={setAddTags} suggestions={tagsInSel} /></Field>
        {tagsInSel.length > 0 && (
          <div className="field">
            <span>Retirer des étiquettes</span>
            <div className="chips">
              {tagsInSel.map((t) => (
                <button type="button" key={t} className={'chip' + (removeTags.includes(t) ? ' on' : '')} aria-pressed={removeTags.includes(t)}
                  onClick={() => setRemoveTags((x) => (x.includes(t) ? x.filter((y) => y !== t) : [...x, t]))}>
                  {t} ({items.filter((e) => e.tags?.includes(t)).length})
                </button>
              ))}
            </div>
          </div>
        )}
        <BulkRow {...rowProps('photo')} label="Photo">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {!!get('photo').value && <img src={String(get('photo').value)} alt="" style={{ height: 48, borderRadius: 6 }} />}
            <input type="file" accept="image/*" aria-label="Photo" onChange={async (x) => { const f = x.target.files?.[0]; if (f) set('photo', await resizeImage(f)); }} />
            {(!!get('photo').value || common('photo').mixed) && <button type="button" className="ghost small" onClick={() => set('photo', undefined)}>Retirer la photo</button>}
          </div>
        </BulkRow>
        <BulkRow {...rowProps('contents')} label="Contenu fourni avec l'article" full>
          {(() => {
            const list = (get('contents').mixed ? [] : (get('contents').value as Equipment['contents']) || []);
            const upd = (l: NonNullable<Equipment['contents']>) => set('contents', l);
            return (
              <>
                {common('contents').mixed && !on.has('contents') && <span className="muted">Le contenu diffère selon l'article : en modifier un remplace le contenu de tous.</span>}
                {list.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                    <NumInput className="w-qty" value={c.qty} onChange={(n) => upd(list.map((y, j) => (j === i ? { ...y, qty: n || 1 } : y)))} aria-label="Quantité du contenu" />
                    <input value={c.name} onChange={(x) => upd(list.map((y, j) => (j === i ? { ...y, name: x.target.value } : y)))} placeholder="ex. Chargeur 65 W" aria-label="Élément du contenu" />
                    <button type="button" className="ghost" onClick={() => upd(list.filter((_, j) => j !== i))} aria-label="Retirer"><Icon name="x" /></button>
                  </div>
                ))}
                <div><button type="button" className="secondary small" onClick={() => upd([...list, { name: '', qty: 1 }])}>+ Élément du contenu</button></div>
              </>
            );
          })()}
        </BulkRow>
        <BulkRow {...rowProps('notes')} label="Notes" full><textarea value={str('notes')} placeholder={common('notes').mixed ? 'valeurs différentes' : ''} onChange={(e) => set('notes', e.target.value)} aria-label="Notes" /></BulkRow>
        {customFields.map((f) => {
          const l = items.map((e) => e.custom?.[f.id]);
          const mixed = !customOn.has(f.id) && l.some((x) => x !== l[0]);
          const v = customOn.has(f.id) ? custom[f.id] : mixed ? undefined : l[0];
          const setC = (x: string | number | boolean | undefined) => { setCustom((c) => ({ ...c, [f.id]: x })); setCustomOn((s) => new Set(s).add(f.id)); };
          return (
            <div key={f.id} className={'field bulk-field' + (customOn.has(f.id) ? ' changed' : '')}>
              <label className="check-row bulk-head">
                <input type="checkbox" checked={customOn.has(f.id)} aria-label={`Modifier : ${f.label}`} onChange={(x) => (x.target.checked ? setC(v) : setCustomOn((s) => { const n = new Set(s); n.delete(f.id); return n; }))} />
                <span>{f.label}</span>{mixed && <span className="muted"> · valeurs différentes</span>}
              </label>
              {f.type === 'oui_non' ? <label className="check-row"><input type="checkbox" checked={!!v} onChange={(e) => setC(e.target.checked)} /> Oui</label>
                : f.type === 'nombre' ? <NumInput value={typeof v === 'number' ? v : NaN} placeholder={mixed ? 'valeurs différentes' : ''} onChange={(n) => setC(n)} />
                : f.type === 'liste' ? <select value={(v as string) || ''} onChange={(e) => setC(e.target.value || undefined)}><option value="">{mixed ? '— valeurs différentes —' : '—'}</option>{(f.choices || []).map((c) => <option key={c}>{c}</option>)}</select>
                : f.type === 'date' ? <input type="date" value={(v as string) || ''} onChange={(e) => setC(e.target.value || undefined)} />
                : <input value={(v as string) || ''} placeholder={mixed ? 'valeurs différentes' : ''} onChange={(e) => setC(e.target.value || undefined)} />}
            </div>
          );
        })}
        {msg && <p className="avail ok field full">{msg}</p>}
        <div className="form-actions">
          <span className="muted" style={{ marginRight: 'auto', alignSelf: 'center' }}>{changes ? `${changes} modification(s) à appliquer` : 'Aucune modification'}</span>
          <button type="button" className="secondary" onClick={() => onClose(false)}>Annuler</button>
          <button type="submit" disabled={!changes || !items.length}>Appliquer à {ids.length} article(s)</button>
        </div>
      </form>
    </Modal>
  );
}

const FIELD_LABELS: Record<string, string> = {
  brand: 'marque', summary: 'description', weight: 'poids', replacementValue: 'valeur de remplacement', dailyPrice: 'prix / jour',
  costPrice: 'coût d’achat', inspectionMonths: 'contrôle périodique', categoryId: 'catégorie', photo: 'photo', notes: 'notes', contents: 'contenu fourni',
};

/**
 * Compléter un article : reprendre les infos d'un article semblable du catalogue (même marque et modèle),
 * pour les champs encore vides, ou ouvrir la fiche technique sur le web (poids, dimensions, consommation).
 */
function EquipmentLookup({ e, all, onFill }: { e: Draft; all: Equipment[]; onFill: (e: Draft) => void }) {
  const [msg, setMsg] = useState('');
  if (!(e.model || e.name)?.trim()) return null;
  const src = similarEquipment(e, all)[0];
  const preview = src ? fillFromSimilar(e, src).filled : [];
  return (
    <div className="field full lookup">
      <div className="lookup-actions">
        {src && preview.length > 0 && (
          <button type="button" className="secondary small" title={`Reprend ${preview.map((k) => FIELD_LABELS[k] || k).join(', ')} — seulement les champs vides`}
            onClick={() => { const r = fillFromSimilar(e, src); onFill(r.value); setMsg(`Repris de « ${src.name} » : ${r.filled.map((k) => FIELD_LABELS[k] || k).join(', ')}. À vérifier.`); }}>
            <Icon name="copy" />Reprendre de « {src.name} »
          </button>
        )}
        <a className="button-link secondary small" href={specSearchUrl(e)} target="_blank" rel="noreferrer" title="Recherche web : poids, dimensions, consommation (à reporter à la main)">
          <Icon name="search" />Chercher la fiche technique
        </a>
      </div>
      {msg && <p className="avail ok" style={{ margin: '4px 0 0' }}>{msg}</p>}
    </div>
  );
}
