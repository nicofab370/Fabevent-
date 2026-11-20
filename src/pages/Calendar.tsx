import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Field, Modal, PageHead, useSettings } from '../components/ui';
import { appBaseUrl, db } from '../db';
import type { Appointment, Person, ProjectStatus } from '../types';
import { STATUS_LABELS } from '../types';
import { buildIcs, download, save, toLocalInput } from '../utils';

const COLORS: Record<ProjectStatus, string> = {
  demande: '#c7d2fe', brouillon: '#e9d5ff', option: '#fde68a', confirme: '#86efac', en_cours: '#67e8f9', execute: '#a5b4fc', termine: '#d1d5db', annule: '#fecaca',
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
  const appointments = useLiveQuery(() => db.appointments.toArray(), []) || [];
  const people = useLiveQuery(() => db.people.orderBy('name').toArray(), []) || [];
  const [appt, setAppt] = useState<Partial<Appointment> | null>(null);
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
    for (const a of appointments) ics.push({ uid: a.id, title: a.title, start: a.start, end: a.end, location: a.location, description: a.notes, url: `${base}#/planning` });
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
        <button className="secondary" onClick={() => { const d = new Date(); d.setHours(9, 0, 0, 0); const e = new Date(d); e.setHours(11); setAppt({ title: '', start: toLocalInput(d), end: toLocalInput(e), personIds: [] }); }}>+ Rendez-vous</button>
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
              {appointments.filter((a) => a.start.slice(0, 10) <= key && a.end.slice(0, 10) >= key).map((a) => (
                <a key={a.id} href="#" className="ev appt" title={`${a.title}${a.location ? ' — ' + a.location : ''}`} onClick={(e) => { e.preventDefault(); setAppt(a); }}>
                  {a.start.slice(0, 10) === key ? a.start.slice(11, 16) + ' ' : ''}{a.title}
                </a>
              ))}
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
      {appt && <AppointmentModal appt={appt} people={people} onClose={() => setAppt(null)} />}
      <p className="muted">
        Chaque événement exporté contient un lien direct vers le projet. Avec le serveur de synchronisation (étape suivante),
        ce sera un abonnement qui se met à jour tout seul.
      </p>
    </>
  );
}

/** Rendez-vous hors projet (repérage, réunion…) ; ses participants deviennent indisponibles. */
function AppointmentModal({ appt, people, onClose }: { appt: Partial<Appointment>; people: Person[]; onClose: () => void }) {
  const [a, setA] = useState(appt);
  const ids = a.personIds || [];
  return (
    <Modal title={a.id ? 'Rendez-vous' : 'Nouveau rendez-vous'} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        if ((a.end || '') < (a.start || '')) return alert('La fin doit être après le début.');
        await save(db.appointments, a as Appointment);
        onClose();
      }}>
        <Field label="Objet *" full><input required autoFocus value={a.title || ''} onChange={(e) => setA({ ...a, title: e.target.value })} placeholder="ex. Repérage technique, réunion de production" /></Field>
        <Field label="Début"><input type="datetime-local" value={a.start} onChange={(e) => setA({ ...a, start: e.target.value })} /></Field>
        <Field label="Fin"><input type="datetime-local" value={a.end} onChange={(e) => setA({ ...a, end: e.target.value })} /></Field>
        <Field label="Lieu" full><input value={a.location || ''} onChange={(e) => setA({ ...a, location: e.target.value })} /></Field>
        <div className="field full">
          <span>Participants (indisponibles pendant le rendez-vous)</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {people.map((p) => (
              <label key={p.id} className="check-row"><input type="checkbox" checked={ids.includes(p.id)} onChange={(e) => setA({ ...a, personIds: e.target.checked ? [...ids, p.id] : ids.filter((x) => x !== p.id) })} /> {p.name}</label>
            ))}
          </div>
        </div>
        <Field label="Notes" full><textarea value={a.notes || ''} onChange={(e) => setA({ ...a, notes: e.target.value })} /></Field>
        <div className="form-actions">
          {a.id && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={async () => { await db.appointments.delete(a.id!); onClose(); }}>Supprimer</button>}
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}
