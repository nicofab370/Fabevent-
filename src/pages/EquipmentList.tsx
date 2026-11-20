import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead } from '../components/ui';
import { db } from '../db';
import type { Equipment } from '../types';
import { availableQty, buildReservations, money, save, toLocalInput } from '../utils';

type Draft = Omit<Equipment, 'id' | 'createdAt' | 'updatedAt'> & Partial<Equipment>;
const blank = (): Draft => ({ name: '', quantity: 1, dailyPrice: 0, isKit: false, kitItems: [] });

export function EquipmentForm({ initial, onDone }: { initial?: Draft; onDone: () => void }) {
  const [e, setE] = useState<Draft>(initial || blank());
  const [newCat, setNewCat] = useState('');
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
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
      <Field label="Quantité en stock"><NumInput value={e.quantity} onChange={(n) => set('quantity', n)} step="1" min={0} /></Field>
      <Field label="Prix location / jour HT (€)"><NumInput value={e.dailyPrice} onChange={(n) => set('dailyPrice', n)} /></Field>
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
  const equipment = useLiveQuery(() => db.equipment.orderBy('name').toArray(), []) || [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const lines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [creating, setCreating] = useState(false);
  const now = new Date();
  const [from, setFrom] = useState(toLocalInput(now));
  const [to, setTo] = useState(toLocalInput(new Date(now.getTime() + 86400000)));

  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const res = buildReservations(lines, subs, equipment);
  const filtered = equipment.filter((e) =>
    (!cat || e.categoryId === cat) &&
    [e.name, e.code, e.barcode].join(' ').toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHead title="Matériel">
        <button onClick={() => setCreating(true)}>+ Nouvel article</button>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Rechercher (nom, réf, code-barres)…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">Toutes catégories</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
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
                  const av = availableQty(e, equipment, res, from, to);
                  return (
                    <tr key={e.id} className="click" onClick={() => nav('/materiel/' + e.id)}>
                      <td><strong>{e.name}</strong> {e.isKit && <span className="badge">Kit</span>}</td>
                      <td>{e.code}</td>
                      <td>{e.categoryId ? catName.get(e.categoryId) : ''}</td>
                      <td className="n">{e.isKit ? '—' : e.quantity}</td>
                      <td className="n"><span className={'avail ' + (av > 0 ? 'ok' : 'ko')}>{av}</span></td>
                      <td className="n">{money(e.dailyPrice)}</td>
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
