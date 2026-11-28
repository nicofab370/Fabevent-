/** Tâches : échéance (fixe ou relative aux dates du projet) et liste commune (projets + tâches libres). */
import type { FreeTask, Project, Task } from './types';

/** Échéance d'une tâche (AAAA-MM-JJ) : relative au début / à la fin du projet si demandé. */
export function dueOf(t: Task, p?: Pick<Project, 'start' | 'end'>): string | undefined {
  if (t.rel && p) {
    const base = (t.rel.base === 'end' ? p.end : p.start)?.slice(0, 10);
    if (base) return new Date(Date.parse(base + 'T12:00') + t.rel.days * 86400000).toISOString().slice(0, 10);
  }
  return t.due?.slice(0, 10);
}

export interface TaskRow { task: Task | FreeTask; project?: Project; due?: string; free: boolean }

/** Toutes les tâches : celles des projets (hors modèles et projets annulés) et les tâches libres. */
export function allTasks(projects: Project[], free: FreeTask[]): TaskRow[] {
  const rows: TaskRow[] = [];
  for (const p of projects) {
    if (p.isTemplate || p.status === 'annule') continue;
    for (const t of p.tasks || []) rows.push({ task: t, project: p, due: dueOf(t, p), free: false });
  }
  for (const t of free) rows.push({ task: t, due: dueOf(t), free: true });
  return rows;
}

export const relLabel = (t: Task) => (t.rel ? `${Math.abs(t.rel.days)} j ${t.rel.days < 0 ? 'avant' : 'après'} ${t.rel.base === 'end' ? 'la fin' : 'le début'}` : '');
