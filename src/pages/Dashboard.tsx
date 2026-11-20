import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, PageHead, StatusBadge } from '../components/ui';
import { db } from '../db';
import { DOC_LABELS, DOC_STATUS_LABELS } from '../types';
import { findConflicts, fmtDate, fmtRange, money, toLocalInput } from '../utils';

export default function Dashboard() {
  const nav = useNavigate();
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const lines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const equipment = useLiveQuery(() => db.equipment.toArray(), []) || [];
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const docs = useLiveQuery(() => db.docs.orderBy('createdAt').reverse().limit(8).toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const sMap = new Map(subs.map((s) => [s.id, s]));

  const now = toLocalInput(new Date());
  const in30 = toLocalInput(new Date(Date.now() + 30 * 86400000));
  const upcoming = subs
    .filter((s) => s.end >= now && s.start <= in30 && s.status !== 'annule')
    .sort((a, b) => a.start.localeCompare(b.start));
  const conflicts = findConflicts(lines, subs, equipment).filter((c) => (sMap.get(c.subprojectId)?.end || '') >= now);
  const unstaffed = crew.filter((c) => !c.personId && c.end >= now && sMap.get(c.subprojectId)?.status !== 'annule');
  const pendingQuotes = projects.filter((p) => p.status === 'option' || p.status === 'demande').length;

  return (
    <>
      <PageHead title="Tableau de bord">
        <button onClick={() => nav('/projets')}>Projets</button>
      </PageHead>
      <div className="stats">
        <div className="stat"><b>{upcoming.length}</b><span>prestations dans les 30 j</span></div>
        <div className="stat"><b>{pendingQuotes}</b><span>demandes / options en cours</span></div>
        <div className="stat"><b style={{ color: conflicts.length ? 'var(--danger)' : undefined }}>{conflicts.length}</b><span>manques de matériel</span></div>
        <div className="stat"><b style={{ color: unstaffed.length ? 'var(--danger)' : undefined }}>{unstaffed.length}</b><span>postes à pourvoir</span></div>
        <div className="stat"><b>{equipment.length}</b><span>articles au catalogue</span></div>
      </div>

      {conflicts.length > 0 && (
        <div className="card">
          <h2>⚠ Manques de matériel</h2>
          <table className="list">
            <tbody>
              {conflicts.map((c, i) => {
                const s = sMap.get(c.subprojectId);
                return (
                  <tr key={i} className="click" onClick={() => nav('/projets/' + c.projectId)}>
                    <td><strong>{c.equipment.name}</strong></td><td className="avail ko">manque {c.shortage}</td>
                    <td>{pMap.get(c.projectId)?.name} · {s?.name}</td><td>{fmtRange(s?.start, s?.end)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid">
        <div className="card">
          <h2>Prochaines prestations</h2>
          {upcoming.length === 0 ? <Empty>Rien de prévu dans les 30 prochains jours.</Empty> : (
            <table className="list">
              <tbody>
                {upcoming.map((s) => (
                  <tr key={s.id} className="click" onClick={() => nav('/projets/' + s.projectId)}>
                    <td><strong>{pMap.get(s.projectId)?.name}</strong><div className="muted">{s.name}{s.venue && ` · ${s.venue}`}</div></td>
                    <td>{fmtRange(s.start, s.end)}</td>
                    <td><StatusBadge status={s.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>Derniers documents</h2>
          {docs.length === 0 ? <Empty>Aucun document.</Empty> : (
            <table className="list">
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="click" onClick={() => nav('/documents/' + d.id)}>
                    <td>{DOC_LABELS[d.type]} <strong>{d.number}</strong> v{d.version}<div className="muted">{pMap.get(d.projectId)?.name}</div></td>
                    <td className="n">{d.snapshot.hidePrices ? '' : money(d.snapshot.totalTTC)}</td>
                    <td><span className="badge">{DOC_STATUS_LABELS[d.status]}</span><div className="muted" style={{ fontSize: 11 }}>{fmtDate(d.createdAt, false)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {projects.length === 0 && (
        <div className="info">
          Pour démarrer : renseigne ta société dans <Link to="/parametres">Paramètres</Link>, importe ton catalogue et tes contacts
          depuis Rentman dans <Link to="/import">Import</Link>, puis crée ton premier projet.
        </div>
      )}
    </>
  );
}
