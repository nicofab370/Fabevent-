import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';
import { createDocument } from '../documents';
import { loadInvoicingQueue, MOMENT_STATE_LABELS } from '../invoicing';
import { fmtDate, money, patch, round2 } from '../utils';
import { loadProjectTotals } from './project/shared';

/** « À facturer » : projets confirmés dont un moment de facturation est arrivé (rouge si en retard). */
export function ToInvoice() {
  const nav = useNavigate();
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  // requête « vivante » : recalculée dès qu'un projet, une ligne ou un document change
  const queue = useLiveQuery(async () => loadInvoicingQueue(await loadProjectTotals()), []) || [];
  const pending = queue.filter((q) => !q.project.externalInvoiced && q.next && q.total > 0 && (showAll || q.next.state === 'a_facturer' || q.next.state === 'en_retard'))
    .sort((a, b) => (a.next!.due || '9').localeCompare(b.next!.due || '9'));
  const external = queue.filter((q) => q.project.externalInvoiced);

  const bill = async (q: (typeof queue)[number]) => {
    const r = q.next!;
    setBusy(true);
    try {
      const doc = r.final ? await createDocument(q.project.id, 'facture') : await createDocument(q.project.id, 'acompte', { amountHT: round2(r.cumulativeHT - q.invoiced), label: r.moment.name });
      nav('/documents/' + doc.id);
    } catch (err) { alert((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <h2>À facturer</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Projets confirmés dont un moment de facturation arrive dans les 14 jours ou est dépassé (en rouge). Les moments se règlent dans Paramètres,
        par type de projet, par client ou dans l'onglet Finances du projet.
      </p>
      <label className="check-row" style={{ marginBottom: 8 }}><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Afficher aussi les échéances à venir</label>
      {pending.length === 0 ? <p className="muted">Rien à facturer pour l'instant.</p> : (
        <div className="table-wrap">
          <table className="list">
            <thead><tr><th>Échéance</th><th>Projet</th><th>Client</th><th>Moment</th><th className="n">À facturer HT</th><th className="n">Déjà facturé</th><th /></tr></thead>
            <tbody>
              {pending.map((q) => {
                const r = q.next!;
                return (
                  <tr key={q.project.id} style={r.state === 'en_retard' ? { color: 'var(--danger)' } : undefined}>
                    <td>{r.due ? fmtDate(r.due) : '—'} <span className="muted">{MOMENT_STATE_LABELS[r.state]}</span></td>
                    <td className="click" onClick={() => nav(`/projets/${q.project.id}?onglet=finances`)}><strong>{q.project.number}</strong> {q.project.name}</td>
                    <td>{q.client?.company || '—'}</td>
                    <td>{r.moment.name}</td>
                    <td className="n">{money(round2(r.cumulativeHT - q.invoiced))}</td>
                    <td className="n">{money(q.invoiced)} / {money(q.total)}</td>
                    <td className="nowrap">
                      <button className="small" disabled={busy} onClick={() => bill(q)}>{r.final ? 'Facture finale' : 'Facturer'}</button>{' '}
                      <button className="secondary small" title="Déjà facturé dans un autre logiciel" onClick={() => patch(db.projects, q.project.id, { externalInvoiced: true })}>Facturé en externe</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {external.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className="muted">Facturés en externe ({external.length})</summary>
          <table className="list"><tbody>{external.map((q) => (
            <tr key={q.project.id}><td>{q.project.number} {q.project.name}</td><td>{q.client?.company}</td>
              <td><button className="ghost small" onClick={() => patch(db.projects, q.project.id, { externalInvoiced: undefined })}>Remettre dans « À facturer »</button></td></tr>
          ))}</tbody></table>
        </details>
      )}
    </div>
  );
}
