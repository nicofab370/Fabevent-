/**
 * Bons de commande aux fournisseurs : depuis un projet (coûts supplémentaires, sous-locations) ou hors projet (achat).
 * Statuts : brouillon → à approuver → approuvé (droit « approuver ») → envoyé → terminé, ou refusé / annulé.
 * Le montant approuvé est retenu : si le bon dépasse ensuite ce montant, il repasse « à approuver ».
 * Un bon de commande ne se supprime pas (document financier) : on l'annule.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useUser } from '../auth';
import { Empty, Field, Modal, NumInput, PageHead } from '../components/ui';
import { Icon } from '../components/Icon';
import { db, nextSeriesNumber, getSettings } from '../db';
import { hasPerm } from '../roles';
import type { PurchaseOrder, PurchaseStatus } from '../types';
import { PURCHASE_LABELS } from '../types';
import { download, fmtDate, money, round2, save, uid } from '../utils';

export const poTotal = (po: Pick<PurchaseOrder, 'lines'>) => round2(po.lines.reduce((a, l) => a + l.qty * l.unitPrice, 0));

/** Numéro suivant : série « bon de commande » si elle existe, sinon BC-AAAA-NNN. */
export async function nextPoNumber(): Promise<string> {
  const s = await getSettings();
  const sr = s.numberSeries?.find((x) => x.types.includes('bon_commande'));
  if (sr) { const n = await nextSeriesNumber(sr.id); if (n) return n; }
  const key = `BC-${new Date().getFullYear()}`;
  const n = (s.counters[key] || 0) + 1;
  await db.settings.put({ ...s, counters: { ...s.counters, [key]: n } });
  return `${key}-${String(n).padStart(3, '0')}`;
}

/** Ajoute des lignes à un bon de commande du fournisseur (brouillon ou à approuver), ou en crée un. */
export async function addToPurchaseOrder(o: { supplierId?: string; supplierName?: string; projectId?: string; lines: PurchaseOrder['lines'] }): Promise<PurchaseOrder> {
  const open = (await db.purchaseOrders.toArray()).find((p) => ['brouillon', 'a_approuver'].includes(p.status) && p.projectId === o.projectId
    && ((o.supplierId && p.supplierId === o.supplierId) || (!o.supplierId && o.supplierName && p.supplierName === o.supplierName)));
  const at = new Date().toISOString();
  if (open) {
    const lines = [...open.lines, ...o.lines.filter((l) => !open.lines.some((x) => (l.costId && x.costId === l.costId) || (l.subrentalId && x.subrentalId === l.subrentalId)))];
    return save(db.purchaseOrders, { ...open, lines, history: [...(open.history || []), { at, event: 'lignes ajoutées' }] });
  }
  return save(db.purchaseOrders, { number: await nextPoNumber(), status: 'brouillon', ...o, history: [{ at, event: 'créé' }] } as PurchaseOrder);
}

