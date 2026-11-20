import { useState } from 'react';
import { DOC_CSS } from '../../components/DocRender';
import { Empty, NumInput } from '../../components/ui';
import { db } from '../../db';
import type { ProjectCost } from '../../types';
import { fmtDate, money, round2, save } from '../../utils';
import { printHtml, type ProjectData } from './shared';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const CATEGORIES = ['Déplacement', 'Hébergement', 'Restauration', 'Location externe', 'Logistique', 'Autre'];

/** Onglet Coûts supplémentaires : frais internes, refacturés ou non, avec bon de commande fournisseur. */
export default function CostsTab({ d }: { d: ProjectData }) {
  const { project, costs, contacts, settings } = d;
  const [label, setLabel] = useState('');
  const suppliers = contacts.filter((c) => c.type !== 'client' && c.type !== 'lieu');
  const upd = (c: ProjectCost, patch: Partial<ProjectCost>) => save(db.costs, { ...c, ...patch });
  const totalCost = round2(costs.reduce((a, c) => a + (c.amount || 0), 0));
  const totalSale = round2(costs.filter((c) => c.billable).reduce((a, c) => a + (c.qty || 1) * (c.price || 0), 0));

  const purchaseOrder = (c: ProjectCost) => {
    const sup = contacts.find((x) => x.id === c.supplierId);
    const co = settings.company;
    printHtml(`Bon de commande — ${c.label}`, `<div class="doc">
      <div class="head"><div>${co.logo ? `<img src="${co.logo}">` : ''}<div><strong>${esc(co.name)}</strong></div><div style="white-space:pre-line">${esc(co.address)}</div></div>
      <div class="box"><h1>Bon de commande</h1><div>Date : ${fmtDate(new Date().toISOString(), false)}</div><div>Projet : ${esc(project.number)} ${esc(project.name)}</div>
      ${sup ? `<div style="margin-top:8px"><strong>${esc(sup.company)}</strong><div>${esc(sup.address)}</div><div>${esc([sup.postalCode, sup.city].filter(Boolean).join(' '))}</div></div>` : ''}</div></div>
      <table><thead><tr><th class="n">Qté</th><th>Désignation</th><th class="n">Montant HT</th></tr></thead>
      <tbody><tr><td class="n">${c.qty || 1}</td><td>${esc(c.label)}${c.category ? ` (${esc(c.category)})` : ''}</td><td class="n">${money(c.amount)}</td></tr></tbody></table>
      <p>Période : ${fmtDate(project.start)} → ${fmtDate(project.end)}${project.venue ? ` · ${esc(project.venue)}` : ''}</p></div>`, DOC_CSS);
  };

  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>
        Frais hors matériel et personnel : déplacement, hébergement, restauration, location externe… Coche « Refacturé » pour qu'ils
        apparaissent sur les devis et factures au prix de vente indiqué. Le coût compte dans la marge.
      </p>
      {costs.length === 0 ? <Empty>Aucun coût supplémentaire.</Empty> : (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Libellé</th><th>Catégorie</th><th>Fournisseur</th><th>Qté</th><th>Coût total HT</th><th>Refacturé</th><th>P.U. vente HT</th><th className="n">Vente</th><th /></tr></thead>
            <tbody>
              {costs.map((c) => (
                <tr key={c.id}>
                  <td><input value={c.label} onChange={(e) => upd(c, { label: e.target.value })} /></td>
                  <td>
                    <select value={c.category || ''} onChange={(e) => upd(c, { category: e.target.value || undefined })}>
                      <option value="">—</option>
                      {CATEGORIES.map((x) => <option key={x}>{x}</option>)}
                    </select>
                  </td>
                  <td>
                    <select value={c.supplierId || ''} onChange={(e) => upd(c, { supplierId: e.target.value || undefined })}>
                      <option value="">—</option>
                      {suppliers.map((x) => <option key={x.id} value={x.id}>{x.company}</option>)}
                    </select>
                  </td>
                  <td><NumInput className="w-qty" value={c.qty || 1} onChange={(n) => upd(c, { qty: n })} /></td>
                  <td><NumInput className="w-price" value={c.amount} onChange={(n) => upd(c, { amount: n })} /></td>
                  <td><input type="checkbox" checked={!!c.billable} onChange={(e) => upd(c, { billable: e.target.checked })} /></td>
                  <td>{c.billable && <NumInput className="w-price" value={c.price || 0} onChange={(n) => upd(c, { price: n })} />}</td>
                  <td className="n">{c.billable ? money((c.qty || 1) * (c.price || 0)) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {c.supplierId && <button className="secondary small" onClick={() => purchaseOrder(c)}>Bon de commande</button>}
                    <button className="ghost" onClick={() => db.costs.delete(c.id)} aria-label="Retirer">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}><strong>Total</strong></td><td><strong>{money(totalCost)}</strong></td><td /><td /><td className="n"><strong>{money(totalSale)}</strong></td><td /></tr></tfoot>
          </table>
        </div>
      )}
      <form className="toolbar" style={{ marginTop: 10 }} onSubmit={async (e) => {
        e.preventDefault();
        if (!label.trim()) return;
        await save(db.costs, { projectId: project.id, label: label.trim(), amount: 0, qty: 1, billable: false });
        setLabel('');
      }}>
        <input placeholder="Nouveau coût (ex. Hôtel équipe, Péages, Location nacelle)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <button className="small" type="submit">+ Ajouter</button>
      </form>
    </div>
  );
}
