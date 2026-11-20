import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Modal, NumInput } from '../../components/ui';
import { db } from '../../db';
import { createDocument } from '../../documents';
import type { DocType } from '../../types';
import { DOC_LABELS, DOC_STATUS_LABELS, INVOICE_TYPES } from '../../types';
import { fmtDate, money, patch, round2 } from '../../utils';
import { invoicedHT, type ProjectData } from './shared';
import { hrOrders } from './hrOrders';

/** Onglet Finances : chiffre d'affaires, coûts et marge par catégorie, remise, documents. */
export default function FinanceTab({ d }: { d: ProjectData }) {
  const nav = useNavigate();
  const { project, finance: f, docs, settings } = d;
  const [busy, setBusy] = useState(false);
  const [roomInvoice, setRoomInvoice] = useState(false);
  const invoicedRooms = new Set(docs.filter((x) => x.type === 'facture' && x.subprojectIds).flatMap((x) => x.subprojectIds || []));
  const invoiced = invoicedHT(docs);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');

  const generate = async (type: DocType) => {
    let percent: number | undefined;
    if (type === 'acompte') {
      const a = prompt("Pourcentage de l'acompte (calculé sur le dernier devis) :", '30');
      if (a === null) return;
      percent = parseFloat(a.replace(',', '.')) || 30;
    }
    setBusy(true);
    try { nav('/documents/' + (await createDocument(project.id, type, { percent })).id); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{money(f.totalHT)}</b><span>total HT{f.discount ? ` (après remise)` : ''}</span></div>
        <div className="stat"><b>{money(f.cost)}</b><span>coûts</span></div>
        <div className="stat"><b style={{ color: f.margin < 0 ? 'var(--danger)' : 'var(--ok)' }}>{money(f.margin)}</b><span>marge ({pct(f.margin, f.totalHT)})</span></div>
        <div className="stat"><b>{money(invoiced)}</b><span>déjà facturé HT · reste {money(round2(f.totalHT - invoiced))}</span></div>
      </div>
      <div className="card">
        <h2>Détail par catégorie</h2>
        <table className="list">
          <thead><tr><th>Catégorie</th><th className="n">Chiffre d'affaires HT</th><th className="n">Coûts</th><th className="n">Marge</th><th className="n">%</th></tr></thead>
          <tbody>
            {f.rows.map((r) => (
              <tr key={r.label}><td>{r.label}</td><td className="n">{money(r.revenue)}</td><td className="n">{money(r.cost)}</td><td className="n">{money(round2(r.revenue - r.cost))}</td><td className="n">{pct(r.revenue - r.cost, r.revenue)}</td></tr>
            ))}
            <tr><td><strong>Sous-total</strong></td><td className="n"><strong>{money(f.gross)}</strong></td><td className="n">{money(f.cost)}</td><td /><td /></tr>
            <tr>
              <td>Remise globale <NumInput className="w-qty" value={project.discount} onChange={(n) => patch(db.projects, project.id, { discount: n })} /> %</td>
              <td className="n">− {money(f.discount)}</td><td /><td /><td />
            </tr>
            <tr><td><strong>Total HT</strong></td><td className="n"><strong>{money(f.totalHT)}</strong></td><td /><td className="n"><strong>{money(f.margin)}</strong></td><td className="n">{pct(f.margin, f.totalHT)}</td></tr>
            <tr><td>TVA {settings.vatRate} %</td><td className="n">{money(f.vat)}</td><td /><td /><td /></tr>
            <tr><td><strong>Total TTC</strong></td><td className="n"><strong>{money(f.totalTTC)}</strong></td><td /><td /><td /></tr>
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>Coûts : personnel (coût journalier), sous-locations et consommables (matériel), coûts supplémentaires. Le taux de TVA se règle dans Paramètres.</p>
      </div>

      {(() => {
        const cName = new Map(d.contacts.map((c) => [c.id, c.company]));
        const rows = new Map<string, number>();
        for (const o of hrOrders(d)) rows.set(o.supplier, (rows.get(o.supplier) || 0) + o.total);
        for (const sr of d.subrentals.filter((x) => x.status !== 'annule')) {
          const k = sr.supplierId ? cName.get(sr.supplierId) || '?' : 'Sous-location sans fournisseur';
          rows.set(k, (rows.get(k) || 0) + sr.lines.reduce((x, l) => x + l.cost, 0));
        }
        for (const c of d.costs.filter((x) => x.supplierId)) { const k = cName.get(c.supplierId!) || '?'; rows.set(k, (rows.get(k) || 0) + c.amount); }
        const list = [...rows.entries()].filter(([, v]) => v).sort((x, y) => y[1] - x[1]);
        return list.length ? (
          <div className="card">
            <h2>Coûts par fournisseur</h2>
            <table className="list"><tbody>{list.map(([k, v]) => <tr key={k}><td>{k}</td><td className="n">{money(round2(v))}</td></tr>)}</tbody></table>
          </div>
        ) : null;
      })()}

      <div className="card">
        <h2>Devis, factures et documents</h2>
        <div className="toolbar">
          {d.subs.length > 1 && <button className="secondary" disabled={busy} onClick={() => setRoomInvoice(true)}>+ Facture d'une salle</button>}
          {(['devis', 'acompte', 'facture', 'bon_sortie', 'feuille_route'] as DocType[]).map((t) => (
            <button key={t} disabled={busy} className={t === 'devis' ? '' : 'secondary'} onClick={() => generate(t)}>+ {DOC_LABELS[t]}</button>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Chaque génération crée un nouveau document figé : rien n'est jamais écrasé. La facture finale déduit automatiquement les acomptes ;
          les avoirs se créent depuis la facture concernée.
        </p>
        {docs.length === 0 ? <Empty>Aucun document pour l'instant.</Empty> : (
          <table className="list">
            <thead><tr><th>Type</th><th>Numéro</th><th>Version</th><th>Date</th><th className="n">Total HT</th><th>Statut</th></tr></thead>
            <tbody>
              {docs.map((x) => (
                <tr key={x.id} className="click" onClick={() => nav('/documents/' + x.id)}>
                  <td>{DOC_LABELS[x.type]}</td><td><strong>{x.number}</strong></td><td>{INVOICE_TYPES.includes(x.type) ? '' : `v${x.version}`}</td>
                  <td>{fmtDate(x.createdAt)}</td>
                  <td className="n">{x.snapshot.hidePrices ? '—' : money(x.snapshot.totalHT)}</td>
                  <td><span className="badge">{DOC_STATUS_LABELS[x.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {roomInvoice && (
        <Modal title="Facturer une ou plusieurs salles" onClose={() => setRoomInvoice(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const ids = [...new FormData(e.currentTarget).keys()];
            if (!ids.length) return;
            setBusy(true);
            try { nav('/documents/' + (await createDocument(project.id, 'facture', { subIds: ids })).id); } catch (err) { alert((err as Error).message); } finally { setBusy(false); }
          }}>
            <p className="muted" style={{ marginTop: 0 }}>La facture finale du projet exclura ensuite automatiquement ces salles. Les frais supplémentaires et les acomptes restent sur la facture finale.</p>
            {d.subs.filter((sp) => sp.status !== 'annule').map((sp) => (
              <label key={sp.id} className="check-row" style={{ marginBottom: 6 }}>
                <input type="checkbox" name={sp.id} disabled={invoicedRooms.has(sp.id)} /> {sp.name}{invoicedRooms.has(sp.id) && <span className="muted"> — déjà facturée</span>}
              </label>
            ))}
            <div className="form-actions" style={{ display: 'flex' }}>
              <button type="button" className="secondary" onClick={() => setRoomInvoice(false)}>Annuler</button>
              <button type="submit">Générer la facture</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
