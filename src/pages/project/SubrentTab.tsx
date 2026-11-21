import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty } from '../../components/ui';
import { db, nextNumber } from '../../db';
import { SUBRENT_LABELS } from '../../types';
import { availableQty, blockPeriod, fmtRange, money, save } from '../../utils';
import type { ProjectData } from './shared';
import { hrOrderHtml, hrOrderMail, hrOrders, printHrOrder, type HrOrder } from './hrOrders';
import { EmailModal } from '../../components/EmailModal';
import { htmlToPdf, safeFileName } from '../../pdf';
import { DOC_CSS } from '../../components/DocRender';

/** Onglet Sous-locations & bons de commande. */
export default function SubrentTab({ d }: { d: ProjectData }) {
  const nav = useNavigate();
  const [mailOrder, setMailOrder] = useState<HrOrder | null>(null);
  const { project, conflicts, subrentals, subs, costs, contacts } = d;
  const cName = new Map(contacts.map((c) => [c.id, c.company]));

  const subrent = async (subprojectId: string) => {
    const sp = subs.find((s) => s.id === subprojectId)!;
    const items = conflicts.filter((c) => c.subprojectId === subprojectId);
    const [start, end] = blockPeriod(sp);
    const sr = await save(db.subrentals, {
      number: await nextNumber('SL'), projectId: project.id, subprojectId, status: 'demande', start, end,
      lines: items.map((c) => ({ equipmentId: c.equipment.id, name: c.equipment.name, qty: c.shortage, cost: 0 })),
    });
    nav('/souslocations/' + sr.id);
  };

  /** Dépôts qui ont encore le matériel manquant sur la période. */
  const transferOptions = (sid: string) => {
    if (!d.depot) return [];
    const sp = subs.find((s) => s.id === sid)!;
    const [start, end] = blockPeriod(sp);
    const items = conflicts.filter((c) => c.subprojectId === sid);
    return d.av.depots.filter((dp) => dp.id !== d.depot).map((dp) => ({
      depot: dp,
      lines: items.map((c) => ({ equipmentId: c.equipment.id, name: c.equipment.name, qty: Math.min(c.shortage, Math.max(0, availableQty(c.equipment, d.av.equipment, d.av.res, start, end, undefined, dp.id))) })).filter((l) => l.qty > 0),
    })).filter((o) => o.lines.length);
  };
  const transfer = async (sid: string, fromDepotId: string, lines: { equipmentId: string; qty: number }[]) => {
    const sp = subs.find((s) => s.id === sid)!;
    const [start, end] = blockPeriod(sp);
    const t = await save(db.transfers, {
      number: await nextNumber('TR'), fromDepotId, toDepotId: d.depot!, start, end, status: 'planifie', projectId: project.id,
      lines: lines.map(({ equipmentId, qty }) => ({ equipmentId, qty })), notes: `Pour ${project.number} ${project.name} — ${sp.name}`,
    });
    nav('/transferts?id=' + t.id);
  };

  const hr = hrOrders(d);
  const orders = [
    ...subrentals.map((s) => ({ key: s.id, kind: 'Sous-location', ref: s.number, supplier: s.supplierId, amount: s.lines.reduce((a, l) => a + l.cost, 0), status: SUBRENT_LABELS[s.status], go: () => nav('/souslocations/' + s.id) })),
    ...costs.filter((c) => c.supplierName?.trim() || c.supplierId).map((c) => ({ key: c.id, kind: 'Coût supplémentaire', ref: c.label, supplier: c.supplierId, supplierName: c.supplierName?.trim(), amount: c.amount, status: '—', go: undefined })),
  ];

  return (
    <>
      <div className="card">
        <h2>Manques de matériel</h2>
        {conflicts.length === 0 ? <Empty>Aucun manque : tout le matériel est disponible.</Empty> : (
          <table className="list">
            <tbody>
              {Array.from(new Set(conflicts.map((c) => c.subprojectId))).map((sid) => (
                <tr key={sid}>
                  <td><strong>{subs.find((s) => s.id === sid)?.name}</strong></td>
                  <td>{conflicts.filter((c) => c.subprojectId === sid).map((c) => `${c.shortage} × ${c.equipment.name}`).join(', ')}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {transferOptions(sid).map((o) => (
                      <button key={o.depot.id} className="secondary small" style={{ marginRight: 6 }} onClick={() => transfer(sid, o.depot.id, o.lines)}
                        title={o.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}>Transférer depuis {o.depot.name}</button>
                    ))}
                    <button className="small" onClick={() => subrent(sid)}>Sous-louer le manque</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Sous-locations</h2>
        {subrentals.length === 0 ? <Empty>Aucune sous-location.</Empty> : (
          <table className="list">
            <thead><tr><th>N°</th><th>Fournisseur</th><th>Période</th><th>Matériel</th><th className="n">Coût</th><th>Statut</th></tr></thead>
            <tbody>
              {subrentals.map((s) => (
                <tr key={s.id} className="click" onClick={() => nav('/souslocations/' + s.id)}>
                  <td><strong>{s.number}</strong></td><td>{s.supplierId ? cName.get(s.supplierId) : <span className="muted">à choisir</span>}</td>
                  <td>{fmtRange(s.start, s.end)}</td><td>{s.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')}</td>
                  <td className="n">{money(s.lines.reduce((a, l) => a + l.cost, 0))}</td><td><span className="badge">{SUBRENT_LABELS[s.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Bons de commande RH (sous-traitants)</h2>
        <p className="muted" style={{ marginTop: 0 }}>Postes tenus par des sous-traitants, regroupés par société (ou par freelance) au coût convenu.</p>
        {hr.length === 0 ? <Empty>Aucun sous-traitant affecté.</Empty> : (
          <table className="list">
            <thead><tr><th>Fournisseur</th><th>Postes</th><th className="n">Total HT</th><th /></tr></thead>
            <tbody>
              {hr.map((o) => (
                <tr key={o.key}>
                  <td><strong>{o.supplier}</strong></td>
                  <td>{o.lines.map((l, i) => <div key={i} style={{ fontSize: 12 }}>{l.function} — {l.person} · {l.qty}{!l.final && <span className="badge st-option" style={{ marginLeft: 4 }}>provisoire</span>}</div>)}</td>
                  <td className="n">{money(o.total)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="secondary small" onClick={() => printHrOrder(d, o)}>Bon de commande</button>{' '}
                    <button className="secondary small" onClick={() => setMailOrder(o)}>Envoyer par email</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="card">
        <h2>Bons de commande matériel et frais</h2>
        <p className="muted" style={{ marginTop: 0 }}>Toutes les commandes fournisseurs du projet : sous-locations et coûts supplémentaires avec un fournisseur.</p>
        {orders.length === 0 ? <Empty>Aucun bon de commande.</Empty> : (
          <table className="list">
            <thead><tr><th>Origine</th><th>Référence</th><th>Fournisseur</th><th className="n">Montant HT</th><th>Statut</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.key} className={o.go ? 'click' : ''} onClick={o.go}>
                  <td>{o.kind}</td><td>{o.ref}</td><td>{('supplierName' in o && o.supplierName) || (o.supplier ? cName.get(o.supplier) : '—')}</td><td className="n">{money(o.amount)}</td><td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {mailOrder && (
        <EmailModal initial={hrOrderMail(d, mailOrder)} onClose={() => setMailOrder(null)} kind="sous_location"
          vars={{ projet: project.name, lieu: project.venue, societe: d.settings.company.name, dates: fmtRange(project.start, project.end) }}
          prepare={async () => [{ name: `${safeFileName(`Bon-de-commande-${project.number}-${mailOrder.supplier}`)}.pdf`, type: 'application/pdf', blob: await htmlToPdf(hrOrderHtml(d, mailOrder), DOC_CSS) }]} />
      )}
    </>
  );
}
