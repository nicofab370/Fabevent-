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
  const visible = subs.filter((s) => !(hideCancelled && s.status === 'annule') && !pMap.get(s.projectId)?.isTemplate);
  // un événement par créneau (montage, J1, J2, démontage…) ou par salle sans horaires
  const events = visible.flatMap((s) => (s.periods?.length ? s.periods : [{ id: s.id, name: '', kind: undefined, start: s.start, end: s.end }]).map((pe) => ({
    id: pe.id, sub: s, label: pe.name, kind: pe.kind, start: pe.start, end: pe.end,
  })));

  const exportAll = () => {
    const base = appBaseUrl(settings);
    const ics = events.map((ev) => {
      const p = pMap.get(ev.sub.projectId);
      return {
        uid: ev.id, title: `${p?.name || ''} — ${ev.sub.name}${ev.label ? ` · ${ev.label}` : ''} [${STATUS_LABELS[ev.sub.status]}]`, start: ev.start, end: ev.end,
        location: ev.sub.venue || p?.venue, description: p?.number, url: `${base}#/projets/${ev.sub.projectId}`,
      };
    });
    download('fabevent-planning.ics', buildIcs('FabEvent — Planning', ics), 'text/calendar;charset=utf-8');
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
          const evs = events.filter((ev) => ev.start.slice(0, 10) <= key && ev.end.slice(0, 10) >= key);
          return (
            <div key={key} className={'day' + (d.getMonth() !== cursor.getMonth() ? ' out' : '') + (key === today ? ' today' : '')}>
              <span className="num">{d.getDate()}</span>
              {evs.map((ev) => {
                const p = pMap.get(ev.sub.projectId);
                const time = ev.start.slice(0, 10) === key ? ev.start.slice(11, 16) + ' ' : '';
                return (
                  <Link key={ev.id} to={'/projets/' + ev.sub.projectId} className={'ev' + (ev.kind ? ' k-' + ev.kind : '')} style={{ background: COLORS[ev.sub.status] }}
                    title={`${p?.name} — ${ev.sub.name}${ev.label ? ' · ' + ev.label : ''} (${ev.start.slice(11, 16)}–${ev.end.slice(11, 16)})`}>
                    {time}{p?.name} · {ev.sub.name}{ev.label ? ` · ${ev.label}` : ''}
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
