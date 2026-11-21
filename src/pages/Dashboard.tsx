import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, PageHead, StatusBadge } from '../components/ui';
import { currentWorkspace, db, switchWorkspace } from '../db';
import { DEMO_WORKSPACE } from '../demo';
import { DOC_LABELS, DOC_STATUS_LABELS, INVOICE_TYPES } from '../types';
import { useAvailability } from '../data';
import { useOverdue } from './Overdue';
import { shortageLabel, upcomingShortages } from './Shortages';
import { fmtDate, fmtRange, inspectionsDue, money, toLocalInput } from '../utils';
import { Icon } from '../components/Icon';

export default function Dashboard() {
  const nav = useNavigate();
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const av = useAvailability();
  const equipment = av.equipment;
  const units = av.units;
  const inspections = useLiveQuery(() => db.inspections.toArray(), []) || [];
  const subrentals = av.subrentals;
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const docs = useLiveQuery(() => db.docs.orderBy('createdAt').reverse().limit(8).toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const sMap = new Map(subs.map((s) => [s.id, s]));

  const now = toLocalInput(new Date());
  const in30 = toLocalInput(new Date(Date.now() + 30 * 86400000));
  const upcoming = subs
    .filter((s) => s.end >= now && s.start <= in30 && s.status !== 'annule' && !pMap.get(s.projectId)?.isTemplate)
    .sort((a, b) => a.start.localeCompare(b.start));
  const conflicts = upcomingShortages(av.conflicts(), now).filter((c) => !pMap.get(c.projectId)?.isTemplate);
  const firmShort = conflicts.filter((c) => c.level === 'ferme').length;
  const dueInspections = inspectionsDue(equipment, units, inspections).filter((d) => d.due <= in30.slice(0, 10)).length;
  const openRepairs = av.repairs.filter((r) => r.status === 'ouvert').length;
  const overdue = useOverdue();
  const personFiles = useLiveQuery(() => db.files.where('personId').above('').toArray(), []) || [];
  const expiringDocs = personFiles.filter((f) => f.expires && f.expires <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).length;
  const pendingSubrentals = subrentals.filter((s) => s.status === 'demande').length;
  const unstaffed = crew.filter((c) => !c.personId && c.end >= now && sMap.get(c.subprojectId)?.status !== 'annule');
  const pendingQuotes = projects.filter((p) => !p.isTemplate && ['demande', 'brouillon', 'option'].includes(p.status)).length;

  return (
    <>
      <PageHead title="Tableau de bord">
        <button onClick={() => nav('/projets')}>Projets</button>
      </PageHead>
      <div className="stats">
        <div className="stat"><b>{upcoming.length}</b><span>prestations dans les 30 j</span></div>
        <div className="stat"><b>{pendingQuotes}</b><span>demandes et devis en attente</span></div>
        <div className="stat" onClick={() => nav('/penuries')} style={{ cursor: 'pointer' }}><b style={{ color: firmShort ? 'var(--danger)' : undefined }}>{conflicts.length}</b><span>manques de matériel{conflicts.length ? ` (${firmShort} réels)` : ''}</span></div>
        <div className="stat" onClick={() => nav('/attribution')} style={{ cursor: 'pointer' }}><b style={{ color: unstaffed.length ? 'var(--danger)' : undefined }}>{unstaffed.length}</b><span>postes à pourvoir</span></div>
        <div className="stat" onClick={() => nav('/maintenance')} style={{ cursor: 'pointer' }}><b style={{ color: dueInspections ? 'var(--danger)' : undefined }}>{dueInspections}</b><span>contrôles à faire (30 j)</span></div>
        <div className="stat" onClick={() => nav('/maintenance')} style={{ cursor: 'pointer' }}><b>{openRepairs}</b><span>réparations en cours</span></div>
        {expiringDocs > 0 && <div className="stat" onClick={() => nav('/equipe')} style={{ cursor: 'pointer' }}><b style={{ color: 'var(--danger)' }}>{expiringDocs}</b><span>documents du personnel à renouveler</span></div>}
        <div className="stat" onClick={() => nav('/comptabilite')} style={{ cursor: 'pointer' }}><b style={{ color: overdue.length ? 'var(--danger)' : undefined }}>{overdue.length}</b><span>factures échues</span></div>
        <div className="stat" onClick={() => nav('/souslocations')} style={{ cursor: 'pointer' }}><b>{pendingSubrentals}</b><span>sous-locations à confirmer</span></div>
      </div>

      {conflicts.length > 0 && (
        <div className="card">
          <h2><Icon name="warning" />Manques de matériel <button className="secondary small" onClick={() => nav('/penuries')}>Tout voir</button></h2>
          <table className="list">
            <tbody>
              {conflicts.slice(0, 8).map((c, i) => {
                const s = sMap.get(c.subprojectId);
                return (
                  <tr key={i} className="click" onClick={() => nav('/projets/' + c.projectId)}>
                    <td><strong>{c.equipment.name}</strong></td><td className="avail ko">manque {c.shortage}</td><td className="muted">{shortageLabel(c, s)}</td>
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
                    <td>{DOC_LABELS[d.type]} <strong>{d.number}</strong>{INVOICE_TYPES.includes(d.type) ? '' : ` v${d.version}`}<div className="muted">{pMap.get(d.projectId)?.name}</div></td>
                    <td className="n">{d.snapshot.hidePrices ? '' : money(d.snapshot.totalTTC)}</td>
                    <td><span className="badge">{DOC_STATUS_LABELS[d.status]}</span><div className="muted" style={{ fontSize: 11 }}>{fmtDate(d.createdAt, false)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {projects.length === 0 && currentWorkspace() !== DEMO_WORKSPACE && (
        <div className="card" style={{ borderColor: '#7c3aed' }}>
          <h2>Envie de tester d'abord ?</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            Ouvre la base de démonstration : clients, matériel, équipe et projets fictifs, rangés à part de tes vraies données.
            Tu pourras revenir ici à tout moment depuis Paramètres.
          </p>
          <button onClick={() => switchWorkspace(DEMO_WORKSPACE)}>Essayer avec des données de démo</button>
        </div>
      )}
      {projects.length === 0 && (
        <div className="info">
          Pour démarrer : renseigne ta société dans <Link to="/parametres">Paramètres</Link>, importe ton catalogue et tes contacts
          depuis Rentman dans <Link to="/import">Import</Link>, puis crée ton premier projet.
        </div>
      )}
    </>
  );
}
