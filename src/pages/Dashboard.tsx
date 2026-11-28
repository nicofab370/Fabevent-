import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type ReactNode } from 'react';
import { allTasks } from '../tasks';
import type { Doc } from '../types';
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

type WidgetId = 'stats' | 'manques' | 'prestations' | 'documents' | 'finances' | 'revenus' | 'agenda' | 'taches' | 'notifications';
const WIDGET_LABELS: Record<WidgetId, string> = {
  stats: 'Chiffres clés', manques: 'Manques de matériel', prestations: 'Prochaines prestations', documents: 'Derniers documents',
  finances: 'Factures en attente et devis en suspens', revenus: 'Chiffre d\'affaires par mois', agenda: 'Mon agenda (aujourd\'hui, demain)',
  taches: 'Tâches à faire', notifications: 'Dernières notifications',
};
interface Board { name: string; widgets: WidgetId[] }
const DEFAULT_BOARDS: Board[] = [
  { name: 'Mon tableau de bord', widgets: ['stats', 'manques', 'agenda', 'taches', 'prestations', 'documents'] },
  { name: 'Mes finances', widgets: ['finances', 'revenus', 'documents'] },
];
const boardsKey = () => 'fab.dashboards.' + currentWorkspace();
function loadBoards(): Board[] {
  try { const v = JSON.parse(localStorage.getItem(boardsKey()) || 'null'); if (Array.isArray(v) && v.length) return v; } catch { /* sans stockage */ }
  return DEFAULT_BOARDS;
}

function FinanceWidget() {
  const nav = useNavigate();
  const docs = useLiveQuery(() => db.docs.toArray(), []) || [];
  const [days, setDays] = useState(30);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const unpaid = docs.filter((d) => (d.type === 'facture' || d.type === 'acompte') && d.status !== 'paye' && d.status !== 'brouillon');
  const due = (d: Doc) => d.snapshot.totalTTC - (d.snapshot.deposits || []).reduce((a, x) => a + x.ttc, 0) - (d.payments || []).reduce((a, x) => a + x.amount, 0);
  const quotes = docs.filter((d) => d.type === 'devis' && d.status === 'envoye' && d.createdAt >= since);
  return (
    <div className="card">
      <h2>Finances <select value={days} onChange={(e) => setDays(Number(e.target.value))} aria-label="Période des devis" style={{ width: 'auto', fontSize: 13 }}><option value={7}>7 jours</option><option value={30}>30 jours</option><option value={90}>90 jours</option><option value={365}>1 an</option></select></h2>
      <div className="stats">
        <div className="stat click" onClick={() => nav('/comptabilite')}><b>{money(unpaid.reduce((a, d) => a + due(d), 0))}</b><span>{unpaid.length} facture(s) en attente de paiement</span></div>
        <div className="stat"><b>{money(quotes.reduce((a, d) => a + d.snapshot.totalHT, 0))}</b><span>{quotes.length} devis en suspens (HT)</span></div>
      </div>
      {quotes.length > 0 && <table className="list"><tbody>{quotes.slice(0, 6).map((d) => <tr key={d.id} className="click" onClick={() => nav('/documents/' + d.id)}><td>{d.number}</td><td>{d.snapshot.project.name}</td><td className="n">{money(d.snapshot.totalHT)}</td></tr>)}</tbody></table>}
    </div>
  );
}

function RevenueWidget() {
  const docs = useLiveQuery(() => db.docs.where('type').anyOf('facture', 'acompte', 'avoir').toArray(), []) || [];
  const months = Array.from({ length: 12 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 11 + i); return d.toISOString().slice(0, 7); });
  const by = new Map(months.map((m) => [m, 0]));
  for (const d of docs) { const m = d.snapshot.issuedAt.slice(0, 7); if (by.has(m)) by.set(m, by.get(m)! + (d.type === 'avoir' ? -Math.abs(d.snapshot.totalHT) : d.snapshot.totalHT)); }
  const max = Math.max(1, ...by.values());
  return (
    <div className="card">
      <h2>Chiffre d'affaires facturé (HT, 12 mois)</h2>
      <div className="rev-bars" role="img" aria-label="Chiffre d'affaires par mois">
        {months.map((m) => (
          <div key={m} className="rev-bar" title={`${m} : ${money(by.get(m)!)}`}>
            <span style={{ height: `${Math.max(2, (by.get(m)! / max) * 100)}%` }} />
            <small>{m.slice(5)}</small>
          </div>
        ))}
      </div>
      <p className="muted" style={{ marginBottom: 0 }}>Total : {money([...by.values()].reduce((a, x) => a + x, 0))}</p>
    </div>
  );
}

