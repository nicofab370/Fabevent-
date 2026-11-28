/**
 * Tâches : toutes les tâches (projets et tâches libres), avec personne chargée, échéance et priorité.
 * Filtres : période, personne, état. Les tâches en retard sont en rouge (et signalées par la cloche).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, PageHead } from '../components/ui';
import { Icon } from '../components/Icon';
import { inPreset, PeriodFilter } from '../components/PeriodFilter';
import { db } from '../db';
import { allTasks, relLabel, type TaskRow } from '../tasks';
import type { FreeTask, Task } from '../types';
import { fmtDate, patch, save } from '../utils';
import { useNames } from './project/GeneralTab';

export default function TasksPage() {
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const free = useLiveQuery(() => db.tasks.toArray(), []) || [];
  const names = useNames();
  const [period, setPeriod] = useState('');
  const [who, setWho] = useState('');
  const [state, setState] = useState<'todo' | 'done' | ''>('todo');
  const [text, setText] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const rows = allTasks(projects, free)
    .filter((r) => (!state || (state === 'done' ? r.task.done : !r.task.done)) && (!who || (who === '-' ? !r.task.assignee : r.task.assignee === who)) && (!period || inPreset(period, r.due, r.due)))
    .sort((a, b) => Number(a.task.done) - Number(b.task.done) || (a.due || '9').localeCompare(b.due || '9'));
  const late = rows.filter((r) => !r.task.done && r.due && r.due < today).length;

  const toggle = async (r: TaskRow, done: boolean) => {
    const upd = { done, doneAt: done ? new Date().toISOString() : undefined };
    if (r.free) await save(db.tasks, { ...(r.task as FreeTask), ...upd });
    else if (r.project) await patch(db.projects, r.project.id, { tasks: (r.project.tasks || []).map((t) => (t.id === r.task.id ? { ...t, ...upd } : t)) });
  };
  const remove = async (r: TaskRow) => {
    if (r.free) await db.tasks.delete(r.task.id);
    else if (r.project) await patch(db.projects, r.project.id, { tasks: (r.project.tasks || []).filter((t) => t.id !== r.task.id) });
  };

  return (
    <>
      <PageHead title="Tâches" />
      {late > 0 && <div className="warn-banner">{late} tâche(s) en retard.</div>}
      <div className="card">
        <div className="toolbar">
          <select value={state} onChange={(e) => setState(e.target.value as typeof state)} aria-label="État">
            <option value="todo">À faire</option><option value="done">Terminées</option><option value="">Toutes</option>
          </select>
          <PeriodFilter value={period} onChange={setPeriod} />
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Personne">
            <option value="">Tout le monde</option><option value="-">Sans personne</option>
            {Array.from(new Set([...names, ...allTasks(projects, free).map((r) => r.task.assignee).filter((x): x is string => !!x)])).sort().map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        {rows.length === 0 ? <Empty>Aucune tâche.</Empty> : (
          <table className="list">
            <thead><tr><th /><th>Tâche</th><th>Pour</th><th>Échéance</th><th>Projet / élément</th><th>Terminée le</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => {
                const t = r.task as Task & FreeTask;
                return (
                  <tr key={(r.project?.id || 'free') + t.id} className={t.done ? 'muted' : ''}>
                    <td><input type="checkbox" checked={t.done} aria-label={`Tâche terminée : ${t.text}`} onChange={(e) => toggle(r, e.target.checked)} /></td>
                    <td>{t.priority === 'haute' && <strong className="avail ko">! </strong>}{t.text}</td>
                    <td>{t.assignee || <span className="muted">tout le monde</span>}</td>
                    <td className={!t.done && r.due && r.due < today ? 'avail ko' : ''} title={relLabel(t)} data-sort={r.due || ''}>{r.due ? fmtDate(r.due, false) : '—'}</td>
                    <td>{r.project ? <Link to={'/projets/' + r.project.id}>{r.project.number} {r.project.name}</Link> : t.link ? <a href={'#' + t.link}>{t.linkLabel || 'ouvrir'}</a> : <span className="muted">—</span>}</td>
                    <td>{t.doneAt ? fmtDate(t.doneAt, false) : ''}</td>
                    <td><button className="ghost" aria-label="Supprimer la tâche" onClick={() => remove(r)}><Icon name="x" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <form className="toolbar" style={{ marginTop: 10 }} onSubmit={async (e) => {
          e.preventDefault();
          if (!text.trim()) return;
          await save(db.tasks, { text: text.trim(), done: false, due: due || undefined, assignee: assignee.trim() || undefined } as FreeTask);
          setText(''); setDue('');
        }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Nouvelle tâche hors projet (ex. Renouveler l'assurance)" aria-label="Nouvelle tâche" style={{ flex: 1 }} />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Échéance" style={{ width: 150 }} />
          <input list="tasks-names" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Pour" aria-label="Personne chargée" style={{ width: 160 }} />
          <datalist id="tasks-names">{names.map((n) => <option key={n} value={n} />)}</datalist>
          <button type="submit" className="small">+ Ajouter</button>
        </form>
      </div>
    </>
  );
}
