import { useLiveQuery } from 'dexie-react-hooks';
import { Empty } from '../../components/ui';
import { db } from '../../db';
import { fmtDate } from '../../utils';

/** Onglet Registre : historique des modifications du projet. */
export default function LogTab({ projectId }: { projectId: string }) {
  const log = useLiveQuery(() => db.log.where('projectId').equals(projectId).reverse().sortBy('at'), [projectId]) || [];
  const byDay = new Map<string, typeof log>();
  for (const e of log) {
    const k = new Date(e.at).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    byDay.set(k, [...(byDay.get(k) || []), e]);
  }
  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>Chaque modification du projet est enregistrée ici (les saisies successives sur une même ligne sont regroupées).</p>
      {log.length === 0 ? <Empty>Aucune modification enregistrée pour l'instant.</Empty> : [...byDay.entries()].map(([day, entries]) => (
        <div key={day} style={{ marginBottom: 12 }}>
          <h3 style={{ textTransform: 'capitalize', margin: '8px 0' }}>{day}</h3>
          <table className="list">
            <tbody>
              {entries.map((e) => <tr key={e.id}><td style={{ width: 70 }} className="muted">{fmtDate(e.at).slice(-5)}</td><td>{e.text}</td></tr>)}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
