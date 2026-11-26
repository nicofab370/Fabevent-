import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';
import { createDocument } from '../documents';
import { billingRecap } from '../invoicing';
import { STATUS_LABELS } from '../types';
import { fmtRange, money } from '../utils';
import { loadProjectTotals } from './project/shared';

/**
 * « Ce qui est facturé » : récap par projet — total HT, déjà facturé HT, reste à facturer —
 * avec un drapeau « évènement passé » quand la fin est passée et qu'il reste à facturer.
 */
export function BillingRecap() {
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const rows = useLiveQuery(async () => {
    const [projects, docs, contacts, totals] = await Promise.all([db.projects.toArray(), db.docs.toArray(), db.contacts.toArray(), loadProjectTotals()]);
    return billingRecap(projects, docs, totals, contacts);
  }, []) || [];
  const visible = rows.filter((r) => showDone || r.free || r.reste > 0.005 || (r.past && r.reste > 0.005));

  const bill = async (projectId: string) => {
    setBusy(true);
    try { const doc = await createDocument(projectId, 'facture'); nav('/documents/' + doc.id); }
    catch (err) { alert((err as Error).message); } finally { setBusy(false); }
  };

  const stateBadge = (r: (typeof rows)[number]) => {
    if (r.free) return <span className="avail ok">Offert (0 €)</span>;
    if (r.reste > 0.005 && r.past) return <span className="avail ko">Évènement passé</span>;
    if (r.reste > 0.005) return <span className="avail warn">Partiellement facturé</span>;
    if (r.total > 0.005 || r.invoiced > 0.005) return <span className="muted">Tout facturé</span>;
    return <span className="muted">—</span>;
  };

  return (
    <div className="card">
      <h2>Ce qui est facturé par projet</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Total du projet, montant déjà facturé (factures + acomptes, avoirs déduits) et solde restant.
        En rouge : l'évènement est terminé et le solde n'est pas encore facturé. Les projets offerts apparaissent à 0 €.
      </p>
      <label className="check-row" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} aria-label="Afficher aussi les projets tout facturés" />
        Afficher aussi les projets déjà tout facturés
      </label>
      {visible.length === 0 ? <p className="muted">Rien à signaler pour l’instant.</p> : (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Projet</th><th>Client</th><th>Dates</th><th>Statut</th><th className="n">Total HT</th><th className="n">Facturé HT</th><th className="n">Solde HT</th><th>État</th><th /></tr></thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.project.id}>
                  <td className="click" onClick={() => nav('/projets/' + r.project.id + '?onglet=finances')}><strong>{r.project.number}</strong> {r.project.name}</td>
                  <td>{r.client?.company || '—'}</td>
                  <td className="muted">{fmtRange(r.project.start, r.project.end)}</td>
                  <td>{STATUS_LABELS[r.project.status]}</td>
                  <td className="n">{money(r.total)}</td>
                  <td className="n">{money(r.invoiced)}</td>
                  <td className="n"><strong>{money(r.reste)}</strong></td>
                  <td>{stateBadge(r)}</td>
                  <td className="nowrap">
                    {r.reste > 0.005 && !r.free && <button className="small" disabled={busy} onClick={() => bill(r.project.id)}>Facturer le solde</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
