/**
 * Cloche des notifications (barre latérale et barre du haut sur téléphone) et page « Toutes les notifications ».
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../db';
import { markAllRead } from '../notify';
import type { Notification } from '../types';
import { NOTIF_LABELS } from '../types';
import { Empty, PageHead } from './ui';
import { Icon } from './Icon';

/** « il y a 34 minutes », « hier », « le 12/11 » */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 60) return 'à l’instant';
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} minute${m > 1 ? 's' : ''}`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} heure${h > 1 ? 's' : ''}`;
  const d = Math.round(h / 24);
  if (d === 1) return 'hier';
  if (d < 7) return `il y a ${d} jours`;
  return 'le ' + new Date(iso).toLocaleDateString('fr-BE', { day: '2-digit', month: '2-digit', year: d > 300 ? '2-digit' : undefined });
}

function Row({ n, onOpen }: { n: Notification; onOpen: () => void }) {
  return (
    <li className={'notif' + (n.read ? '' : ' unread')}>
      <button type="button" className="notif-open" onClick={onOpen}>
        <strong>{n.title}</strong>{!n.read && <span className="badge-new">Nouveau</span>}
        <span className="notif-text">{n.text}</span>
        <span className="muted notif-when">{ago(n.createdAt)}{n.emailedAt ? ' · envoyée par email' : ''}</span>
      </button>
    </li>
  );
}

export function NotificationBell({ compact }: { compact?: boolean }) {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const list = useLiveQuery(() => db.notifications.orderBy('createdAt').reverse().limit(15).toArray(), []) || [];
  const unread = useLiveQuery(() => db.notifications.filter((n) => !n.read).count(), []) || 0;
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const go = async (n: Notification) => {
    await db.notifications.update(n.id, { read: true });
    setOpen(false);
    if (n.link) nav(n.link);
  };
  return (
    <div className={'bell' + (compact ? ' compact' : '')} ref={ref}>
      <button type="button" className="ghost bell-btn" aria-label={`Notifications${unread ? ` (${unread} non lues)` : ''}`} title="Notifications" onClick={() => setOpen(!open)}>
        <Icon name="bell" />{!compact && <span>Notifications</span>}{unread > 0 && <span className="nav-badge">{unread}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label="Notifications">
          <div className="bell-head">
            <strong>Notifications</strong>
            <button type="button" className="secondary small" disabled={!unread} onClick={() => markAllRead()}>Tout marquer comme lu</button>
          </div>
          {list.length ? <ul className="notif-list">{list.map((n) => <Row key={n.id} n={n} onOpen={() => go(n)} />)}</ul> : <p className="muted" style={{ padding: 12 }}>Aucune notification.</p>}
          <div className="bell-foot"><Link to="/notifications" onClick={() => setOpen(false)}>Toutes les notifications</Link> · <Link to="/parametres?onglet=notifications" onClick={() => setOpen(false)}>Réglages</Link></div>
        </div>
      )}
    </div>
  );
}

export default function NotificationsPage() {
  const nav = useNavigate();
  const [kind, setKind] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const all = useLiveQuery(() => db.notifications.orderBy('createdAt').reverse().toArray(), []) || [];
  const list = all.filter((n) => (!kind || n.kind === kind) && (!onlyUnread || !n.read));
  return (
    <>
      <PageHead title="Notifications">
        <button className="secondary" onClick={() => markAllRead()}>Tout marquer comme lu</button>
        <button className="secondary" onClick={() => { if (confirm('Supprimer les notifications déjà lues ?')) void db.notifications.filter((n) => !!n.read).delete(); }}>Supprimer les lues</button>
      </PageHead>
      <div className="toolbar">
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
          <option value="">Tous les types</option>
          {Object.entries(NOTIF_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="check-row"><input type="checkbox" checked={onlyUnread} onChange={(e) => setOnlyUnread(e.target.checked)} /> Non lues seulement</label>
      </div>
      {list.length ? (
        <div className="card"><ul className="notif-list">{list.map((n) => <Row key={n.id} n={n} onOpen={async () => { await db.notifications.update(n.id, { read: true }); if (n.link) nav(n.link); }} />)}</ul></div>
      ) : <Empty>Aucune notification.</Empty>}
    </>
  );
}
