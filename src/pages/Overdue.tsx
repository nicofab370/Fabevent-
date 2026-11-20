import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Empty } from '../components/ui';
import { db } from '../db';
import { createDocument } from '../documents';
import type { Doc } from '../types';
import { DOC_LABELS } from '../types';
import { fmtDate, money, save } from '../utils';

/** Factures et acomptes non payés dont l'échéance est dépassée (hors factures annulées par un avoir total). */
export function useOverdue() {
  const docs = useLiveQuery(() => db.docs.where('type').anyOf('facture', 'acompte', 'avoir', 'rappel').toArray(), []) || [];
  const today = new Date().toISOString().slice(0, 10);
  const credited = new Map<string, number>();
  for (const d of docs) if (d.type === 'avoir' && d.snapshot.refNumber) credited.set(d.snapshot.refNumber, (credited.get(d.snapshot.refNumber) || 0) - d.snapshot.totalTTC);
  const overdue = docs
    .filter((d) => (d.type === 'facture' || d.type === 'acompte') && d.status !== 'paye' && d.status !== 'brouillon' && (d.snapshot.dueDate || '') .slice(0, 10) < today)
    .map((d) => {
      const due = d.snapshot.totalTTC - (d.snapshot.deposits || []).reduce((a, x) => a + x.ttc, 0) - (credited.get(d.number) || 0);
      const reminders = docs.filter((r) => r.type === 'rappel' && r.snapshot.reminder?.invoiceNumber === d.number).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      const days = Math.floor((Date.now() - Date.parse(d.snapshot.dueDate!)) / 86400000);
      return { doc: d, due: Math.round(due * 100) / 100, reminders, days };
    })
    .filter((x) => x.due > 0.005)
    .sort((a, b) => b.days - a.days);
  return overdue;
}

export function OverdueInvoices() {
  const nav = useNavigate();
  const overdue = useOverdue();
  const remind = async (d: Doc) => nav('/documents/' + (await createDocument(d.projectId, 'rappel', { invoiceId: d.id })).id);
  return (
    <div className="card">
      <h2>Factures échues ({overdue.length})</h2>
      <p className="muted" style={{ marginTop: 0 }}>Factures envoyées, non payées, dont l'échéance est dépassée. Marque-les « Payé » dès réception du virement.</p>
      {overdue.length === 0 ? <Empty>Aucune facture en retard.</Empty> : (
        <table className="list">
          <thead><tr><th>Pièce</th><th>Client</th><th>Échéance</th><th className="n">Retard</th><th className="n">Reste dû</th><th>Rappels</th><th /></tr></thead>
          <tbody>
            {overdue.map(({ doc, due, reminders, days }) => (
              <tr key={doc.id}>
                <td><a href={'#/documents/' + doc.id}>{DOC_LABELS[doc.type]} {doc.number}</a></td>
                <td>{doc.snapshot.client?.company}</td>
                <td>{fmtDate(doc.snapshot.dueDate, false)}</td>
                <td className="n avail ko">{days} j</td>
                <td className="n">{money(due)}</td>
                <td>{reminders.length ? reminders.map((r) => <a key={r.id} href={'#/documents/' + r.id} style={{ marginRight: 6 }}>n°{r.snapshot.reminder?.level} ({fmtDate(r.createdAt, false)})</a>) : <span className="muted">aucun</span>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="small" onClick={() => remind(doc)}>{reminders.length >= 2 ? 'Mise en demeure' : `Rappel ${reminders.length + 1}`}</button>{' '}
                  <button className="secondary small" onClick={() => save(db.docs, { ...doc, status: 'paye' })}>Payé</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
