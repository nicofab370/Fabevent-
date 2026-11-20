import { useNavigate } from 'react-router-dom';
import { Empty } from '../../components/ui';
import { db, nextNumber } from '../../db';
import { SUBRENT_LABELS } from '../../types';
import { blockPeriod, fmtRange, money, save } from '../../utils';
import type { ProjectData } from './shared';

/** Onglet Sous-locations & bons de commande. */
export default function SubrentTab({ d }: { d: ProjectData }) {
  const nav = useNavigate();
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

  const orders = [
    ...subrentals.map((s) => ({ key: s.id, kind: 'Sous-location', ref: s.number, supplier: s.supplierId, amount: s.lines.reduce((a, l) => a + l.cost, 0), status: SUBRENT_LABELS[s.status], go: () => nav('/souslocations/' + s.id) })),
    ...costs.filter((c) => c.supplierId).map((c) => ({ key: c.id, kind: 'Coût supplémentaire', ref: c.label, supplier: c.supplierId, amount: c.amount, status: '—', go: undefined })),
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
                  <td><button className="small" onClick={() => subrent(sid)}>Sous-louer le manque</button></td>
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
        <h2>Bons de commande</h2>
        <p className="muted" style={{ marginTop: 0 }}>Toutes les commandes fournisseurs du projet : sous-locations et coûts supplémentaires avec un fournisseur.</p>
        {orders.length === 0 ? <Empty>Aucun bon de commande.</Empty> : (
          <table className="list">
            <thead><tr><th>Origine</th><th>Référence</th><th>Fournisseur</th><th className="n">Montant HT</th><th>Statut</th></tr></thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.key} className={o.go ? 'click' : ''} onClick={o.go}>
                  <td>{o.kind}</td><td>{o.ref}</td><td>{o.supplier ? cName.get(o.supplier) : '—'}</td><td className="n">{money(o.amount)}</td><td>{o.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
