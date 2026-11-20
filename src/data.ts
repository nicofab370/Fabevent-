import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings } from './components/ui';
import { db, mainDepotId } from './db';
import { buildReservations, effectiveEquipment, findConflicts } from './utils';

/** Toutes les données nécessaires au calcul des disponibilités, en temps réel. */
export function useAvailability() {
  const settings = useSettings();
  const rawEquipment = useLiveQuery(() => db.equipment.orderBy('name').toArray(), []) || [];
  const units = useLiveQuery(() => db.units.toArray(), []) || [];
  const lines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const repairs = useLiveQuery(() => db.repairs.toArray(), []) || [];
  const subrentals = useLiveQuery(() => db.subrentals.toArray(), []) || [];
  const transfers = useLiveQuery(() => db.transfers.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const depotIds = (settings.depots || []).map((d) => d.id);
  const main = mainDepotId(settings);
  const equipment = effectiveEquipment(rawEquipment, units, depotIds);
  const projectDepots = new Map(projects.map((p) => [p.id, p.depotId && depotIds.includes(p.depotId) ? p.depotId : main]));
  const res = buildReservations(lines, subs, equipment, { repairs, subrentals, transfers, projectDepots, mainDepot: main, units });
  return {
    equipment, units, lines, subs, repairs, subrentals, transfers, res, depots: settings.depots || [], mainDepot: main, projectDepots,
    conflicts: () => findConflicts(res, equipment),
  };
}