function AgendaWidget() {
  const nav = useNavigate();
  const [day, setDay] = useState<0 | 1>(0);
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const appts = useLiveQuery(() => db.appointments.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const d = new Date(Date.now() + day * 86400000);
  const key = toLocalInput(d).slice(0, 10);
  const posts = crew.filter((c) => c.start.slice(0, 10) <= key && c.end.slice(0, 10) >= key);
  const byProject = new Map<string, number>();
  for (const c of posts) byProject.set(c.projectId, (byProject.get(c.projectId) || 0) + 1);
  const meetings = appts.filter((a) => a.start.slice(0, 10) <= key && a.end.slice(0, 10) >= key);
  return (
    <div className="card">
      <h2>Agenda <span className="tabs inline"><button className={day === 0 ? 'on' : ''} onClick={() => setDay(0)}>Aujourd'hui</button><button className={day === 1 ? 'on' : ''} onClick={() => setDay(1)}>Demain</button></span></h2>
      {!byProject.size && !meetings.length ? <Empty>Rien de prévu.</Empty> : (
        <table className="list"><tbody>
          {[...byProject].map(([pid, n]) => <tr key={pid} className="click" onClick={() => nav('/projets/' + pid)}><td><strong>{pMap.get(pid)?.name}</strong></td><td>{n} poste(s)</td></tr>)}
          {meetings.map((a) => <tr key={a.id}><td>{a.title}</td><td>{fmtRange(a.start, a.end)}</td></tr>)}
        </tbody></table>
      )}
    </div>
  );
}

function TasksWidget() {
  const nav = useNavigate();
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const free = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const today = new Date().toISOString().slice(0, 10);
  const rows = allTasks(projects, free).filter((r) => !r.task.done).sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 8);
  return (
    <div className="card">
      <h2>Tâches <button className="secondary small" onClick={() => nav('/taches')}>Tout voir</button></h2>
      {!rows.length ? <Empty>Aucune tâche à faire.</Empty> : (
        <table className="list"><tbody>{rows.map((r) => (
          <tr key={(r.project?.id || '') + r.task.id} className="click" onClick={() => nav(r.project ? '/projets/' + r.project.id : '/taches')}>
            <td>{r.task.text}<div className="muted">{r.project?.name}{r.task.assignee ? ` · ${r.task.assignee}` : ''}</div></td>
            <td className={r.due && r.due < today ? 'avail ko' : 'muted'}>{r.due ? fmtDate(r.due, false) : ''}</td>
          </tr>
        ))}</tbody></table>
      )}
    </div>
  );
}

function NotifWidget() {
  const nav = useNavigate();
  const list = useLiveQuery(() => db.notifications.orderBy('createdAt').reverse().limit(6).toArray(), []) || [];
  return (
    <div className="card">
      <h2>Notifications <button className="secondary small" onClick={() => nav('/notifications')}>Tout voir</button></h2>
      {!list.length ? <Empty>Aucune notification.</Empty> : <ul className="notif-list">{list.map((n) => <li key={n.id} className={'notif' + (n.read ? '' : ' unread')}><button type="button" className="notif-open" onClick={() => n.link && nav(n.link)}><strong>{n.title}</strong><span className="notif-text">{n.text}</span></button></li>)}</ul>}
    </div>
  );
}