function PoEditor({ po, onClose }: { po: PurchaseOrder; onClose: () => void }) {
  const me = useUser();
  const canApprove = hasPerm(me, 'approuver', !me || me.role === 'admin');
  const [d, setD] = useState(po);
  const suppliers = useLiveQuery(() => db.contacts.where('type').anyOf('fournisseur', 'soustraitant').sortBy('company'), []) || [];
  const projects = useLiveQuery(() => db.projects.orderBy('start').reverse().toArray(), []) || [];
  const total = poTotal(d);
  const over = d.approvedAmount != null && total > d.approvedAmount + 0.005;
  const at = () => new Date().toISOString();
  const setStatus = async (status: PurchaseStatus, extra: Partial<PurchaseOrder> = {}) => {
    const next = { ...d, ...extra, status, history: [...(d.history || []), { at: at(), event: PURCHASE_LABELS[status], by: me?.name }] };
    setD(next);
    await save(db.purchaseOrders, next);
  };
  const persist = async () => {
    // dépassement du montant approuvé : nouvelle approbation nécessaire
    const next = over && ['approuve', 'envoye'].includes(d.status) ? { ...d, status: 'a_approuver' as PurchaseStatus, history: [...(d.history || []), { at: at(), event: 'montant dépassé : nouvelle approbation demandée' }] } : d;
    await save(db.purchaseOrders, next);
    onClose();
  };
  const print = () => {
    const sup = suppliers.find((s) => s.id === d.supplierId);
    const rows = d.lines.map((l) => `<tr><td>${l.text}</td><td style="text-align:right">${l.qty}</td><td style="text-align:right">${money(l.unitPrice)}</td><td style="text-align:right">${money(l.qty * l.unitPrice)}</td></tr>`).join('');
    download(`${d.number}.html`, `<!doctype html><meta charset="utf-8"><title>${d.number}</title><body style="font:14px system-ui;max-width:780px;margin:30px auto"><h1>Bon de commande ${d.number}</h1><p>${sup?.company || d.supplierName || ''}<br>${fmtDate(d.createdAt, false)}${d.due ? ` · livraison le ${fmtDate(d.due, false)}` : ''}</p><table style="width:100%;border-collapse:collapse" border="1" cellpadding="6"><tr><th>Désignation</th><th>Qté</th><th>Prix HT</th><th>Total HT</th></tr>${rows}<tr><td colspan="3"><b>Total HT</b></td><td style="text-align:right"><b>${money(total)}</b></td></tr></table>${d.notes ? `<p>${d.notes}</p>` : ''}</body>`, 'text/html;charset=utf-8');
  };
  const editable = !['termine', 'annule', 'refuse'].includes(d.status);
  return (
    <Modal title={`Bon de commande ${d.number}`} onClose={onClose} wide>
      <p><span className="badge">{PURCHASE_LABELS[d.status]}</span>{d.approvedAmount != null && <span className="muted"> · approuvé pour {money(d.approvedAmount)}{d.approvedBy ? ` par ${d.approvedBy}` : ''}</span>}</p>
      {over && <div className="warn-banner">Le total ({money(total)}) dépasse le montant approuvé ({money(d.approvedAmount!)}) : une nouvelle approbation sera demandée.</div>}
      <div className="form">
        <Field label="Fournisseur">
          <select value={d.supplierId || ''} disabled={!editable} onChange={(e) => setD({ ...d, supplierId: e.target.value || undefined, supplierName: suppliers.find((s) => s.id === e.target.value)?.company || d.supplierName })}>
            <option value="">{d.supplierName || '—'}</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.company}</option>)}
          </select>
        </Field>
        <Field label="Projet (vide = achat hors projet)">
          <select value={d.projectId || ''} disabled={!editable} onChange={(e) => setD({ ...d, projectId: e.target.value || undefined })}>
            <option value="">—</option>
            {projects.filter((p) => !p.isTemplate).map((p) => <option key={p.id} value={p.id}>{p.number} {p.name}</option>)}
          </select>
        </Field>
        <Field label="Livraison attendue"><input type="date" value={d.due || ''} disabled={!editable} onChange={(e) => setD({ ...d, due: e.target.value || undefined })} /></Field>
      </div>
      <table className="list no-sort">
        <thead><tr><th>Désignation</th><th className="n">Qté</th><th className="n">Prix HT</th><th className="n">Total HT</th><th /></tr></thead>
        <tbody>
          {d.lines.map((l, i) => {
            const upd = (p: Partial<typeof l>) => setD({ ...d, lines: d.lines.map((x, j) => (j === i ? { ...x, ...p } : x)) });
            return (
              <tr key={l.id}>
                <td><input value={l.text} disabled={!editable} onChange={(e) => upd({ text: e.target.value })} aria-label="Désignation" /></td>
                <td className="n"><NumInput className="w-qty" value={l.qty} onChange={(n) => upd({ qty: n })} aria-label="Quantité" /></td>
                <td className="n"><NumInput className="w-price" value={l.unitPrice} onChange={(n) => upd({ unitPrice: n })} aria-label="Prix unitaire" /></td>
                <td className="n">{money(l.qty * l.unitPrice)}</td>
                <td>{editable && <button className="ghost" aria-label="Retirer la ligne" onClick={() => setD({ ...d, lines: d.lines.filter((_, j) => j !== i) })}><Icon name="x" /></button>}</td>
              </tr>
            );
          })}
          <tr className="total-row"><td colSpan={3}><strong>Total HT</strong></td><td className="n"><strong>{money(total)}</strong></td><td /></tr>
        </tbody>
      </table>
      {editable && <button className="secondary small" onClick={() => setD({ ...d, lines: [...d.lines, { id: uid(), text: '', qty: 1, unitPrice: 0 }] })}><Icon name="plus" />Ligne</button>}
      <Field label="Notes" full><textarea value={d.notes || ''} onChange={(e) => setD({ ...d, notes: e.target.value || undefined })} /></Field>
      <div className="toolbar" style={{ marginTop: 10 }}>
        {d.status === 'brouillon' && <button className="secondary" onClick={() => setStatus('a_approuver')}>Demander l'approbation</button>}
        {(d.status === 'a_approuver' || (d.status === 'brouillon' && canApprove)) && canApprove && <button onClick={() => setStatus('approuve', { approvedAmount: total, approvedBy: me?.name, approvedAt: at() })}>Approuver ({money(total)})</button>}
        {d.status === 'a_approuver' && canApprove && <button className="secondary" onClick={() => setStatus('refuse')}>Refuser</button>}
        {d.status === 'approuve' && !over && <button className="secondary" onClick={() => setStatus('envoye')}>Marquer envoyé</button>}
        {d.status === 'envoye' && <button className="secondary" onClick={() => setStatus('termine')}>Terminé (reçu)</button>}
        {editable && <button className="ghost" onClick={() => confirm('Annuler ce bon de commande ? Il reste dans la liste.') && setStatus('annule')}>Annuler le bon</button>}
        <button className="secondary" onClick={print} disabled={over}>Télécharger</button>
        <button style={{ marginLeft: 'auto' }} onClick={persist}>Enregistrer</button>
      </div>
      {(d.history || []).length > 0 && <details><summary>Historique</summary><ul>{[...d.history!].reverse().map((h, i) => <li key={i}><span className="muted">{fmtDate(h.at)}</span> {h.event}{h.by ? ` (${h.by})` : ''}</li>)}</ul></details>}
    </Modal>
  );
}

