import { addToPurchaseOrder } from '../PurchaseOrders';
import { useState } from 'react';
import { DOC_CSS } from '../../components/DocRender';
import { Empty, NumInput } from '../../components/ui';
import { db } from '../../db';
import type { ProjectCost } from '../../types';
import { escHtml as esc, fmtDate, money, round2, save, uid } from '../../utils';
import { printHtml, type ProjectData } from './shared';
import { Icon } from '../../components/Icon';

const CATEGORIES = ['Déplacement', 'Hébergement', 'Restauration', 'Location externe', 'Logistique', 'Autre'];

/** Onglet Coûts supplémentaires : frais internes, refacturés ou non, avec bon de commande fournisseur. */
export default function CostsTab({ d }: { d: ProjectData }) {
  const { project, costs, contacts, settings } = d;
  const [label, setLabel] = useState('');
  const suppliers = contacts.filter((c) => c.type !== 'client' && c.type !== 'lieu');
  /** nom du fournisseur : texte libre, sinon le contact relié (anciennes fiches) */
  const supplierOf = (c: ProjectCost) => c.supplierName ?? contacts.find((x) => x.id === c.supplierId)?.company ?? '';
  const rateOf = (c: ProjectCost) => c.vatRate ?? settings.vatRate;
  /** montant affiché selon la saisie choisie (TVAC / HTVA) ; on garde toujours le HT */
  const shown = (c: ProjectCost, ht: number) => (c.vatIncl ? round2(ht * (1 + rateOf(c) / 100)) : ht);
  const toHt = (c: ProjectCost, v: number) => (c.vatIncl ? v / (1 + rateOf(c) / 100) : v);
  const upd = (c: ProjectCost, patch: Partial<ProjectCost>) => save(db.costs, { ...c, ...patch });
  const totalCost = round2(costs.reduce((a, c) => a + (c.amount || 0), 0));
  const totalSale = round2(costs.filter((c) => c.billable).reduce((a, c) => a + (c.qty || 1) * (c.price || 0), 0));

  const purchaseOrder = (c: ProjectCost) => {
    const name = supplierOf(c).trim();
    // fiche du fournisseur si elle existe ; sinon seulement son nom ; rien s'il n'est pas renseigné
    const sup = name ? contacts.find((x) => x.company.trim().toLowerCase() === name.toLowerCase()) || { company: name, address: '', postalCode: '', city: '' } : undefined;
    const co = settings.company;
    printHtml(`Bon de commande — ${c.label}`, `<div class="doc">
      <div class="head"><div>${co.logo ? `<img src="${co.logo}">` : ''}<div><strong>${esc(co.name)}</strong></div><div style="white-space:pre-line">${esc(co.address)}</div></div>
      <div class="box"><h1>Bon de commande</h1><div>Date : ${fmtDate(new Date().toISOString(), false)}</div><div>Projet : ${esc(project.number)} ${esc(project.name)}</div>
      ${sup ? `<div style="margin-top:8px"><strong>${esc(sup.company)}</strong><div>${esc(sup.address)}</div><div>${esc([sup.postalCode, sup.city].filter(Boolean).join(' '))}</div></div>` : ''}</div></div>
      <table><thead><tr><th class="n">Qté</th><th>Désignation</th><th class="n">Montant HT</th></tr></thead>
      <tbody><tr><td class="n">${c.qty || 1}</td><td>${esc(c.label)}${c.category ? ` (${esc(c.category)})` : ''}</td><td class="n">${money(c.amount)}</td></tr></tbody></table>${c.vatIncl ? `<p>Soit ${money(round2(c.amount * (1 + rateOf(c) / 100)))} TVA comprise (${rateOf(c)} %).</p>` : ''}
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
          <table className="list cards-sm">
            <thead><tr><th>Libellé</th><th>Catégorie</th><th>Fournisseur</th><th>Qté</th><th title="Montants saisis hors TVA ou TVA comprise">Saisie</th><th>Coût total</th><th>Refacturé</th><th>P.U. vente</th><th className="n">Vente HT</th><th /></tr></thead>
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
                    <input list="cost-suppliers" value={supplierOf(c)} placeholder="facultatif" aria-label={`Fournisseur de ${c.label}`}
                      onChange={(e) => { const v = e.target.value; const m = suppliers.find((x) => x.company.trim().toLowerCase() === v.trim().toLowerCase()); upd(c, { supplierName: v, supplierId: m?.id }); }} />
                  </td>
                  <td><NumInput className="w-qty" value={c.qty || 1} onChange={(n) => upd(c, { qty: n })} /></td>
                  <td>
                    <select value={c.vatIncl ? 'ttc' : 'ht'} aria-label={`Saisie des montants de ${c.label}`} onChange={(e) => upd(c, { vatIncl: e.target.value === 'ttc' || undefined })}>
                      <option value="ht">HTVA</option><option value="ttc">TVAC {rateOf(c)} %</option>
                    </select>
                  </td>
                  <td><NumInput className="w-price" value={shown(c, c.amount)} onChange={(n) => upd(c, { amount: toHt(c, n) })} aria-label={`Coût de ${c.label}`} />
                    {c.vatIncl && <div className="muted" style={{ fontSize: 11 }}>{money(c.amount)} HT</div>}</td>
                  <td><input type="checkbox" checked={!!c.billable} onChange={(e) => upd(c, { billable: e.target.checked })} /></td>
                  <td>{c.billable && <><NumInput className="w-price" value={shown(c, c.price || 0)} onChange={(n) => upd(c, { price: toHt(c, n) })} aria-label={`Prix de vente de ${c.label}`} />
                    {c.vatIncl && <div className="muted" style={{ fontSize: 11 }}>{money(c.price || 0)} HT</div>}</>}</td>
                  <td className="n">{c.billable ? money((c.qty || 1) * (c.price || 0)) : '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="secondary small" onClick={() => purchaseOrder(c)}>Bon de commande</button>{' '}
                    <button className="secondary small" title="Ajouter ce coût au bon de commande du fournisseur (suivi et approbation dans Bons de commande)" onClick={async () => {
                      const po = await addToPurchaseOrder({ supplierId: c.supplierId, supplierName: supplierOf(c) || undefined, projectId: c.projectId, lines: [{ id: uid(), text: c.label, qty: c.qty || 1, unitPrice: round2(c.amount / (c.qty || 1)), costId: c.id }] });
                      alert(`Ajouté au bon de commande ${po.number} (menu Bons de commande).`);
                    }}>Ajouter au bon</button>
                    <button className="ghost" onClick={() => db.costs.delete(c.id)} aria-label="Retirer"><Icon name="x" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={5}><strong>Total HT</strong></td><td><strong>{money(totalCost)}</strong></td><td /><td /><td className="n"><strong>{money(totalSale)}</strong></td><td /></tr></tfoot>
          </table>
          <datalist id="cost-suppliers">{suppliers.map((x) => <option key={x.id} value={x.company} />)}</datalist>
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
