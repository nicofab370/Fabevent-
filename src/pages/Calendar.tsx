import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHead, useSettings } from '../components/ui';
import { appBaseUrl, db } from '../db';
import type { ProjectStatus } from '../types';
import { STATUS_LABELS } from '../types';
import { buildIcs, download } from '../utils';

const COLORS: Record<ProjectStatus, string> = {
  demande: '#c7d2fe', option: '#fde68a', confirme: '#86efac', en_cours: '#67e8f9', termine: '#d1d5db', annule: '#fecaca',
};
const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export default function Calendar() {
  const settings = useSettings();
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [hideCancelled, setHideCancelled] = useState(true);
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));

  const first = new Date(cursor);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first); start.setDate(1 - offset);
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const today = ymd(new Date());
  const visible = subs.filter((s) => !(hideCancelled && s.status === 'annule'));

  const exportAll = () => {
    const base = appBaseUrl(settings);
    const events = visible.map((s) => {
      const p = pMap.get(s.projectId);
      return {
        uid: s.id, title: `${p?.number || ''} ${p?.name || ''} — ${s.name} [${STATUS_LABELS[s.status]}]`, start: s.start, end: s.end,
        location: s.venue || p?.venue, url: `${base}#/projets/${s.projectId}`,
      };
    });
    download('fabevent-planning.ics', buildIcs('FabEvent — Planning', events), 'text/calendar;charset=utf-8');
  };

  return (
    <>
      <PageHead title="Planning">
        <button className="secondary" onClick={() => { const d = new Date(cursor); d.setMonth(d.getMonth() - 1); setCursor(d); }}>←</button>
        <strong style={{ minWidth: 140, textAlign: 'center' }}>{cursor.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</strong>
        <button className="secondary" onClick={() => { const d = new Date(cursor); d.setMonth(d.getMonth() + 1); setCursor(d); }}>→</button>
        <button className="secondary" onClick={() => { const d = new Date(); d.setDate(1); setCursor(d); }}>Aujourd'hui</button>
        <label className="check-row"><input type="checkbox" checked={hideCancelled} onChange={(e) => setHideCancelled(e.target.checked)} /> Masquer annulés</label>
        <button onClick={exportAll}>Exporter vers mon agenda (.ics)</button>
      </PageHead>
      <div className="cal">
        {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
        {days.map((d) => {
          const key = ymd(d);
          const evs = visible.filter((s) => s.start.slice(0, 10) <= key && s.end.slice(0, 10) >= key);
          return (
            <div key={key} className={'day' + (d.getMonth() !== cursor.getMonth() ? ' out' : '') + (key === today ? ' today' : '')}>
              <span className="num">{d.getDate()}</span>
              {evs.map((s) => {
                const p = pMap.get(s.projectId);
                return (
                  <Link key={s.id} to={'/projets/' + s.projectId} className="ev" style={{ background: COLORS[s.status] }} title={`${p?.name} — ${s.name}`}>
                    {p?.name} · {s.name}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
      <p className="muted">
        Chaque événement exporté contient un lien direct vers le projet. Avec le serveur de synchronisation (étape suivante),
        ce sera un abonnement qui se met à jour tout seul.
      </p>
    </>
  );
}
