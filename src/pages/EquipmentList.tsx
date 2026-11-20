import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead, useSettings } from '../components/ui';
import { db } from '../db';
import type { Equipment } from '../types';
import { useAvailability } from '../data';
import { resizeImage } from '../image';
import { availableQty, money, save, stockIn, toLocalInput } from '../utils';

type Draft = Omit<Equipment, 'id' | 'createdAt' | 'updatedAt'> & Partial<Equipment>;
const blank = (): Draft => ({ name: '', quantity: 1, dailyPrice: 0, isKit: false, kitItems: [] });

export function EquipmentForm({ initial, onDone }: { initial?: Draft; onDone: () => void }) {
  const [e, setE] = useState<Draft>(initial || blank());
  const [newCat, setNewCat] = useState('');
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const depots = useSettings().depots || [];
  const all = useLiveQuery(() => db.equipment.orderBy('name').toArray(), []) || [];
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setE({ ...e, [k]: v });

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    let categoryId = e.categoryId;
    if (newCat.trim()) categoryId = (await save(db.categories, { name: newCat.trim() })).id;
    await save(db.equipment, { ...e, categoryId } as Equipment);
    onDone();
  };

  return (
    <form className="form" onSubmit={submit}>
      <Field label="Désignation *" full><input required autoFocus value={e.name} onChange={(x) => set('name', x.target.value)} /></Field>
      <Field label="Référence / code"><input value={e.code || ''} onChange={(x) => set('code', x.target.value)} /></Field>
      <Field label="Code-barres / QR"><input value={e.barcode || ''} onChange={(x) => set('barcode', x.target.value)} /></Field>
      <Field label="Catégorie">
        <select value={e.categoryId || ''} onChange={(x) => set('categoryId', x.target.value || undefined)}>
          <option value="">—</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Field label="…ou nouvelle catégorie"><input value={newCat} onChange={(x) => setNewCat(x.target.value)} placeholder="ex. Son, Lumière, Vidéo" /></Field>
      <Field label="Type">
        <select value={e.kind || 'location'} onChange={(x) => set('kind', x.target.value as Draft['kind'])}>
          <option value="location">Location (facturé par jour, revient au dépôt)</option>
          <option value="vente">Consommable / vente (facturé à la pièce)</option>
        </select>
      </Field>
      <Field label=" ">
        <label className="check-row"><input type="checkbox" checked={!!e.trackSerials} onChange={(x) => set('trackSerials', x.target.checked)} /> Suivi par numéro de série</label>
      </Field>
      {e.trackSerials
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
              <button type="button" className="ghost" onClick={() => set('kitItems', e.kitItems.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <div>
            <button type="button" className="secondary small" disabled={!all.length}
              onClick={() => set('kitItems', [...e.kitItems, { equipmentId: all.find((a) => a.id !== e.id)?.id || '', qty: 1 }])}>+ Composant</button>
          </div>
        </div>
      )}
      <div className="field full">
        <span>Accessoires ajoutés automatiquement (par unité de cet article)</span>
        {(e.accessories || []).map((a, i) => {
          const upd = (patch: Partial<typeof a>) => set('accessories', (e.accessories || []).map((y, j) => (j === i ? { ...y, ...patch } : y)));
          return (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
              <NumInput className="w-qty" value={a.qty} step="1" min={1} onChange={(n) => upd({ qty: n })} />
              <select value={a.equipmentId} onChange={(x) => upd({ equipmentId: x.target.value })}>
                {all.filter((o) => o.id !== e.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              <label className="check-row" style={{ whiteSpace: 'nowrap' }}><input type="checkbox" checked={a.free} onChange={(x) => upd({ free: x.target.checked })} /> gratuit</label>
              <button type="button" className="ghost" onClick={() => set('accessories', (e.accessories || []).filter((_, j) => j !== i))}>✕</button>
            </div>
          );
        })}
        <div>
          <button type="button" className="secondary small" disabled={all.length < 2 && !all.some((o) => o.id !== e.id)}
            onClick={() => set('accessories', [...(e.accessories || []), { equipmentId: all.find((o) => o.id !== e.id)?.id || '', qty: 1, free: true }])}>+ Accessoire</button>
        </div>
      </div>
      <div className="field full">
        <span>Articles de remplacement (proposés en cas de manque)</span>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          {(e.alternatives || []).map((id) => (
            <span key={id} className="badge">{all.find((a) => a.id === id)?.name || '?'} <button type="button" className="ghost small" onClick={() => set('alternatives', (e.alternatives || []).filter((x) => x !== id))}>✕</button></span>
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
      <Field label="Notes" full><textarea value={e.notes || ''} onChange={(x) => set('notes', x.target.value)} /></Field>
      <div className="form-actions">
        <button type="button" className="secondary" onClick={onDone}>Annuler</button>
        <button type="submit">Enregistrer</button>
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
  const [creating, setCreating] = useState(false);
  const now = new Date();
  const [from, setFrom] = useState(toLocalInput(now));
  const [to, setTo] = useState(toLocalInput(new Date(now.getTime() + 86400000)));

  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const [showArchived, setShowArchived] = useState(false);
  const filtered = equipment.filter((e) =>
    !!e.archived === showArchived &&
    (!cat || e.categoryId === cat) &&
    [e.name, e.code, e.barcode].join(' ').toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead title="Matériel">
        <button className="secondary" onClick={() => nav('/etiquettes')}>Étiquettes QR</button>
        <button className="secondary" onClick={() => nav('/inventaire')}>Inventaire</button>
        <button onClick={() => setCreating(true)}>+ Nouvel article</button>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Rechercher (nom, réf, code-barres)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Toutes catégories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {depots.length > 1 && (
            <select value={depot} onChange={(e) => setDepot(e.target.value)}>
              <option value="">Tous les dépôts</option>
              {depots.map((dp) => <option key={dp.id} value={dp.id}>{dp.name}</option>)}
            </select>
          )}
          <label className="check-row"><input type="checkbox" checked={showArchived} onChange={(x) => setShowArchived(x.target.checked)} /> Archivés</label>
          <span className="muted" style={{ alignSelf: 'center' }}>Dispo du</span>
          <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span className="muted" style={{ alignSelf: 'center' }}>au</span>
          <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        {filtered.length === 0 ? <Empty>Aucun article. Crée-en un ou importe ton catalogue (menu Import).</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Désignation</th><th>Réf.</th><th>Catégorie</th><th className="n">Stock</th><th className="n">Dispo période</th><th className="n">Prix/j HT</th></tr></thead>
              <tbody>
                {filtered.map((e) => {
                  const av = availableQty(e, equipment, res, from, to, undefined, depot || undefined);
                  return (
                    <tr key={e.id} className="click" onClick={() => nav('/materiel/' + e.id)}>
                      <td>{e.photo && <img src={e.photo} alt="" className="thumb" />}<strong>{e.name}</strong> {e.isKit && <span className="badge">Kit</span>} {e.kind === 'vente' && <span className="badge">vente</span>} {e.trackSerials && <span className="badge">n° série</span>}</td>
                      <td>{e.code}</td>
                      <td>{e.categoryId ? catName.get(e.categoryId) : ''}</td>
                      <td className="n" title={e._stock ? depots.map((dp) => `${dp.name} : ${e._stock?.[dp.id] || 0}`).join('\n') : undefined}>{e.isKit ? '—' : depot ? stockIn(e, depot) : e.quantity}</td>
                      <td className="n"><span className={'avail ' + (av > 0 ? 'ok' : 'ko')}>{av}</span></td>
                      <td className="n">{money(e.dailyPrice)}{e.kind === 'vente' ? ' /pce' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {creating && <Modal title="Nouvel article" onClose={() => setCreating(false)} wide><EquipmentForm onDone={() => setCreating(false)} /></Modal>}
    </>
  );
}
