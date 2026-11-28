/**
 * Emails envoyés depuis FabEvent (registre de communication) : date, destinataires, sujet, document lié, résultat.
 * Aussi en section dans les fiches (contact, technicien, projet) via <MailHistory>.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, PageHead } from '../components/ui';
import { inPreset, PeriodFilter } from '../components/PeriodFilter';
import { db } from '../db';
import { MAIL_KINDS } from '../mailer';
import type { MailLog } from '../types';
import { fmtDate } from '../utils';

function Rows({ list, compact }: { list: MailLog[]; compact?: boolean }) {
  return (
    <table className="list">
      <thead><tr><th>Date</th><th>Destinataires</th><th>Sujet</th>{!compact && <th>Type</th>}<th>Lié à</th><th>Résultat</th></tr></thead>
      <tbody>{list.map((m) => (
        <tr key={m.id}>
          <td className="nowrap" data-sort={m.createdAt}>{fmtDate(m.createdAt)}</td>
          <td>{m.to.join(', ')}{m.cc?.length ? <div className="muted">cc {m.cc.join(', ')}</div> : null}</td>
          <td>{m.subject}{m.attachments?.length ? <div className="muted" style={{ fontSize: 12 }}>{m.attachments.join(', ')}</div> : null}</td>
          {!compact && <td>{(m.kind && (MAIL_KINDS as Record<string, string>)[m.kind]) || m.kind || '—'}</td>}
          <td>{m.docId ? <Link to={'/documents/' + m.docId}>document</Link> : m.projectId ? <Link to={'/projets/' + m.projectId}>projet</Link> : '—'}</td>
          <td>{m.ok ? <span className="avail ok">envoyé</span> : <span className="avail ko" title={m.error}>échec</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );
}

/** Derniers mails liés à un contact, un technicien ou un projet. */
export function MailHistory({ contactId, personId, projectId, email }: { contactId?: string; personId?: string; projectId?: string; email?: string }) {
  const list = useLiveQuery(async () => (await db.mails.orderBy('createdAt').reverse().toArray())
    .filter((m) => (contactId && m.contactId === contactId) || (personId && m.personId === personId) || (projectId && m.projectId === projectId) || (email && m.to.includes(email)))
    .slice(0, 20), [contactId, personId, projectId, email]) || [];
  if (!list.length) return null;
  return <div className="card"><h2>Communication ({list.length})</h2><Rows list={list} compact /></div>;
}

export default function EmailsPage() {
  const all = useLiveQuery(() => db.mails.orderBy('createdAt').reverse().toArray(), []) || [];
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState('');
  const [failed, setFailed] = useState(false);
  const list = all.filter((m) => (!failed || !m.ok) && inPreset(period, m.createdAt, m.createdAt) && (!q || [m.subject, ...m.to, ...(m.cc || [])].join(' ').toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <PageHead title="Emails envoyés" />
      <div className="card">
        <div className="toolbar">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher (sujet, destinataire)…" aria-label="Rechercher" />
          <PeriodFilter value={period} onChange={setPeriod} />
          <label className="check-row"><input type="checkbox" checked={failed} onChange={(e) => setFailed(e.target.checked)} /> Échecs seulement</label>
        </div>
        {list.length ? <Rows list={list} /> : <Empty>Aucun email envoyé depuis FabEvent{q || period || failed ? ' avec ces filtres' : ''}.</Empty>}
      </div>
    </>
  );
}
