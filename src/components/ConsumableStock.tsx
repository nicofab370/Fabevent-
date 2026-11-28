/**
 * Consommable : stock projeté (projets à venir, mouvements programmés), seuil critique, et mouvements à une date future
 * (livraison attendue « + », sortie prévue « − »). Le stock réel ne bouge qu'à la date du mouvement (appliqué au démarrage).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db';
import { consumableUses } from '../notify';
import { projectedStock } from '../stock';
import type { Equipment } from '../types';
import { fmtDate, parseNumber, save, uid } from '../utils';

export function ConsumableStock({ eq }: { eq: Equipment }) {
  const uses = useLiveQuery(() => consumableUses().then((m) => m.get(eq.id) || []), [eq.id, eq.updatedAt]) || [];
  const [date, setDate] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [delta, setDelta] = useState('');
  const [text, setText] = useState('');
  if (eq.kind !== 'vente') return null;
  const today = new Date().toISOString().slice(0, 10);
  const p = projectedStock(eq, today, uses);
  const planned = (eq.plannedStock || []).slice().sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div className="card">
      <h2>Stock du consommable</h2>
      <div className="stats">
        <div className="stat"><b>{p.now}</b><span>en stock</span></div>
        <div className="stat"><b>{uses.reduce((a, u) => a + u.qty, 0)}</b><span>prévus dans les projets</span></div>
        <div className="stat"><b style={{ color: p.min <= (eq.criticalStock || 0) ? 'var(--danger)' : undefined }}>{p.min}</b><span>au plus bas</span></div>
        <div className="stat"><b>{eq.criticalStock || '—'}</b><span>stock critique</span></div>
      </div>
      {p.reachDate && <p className="avail ko">Seuil atteint {p.reachDate <= today ? 'dès maintenant' : `le ${fmtDate(p.reachDate, false)}`} : à racheter.</p>}
      <h3>Mouvements programmés</h3>
      {planned.length ? (
        <table className="list no-sort"><tbody>
          {planned.map((m) => (
            <tr key={m.id}><td>{fmtDate(m.date, false)}</td><td className="num">{m.delta > 0 ? '+' : ''}{m.delta}</td><td>{m.text}</td>
              <td><button className="ghost small" onClick={() => save(db.equipment, { ...eq, plannedStock: planned.filter((x) => x.id !== m.id) })}>Retirer</button></td></tr>
          ))}
        </tbody></table>
      ) : <p className="muted">Aucun : programme une livraison attendue (+) ou une sortie prévue (−).</p>}
      <form className="toolbar" onSubmit={async (e) => {
        e.preventDefault();
        const n = parseNumber(delta);
        if (!n) return;
        await save(db.equipment, { ...eq, plannedStock: [...planned, { id: uid(), date, delta: n, text: text || (n > 0 ? 'Livraison' : 'Sortie') }] });
        setDelta(''); setText('');
      }}>
        <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} aria-label="Date du mouvement" />
        <input inputMode="decimal" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="+50 ou -10" aria-label="Quantité (+ ou −)" style={{ width: 110 }} />
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Motif (commande n°…)" aria-label="Motif" />
        <button type="submit" className="secondary small">Programmer</button>
      </form>
    </div>
  );
}

/** Applique au stock les mouvements programmés dont la date est passée (une seule fois chacun). */
export async function applyPlannedStock(today = new Date().toISOString().slice(0, 10)) {
  for (const e of await db.equipment.toArray()) {
    const due = (e.plannedStock || []).filter((m) => m.date.slice(0, 10) <= today);
    if (!due.length) continue;
    const delta = due.reduce((a, m) => a + m.delta, 0);
    await save(db.equipment, {
      ...e, quantity: Math.max(0, (e.quantity || 0) + delta),
      plannedStock: (e.plannedStock || []).filter((m) => m.date.slice(0, 10) > today),
      stockLog: [...(e.stockLog || []), ...due.map((m) => ({ at: new Date().toISOString(), delta: m.delta, text: `${m.text} (programmé le ${m.date})` }))],
    });
  }
}