export default function Dashboard() {
  const nav = useNavigate();
  const [boards, setBoards] = useState<Board[]>(loadBoards);
  const [active, setActive] = useState(0);
  const [editing, setEditing] = useState(false);
  const saveBoards = (b: Board[]) => { setBoards(b); try { localStorage.setItem(boardsKey(), JSON.stringify(b)); } catch { /* sans stockage */ } };
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

  const widgets: Record<WidgetId, () => ReactNode> = {
    stats: () => (
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

    ),
    manques: () => (<>
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

    </>),
    prestations: () => (
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
    ),
    documents: () => (
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
    ),
    finances: () => <FinanceWidget />,
    revenus: () => <RevenueWidget />,
    agenda: () => <AgendaWidget />,
    taches: () => <TasksWidget />,
    notifications: () => <NotifWidget />,
  };
  const board = boards[active] || boards[0];
  const move = (i: number, dir: -1 | 1) => { const w = [...board.widgets]; const j = i + dir; if (j < 0 || j >= w.length) return; [w[i], w[j]] = [w[j], w[i]]; saveBoards(boards.map((b, k) => (k === active ? { ...b, widgets: w } : b))); };
  return (
    <>
      <PageHead title="Tableau de bord">
        <button className="secondary" onClick={() => setEditing(!editing)}>{editing ? 'Terminer' : 'Ajuster la mise en page'}</button>
        <button onClick={() => nav('/projets')}>Projets</button>
      </PageHead>
      <div className="tabs" role="tablist">
        {boards.map((b, i) => <button key={i} role="tab" className={i === active ? 'on' : ''} onClick={() => setActive(i)}>{b.name}</button>)}
        <button className="ghost small" onClick={() => { const name = prompt('Nom du tableau de bord :', 'Nouveau tableau de bord')?.trim(); if (name) { saveBoards([...boards, { name, widgets: ['stats'] }]); setActive(boards.length); } }}>+ Nouveau tableau de bord</button>
      </div>
      {editing && (
        <div className="card dash-edit">
          <h2>Widgets de « {board.name} »</h2>
          <ul className="dash-list">
            {board.widgets.map((w, i) => (
              <li key={w}><strong>{WIDGET_LABELS[w]}</strong>
                <button type="button" className="ghost small" aria-label={`Monter ${WIDGET_LABELS[w]}`} disabled={i === 0} onClick={() => move(i, -1)}><Icon name="arrow-up" /></button>
                <button type="button" className="ghost small" aria-label={`Descendre ${WIDGET_LABELS[w]}`} disabled={i === board.widgets.length - 1} onClick={() => move(i, 1)}><Icon name="arrow-down" /></button>
                <button type="button" className="ghost small" onClick={() => saveBoards(boards.map((b, k) => (k === active ? { ...b, widgets: b.widgets.filter((x) => x !== w) } : b)))}>Retirer</button>
              </li>
            ))}
          </ul>
          <div className="chips">
            {(Object.keys(WIDGET_LABELS) as WidgetId[]).filter((w) => !board.widgets.includes(w)).map((w) => (
              <button key={w} type="button" className="secondary small" onClick={() => saveBoards(boards.map((b, k) => (k === active ? { ...b, widgets: [...b.widgets, w] } : b)))}>+ {WIDGET_LABELS[w]}</button>
            ))}
          </div>
          <div className="toolbar" style={{ marginTop: 8 }}>
            <button type="button" className="ghost small" onClick={() => { const name = prompt('Nouveau nom :', board.name)?.trim(); if (name) saveBoards(boards.map((b, k) => (k === active ? { ...b, name } : b))); }}>Renommer</button>
            {boards.length > 1 && <button type="button" className="ghost small" onClick={() => { if (confirm(`Supprimer « ${board.name} » ?`)) { saveBoards(boards.filter((_, k) => k !== active)); setActive(0); } }}>Supprimer ce tableau de bord</button>}
            <button type="button" className="ghost small" onClick={() => { saveBoards(DEFAULT_BOARDS); setActive(0); }}>Revenir aux tableaux par défaut</button>
          </div>
        </div>
      )}
      <div className="dash-widgets">
        {board.widgets.map((w) => <div key={w} className={'dash-w w-' + w}>{widgets[w]?.()}</div>)}
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
