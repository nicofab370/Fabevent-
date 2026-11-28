import { db } from '../../db';
import type { ProjectStatus } from '../../types';
import { STATUS_LABELS } from '../../types';
import { patch, save } from '../../utils';
import type { ProjectData } from './shared';

/** Change le statut du projet et de ses salles ; « Terminé » sort les consommables du stock. */
export async function setProjectStatus(d: ProjectData, status: ProjectStatus) {
  const { project, subs, lines, eqMap } = d;
  await db.transaction('rw', [db.projects, db.subprojects, db.lines, db.equipment], async () => {
    await patch(db.projects, project.id, { status, ...(status === 'confirme' && !project.confirmedAt ? { confirmedAt: new Date().toISOString() } : {}) });
    for (const sp of subs) if (sp.status !== 'annule' || status === 'annule') await save(db.subprojects, { ...sp, status });
    if (status === 'termine') {
      for (const l of lines) {
        const e = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
        if (e?.kind === 'vente' && !l.consumed && !l.optional) {
          const fresh = await db.equipment.get(e.id);
          if (fresh) await save(db.equipment, { ...fresh, quantity: Math.max(0, fresh.quantity - (l.outQty ?? l.qty) + (l.inQty ?? 0)) });
          await save(db.lines, { ...l, consumed: true });
        }
      }
    }
  });
  if (status !== project.status) {
    const { notify } = await import('../../notify');
    await notify('statut', `statut:${project.id}:${status}:${Date.now()}`, `${project.number} ${project.name} : ${STATUS_LABELS[project.status]} → ${STATUS_LABELS[status]}.`, '/projets/' + project.id);
  }
}

/**
 * Statut automatique après un scan d'entrepôt :
 * premier article sorti → « En cours » ; tout est rentré → « Exécution terminée ».
 */
export async function warehouseStatus(subprojectId: string) {
  const sp = await db.subprojects.get(subprojectId);
  if (!sp || sp.status === 'annule' || sp.status === 'termine') return;
  const lines = (await db.lines.where({ subprojectId }).toArray()).filter((l) => l.equipmentId && !l.optional);
  const out = lines.reduce((a, l) => a + (l.outQty || 0), 0);
  if (!out) return;
  const allBack = lines.every((l) => (l.inQty || 0) >= (l.outQty || 0)) && lines.some((l) => (l.inQty || 0) > 0);
  const next: ProjectStatus = allBack ? 'execute' : 'en_cours';
  if (sp.status !== next) await patch(db.subprojects, sp.id, { status: next });
  const p = await db.projects.get(sp.projectId);
  if (!p || p.status === 'annule' || p.status === 'termine') return;
  const subs = (await db.subprojects.where({ projectId: p.id }).toArray()).filter((x) => x.status !== 'annule');
  const pStatus: ProjectStatus = subs.every((x) => x.status === 'execute' || x.status === 'termine') ? 'execute' : 'en_cours';
  if (p.status !== pStatus) await patch(db.projects, p.id, { status: pStatus });
}
