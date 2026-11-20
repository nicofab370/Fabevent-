import { useLiveQuery } from 'dexie-react-hooks';
import { useSettings } from '../../components/ui';
import { useAvailability } from '../../data';
import { db } from '../../db';
import type { CrewAssignment, Equipment, EquipmentLine, Person, Project, ProjectCost, Settings, Subproject, Unavailability, VehicleAssignment } from '../../types';
import { INVOICE_TYPES, RESERVING } from '../../types';
import { crewAmount, lineDays, lineTotal, overlaps, round2, save } from '../../utils';
import { tripKm, vehiclePrice } from '../../geo';

/** Toutes les données d'un projet, en temps réel, partagées par les onglets. */
export function useProjectData(id: string) {
  const settings = useSettings();
  const av = useAvailability();
  const project = useLiveQuery(() => db.projects.get(id), [id]);
  const client = useLiveQuery(() => (project?.clientId ? db.contacts.get(project.clientId) : undefined), [project?.clientId]);
  const subs = useLiveQuery(() => db.subprojects.where({ projectId: id }).sortBy('order'), [id]) || [];
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const people = useLiveQuery(() => db.people.orderBy('name').toArray(), []) || [];
  const unav = useLiveQuery(() => db.unavailability.toArray(), []) || [];
  const vehicles = useLiveQuery(() => db.vehicles.orderBy('name').toArray(), []) || [];
  const vas = useLiveQuery(() => db.vehicleAssignments.toArray(), []) || [];
  const docs = useLiveQuery(() => db.docs.where({ projectId: id }).reverse().sortBy('createdAt'), [id]) || [];
  const costs = useLiveQuery(() => db.costs.where({ projectId: id }).toArray(), [id]) || [];
  const contacts = useLiveQuery(() => db.contacts.orderBy('company').toArray(), []) || [];

  const eqMap = new Map(av.equipment.map((e) => [e.id, e]));
  const lines = av.lines.filter((l) => l.projectId === id);
  const conflicts = av.conflicts().filter((c) => c.projectId === id);
  const subrentals = av.subrentals.filter((s) => s.projectId === id);
  const projectCrew = crew.filter((c) => c.projectId === id);
  const projectVas = vas.filter((v) => v.projectId === id);
  const finance = project
    ? computeFinance(project, subs, lines, projectCrew, projectVas, costs, people, eqMap, settings,
      subrentals.filter((s) => s.status !== 'annule').reduce((a, s) => a + s.lines.reduce((b, l) => b + l.cost, 0), 0))
    : null;
  const depotId = project ? av.projectDepots.get(project.id) : undefined;
  /** dépôt du projet pour les disponibilités (undefined si un seul dépôt) */
  const depot = av.depots.length > 1 ? depotId : undefined;
  return {
    settings, av, project, client, depot, subs, crew, projectCrew, people, unav, vehicles, vas, projectVas, docs, costs, contacts,
    eqMap, lines, conflicts, subrentals, finance,
  };
}

export type ProjectData = ReturnType<typeof useProjectData> & { project: Project; finance: Finance };

export function isPerPiece(l: EquipmentLine, eqMap: Map<string, Equipment>) {
  return !!l.equipmentId && eqMap.get(l.equipmentId)?.kind === 'vente';
}

export interface Finance {
  rows: { label: string; revenue: number; cost: number }[];
  gross: number;
  discount: number;
  totalHT: number;
  vat: number;
  totalTTC: number;
  cost: number;
  margin: number;
  invoicedHT: number;
}

