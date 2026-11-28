import { useLiveQuery } from 'dexie-react-hooks';
import { useAvailability } from './data';
import { db } from './db';
import { useOverdue } from './pages/Overdue';
import { upcomingShortages, useConsumablesToBuy } from './pages/Shortages';
import { RESERVING } from './types';
import { inspectionsDue, toLocalInput } from './utils';

interface Alerts { penuries: number; enRetard: number; controles: number; postes: number }

/**
 * Compteurs d'alertes pour les badges du menu :
 * manques réels à venir, factures en retard, contrôles périodiques à faire (30 j),
 * postes prévus sans technicien sur les projets actifs.
 */
export function useAlerts(): Alerts {
  const av = useAvailability();
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const inspections = useLiveQuery(() => db.inspections.toArray(), []) || [];
  const now = toLocalInput(new Date());
  const in30 = toLocalInput(new Date(Date.now() + 30 * 86400000)).slice(0, 10);
  const toBuy = useConsumablesToBuy().length;
  const penuries = toBuy + upcomingShortages(av.conflicts(), now).filter((c) => c.level === 'ferme' && !projects.find((p) => p.id === c.projectId)?.isTemplate).length;
  const enRetard = useOverdue().length;
  const subOk = new Set(av.subs.filter((s) => RESERVING.includes(s.status)).map((s) => s.id));
  const postes = crew.filter((c) => !c.personId && subOk.has(c.subprojectId)).length;
  const controles = inspectionsDue(av.equipment, av.units, inspections).filter((d) => d.due <= in30).length;
  return { penuries, enRetard, controles, postes };
}
