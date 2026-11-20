import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import { buildReservations, effectiveEquipment, findConflicts } from './utils';

/** Toutes les données nécessaires au calcul des disponibilités, en temps réel. */
export function useAvailability() {
  const rawEquipment = useLiveQuery(() => db.equipment.orderBy('name').toArray(), []) || [];
  const units = useLiveQuery(() => db.units.toArray(), []) || [];
  const lines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const repairs = useLiveQuery(() => db.repairs.toArray(), []) || [];
  const subrentals = useLiveQuery(() => db.subrentals.toArray(), []) || [];
  const equipment = effectiveEquipment(rawEquipment, units);
  const res = buildReservations(lines, subs, equipment, { repairs, subrentals });
  return { equipment, units, lines, subs, repairs, subrentals, res, conflicts: () => findConflicts(res, equipment) };
}