export default function PurchaseOrders() {
  const list = useLiveQuery(() => db.purchaseOrders.orderBy('number').reverse().toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<PurchaseOrder | null>(null);
  const shown = list.filter((p) => !status || p.status === status);
  return (
    <>
      <PageHead title="Bons de commande">
        <button onClick={async () => setOpen(await save(db.purchaseOrders, { number: await nextPoNumber(), status: 'brouillon', lines: [{ id: uid(), text: '', qty: 1, unitPrice: 0 }], history: [{ at: new Date().toISOString(), event: 'créé' }] } as unknown as PurchaseOrder))}>+ Nouveau bon de commande</button>
      </PageHead>
      <div className="card">
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Statut">
            <option value="">Tous les statuts</option>
            {Object.entries(PURCHASE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        {shown.length === 0 ? <Empty>Aucun bon de commande. Crée-en un ici, ou depuis l'onglet Coûts d'un projet.</Empty> : (
          <table className="list">
            <thead><tr><th>N°</th><th>Fournisseur</th><th>Projet</th><th>Statut</th><th className="n">Approuvé</th><th className="n">Total HT</th><th>Comparaison</th></tr></thead>
            <tbody>{shown.map((po) => {
              const t = poTotal(po);
              const cmp = po.approvedAmount == null ? '' : Math.abs(t - po.approvedAmount) < 0.01 ? 'aligné' : t > po.approvedAmount ? 'supérieur' : 'inférieur';
              return (
                <tr key={po.id} className="clickable" onClick={() => setOpen(po)}>
                  <td><a href="#" onClick={(e) => e.preventDefault()}>{po.number}</a></td>
                  <td>{po.supplierName || '—'}</td>
                  <td>{po.projectId ? <Link to={'/projets/' + po.projectId} onClick={(e) => e.stopPropagation()}>{pMap.get(po.projectId)?.name || 'projet'}</Link> : <span className="muted">hors projet</span>}</td>
                  <td><span className="badge">{PURCHASE_LABELS[po.status]}</span></td>
                  <td className="n">{po.approvedAmount != null ? money(po.approvedAmount) : '—'}</td>
                  <td className="n">{money(t)}</td>
                  <td className={cmp === 'supérieur' ? 'avail ko' : ''}>{cmp}</td>
                </tr>
              );
            })}</tbody>
          </table>
        )}
      </div>
      {open && <PoEditor po={open} onClose={() => setOpen(null)} />}
    </>
  );
}
