import { db } from '../../db';
import type { ProjectStatus } from '../../types';
import { save } from '../../utils';
import type { ProjectData } from './shared';

/** Change le statut du projet et de ses salles ; « Terminé » sort les consommables du stock. */
export async function setProjectStatus(d: ProjectData, status: ProjectStatus) {
  const { project, subs, lines, eqMap } = d;
  await db.transaction('rw', [db.projects, db.subprojects, db.lines, db.equipment], async () => {
    await save(db.projects, { ...project, status });
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
}