/** Chiffre d'affaires et coûts par catégorie (onglet Finances). */
export function computeFinance(
  project: Project, subs: Subproject[], lines: EquipmentLine[], crew: CrewAssignment[], vas: VehicleAssignment[], costs: ProjectCost[],
  people: Person[], eqMap: Map<string, Equipment>, s: Settings, subrentCost: number,
): Finance {
  const active = new Map(subs.filter((x) => x.status !== 'annule').map((x) => [x.id, x]));
  const pMap = new Map(people.map((p) => [p.id, p]));
  let eqRev = 0, consCost = 0;
  for (const l of lines) {
    const sp = active.get(l.subprojectId);
    if (!sp || l.optional) continue;
    eqRev += lineTotal(l, lineDays(l, sp), s, isPerPiece(l, eqMap));
    if (isPerPiece(l, eqMap)) consCost += l.qty * (eqMap.get(l.equipmentId!)?.costPrice || 0);
  }
  let crewRev = 0, crewCost = 0;
  for (const c of crew) {
    if (!active.has(c.subprojectId)) continue;
    const a = crewAmount(c, s, project.travelMinutes, (c.personId ? (c.rateUnit === 'heure' ? pMap.get(c.personId)?.hourlyCost : pMap.get(c.personId)?.costRate) : undefined) ?? 0);
    if (c.billable) crewRev += a.billed;
    crewCost += a.cost;
  }
  const vehRev = vas.filter((v) => active.has(v.subprojectId) && v.billable).reduce((a, v) => a + v.price, 0);
  const extraRev = costs.filter((c) => c.billable && c.price).reduce((a, c) => a + (c.qty || 1) * (c.price || 0), 0);
  const extraCost = costs.reduce((a, c) => a + (c.amount || 0), 0);
  const rows = [
    { label: 'Matériel', revenue: round2(eqRev), cost: round2(consCost + subrentCost) },
    { label: 'Personnel', revenue: round2(crewRev), cost: round2(crewCost) },
    { label: 'Transport', revenue: round2(vehRev), cost: 0 },
    { label: 'Frais supplémentaires', revenue: round2(extraRev), cost: round2(extraCost) },
  ];
  const gross = round2(rows.reduce((a, r) => a + r.revenue, 0));
  const discount = round2(gross * (project.discount || 0) / 100);
  const totalHT = round2(gross - discount);
  const vat = round2(totalHT * s.vatRate / 100);
  const cost = round2(rows.reduce((a, r) => a + r.cost, 0));
  return { rows, gross, discount, totalHT, vat, totalTTC: round2(totalHT + vat), cost, margin: round2(totalHT - cost), invoicedHT: 0 };
}

export function invoicedHT(docs: { type: string; number: string; snapshot: { totalHT: number; deposits?: { number: string }[] } }[]) {
  const deducted = new Set(docs.flatMap((d) => (d.snapshot.deposits || []).map((x) => x.number)));
  return round2(docs.filter((d) => INVOICE_TYPES.includes(d.type as never) && !(d.type === 'acompte' && deducted.has(d.number))).reduce((a, d) => a + d.snapshot.totalHT, 0));
}

/** Motif d'indisponibilité d'une personne sur un créneau (ou ''). */
export function personIssue(personId: string | undefined, start: string, end: string, selfId: string, allCrew: CrewAssignment[], subs: Subproject[], unav: Unavailability[]) {
  if (!personId) return '';
  if (unav.some((u) => u.personId === personId && overlaps(u.start, u.end, start, end))) return 'indisponible';
  const subMap = new Map(subs.map((s) => [s.id, s]));
  if (allCrew.some((o) => o.id !== selfId && o.personId === personId && RESERVING.includes(subMap.get(o.subprojectId)?.status || 'annule') && overlaps(o.start, o.end, start, end))) return 'déjà planifié';
  return '';
}

/** Ouvre un document HTML imprimable dans une nouvelle fenêtre. */
export function printHtml(title: string, body: string, css: string) {
  const w = window.open('', '_blank');
  if (!w) return alert('Autorise les fenêtres pop-up pour imprimer.');
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0}${css}</style></head><body>${body}</body></html>`);
  w.document.close();
  setTimeout(() => w.print(), 300);
}

/** Met à jour la distance du projet et recalcule les transports dont les km ne sont pas saisis à la main. */
export async function setProjectDistance(d: ProjectData, distanceKm: number | undefined, travelMinutes?: number) {
  await save(db.projects, { ...d.project, distanceKm, travelMinutes });
  const vMap = new Map(d.vehicles.map((v) => [v.id, v]));
  for (const va of d.projectVas) {
    if (va.kmManual) continue;
    const km = tripKm(distanceKm, va.trips ?? d.settings.defaultTrips ?? 2);
    await save(db.vehicleAssignments, { ...va, km, price: vehiclePrice({ ...va, km }, vMap.get(va.vehicleId), d.settings) });
  }
}
