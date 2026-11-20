import { db, getSettings, nextNumber } from './db';
import type { Doc, DocSnapshot, DocType, SnapshotSub } from './types';
import { daysBetween, factorFor, lineTotal, round2, save } from './utils';

const PREFIX: Record<DocType, 'D' | 'F' | 'BS' | 'FR'> = { devis: 'D', facture: 'F', bon_sortie: 'BS', feuille_route: 'FR' };

/** Construit une photo figée du projet à l'instant T. */
export async function buildSnapshot(projectId: string, type: DocType): Promise<DocSnapshot> {
  const s = await getSettings();
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Projet introuvable');
  const [client, subs, lines, crew, vas, people, vehicles, equipment] = await Promise.all([
    project.clientId ? db.contacts.get(project.clientId) : undefined,
    db.subprojects.where({ projectId }).sortBy('order'),
    db.lines.where({ projectId }).toArray(),
    db.crew.where({ projectId }).toArray(),
    db.vehicleAssignments.where({ projectId }).toArray(),
    db.people.toArray(),
    db.vehicles.toArray(),
    db.equipment.toArray(),
  ]);
  const pMap = new Map(people.map((p) => [p.id, p]));
  const vMap = new Map(vehicles.map((v) => [v.id, v]));
  const eMap = new Map(equipment.map((e) => [e.id, e]));

  const snapSubs: SnapshotSub[] = subs
    .filter((sp) => sp.status !== 'annule')
    .map((sp) => {
      const days = daysBetween(sp.start, sp.end);
      const eq = lines
        .filter((l) => l.subprojectId === sp.id)
        .sort((a, b) => a.order - b.order)
        .map((l) => ({
          name: l.name,
          code: l.equipmentId ? eMap.get(l.equipmentId)?.code : undefined,
          qty: l.qty,
          unitPrice: l.unitPrice,
          days,
          factor: l.factor ?? factorFor(days, s),
          discount: l.discount,
          total: lineTotal(l, days, s),
          group: l.group,
        }));
      const cr = crew
        .filter((c) => c.subprojectId === sp.id)
        .sort((a, b) => a.start.localeCompare(b.start))
        .map((c) => {
          const d = daysBetween(c.start, c.end);
          const p = c.personId ? pMap.get(c.personId) : undefined;
          return { function: c.function, person: p?.name, phone: p?.phone, start: c.start, end: c.end, days: d, rate: c.rate, total: round2(d * c.rate), billable: c.billable };
        });
      const vh = vas
        .filter((v) => v.subprojectId === sp.id)
        .map((v) => ({
          name: vMap.get(v.vehicleId)?.name || 'Véhicule',
          plate: vMap.get(v.vehicleId)?.plate,
          driver: v.driverId ? pMap.get(v.driverId)?.name : undefined,
          start: v.start, end: v.end, price: v.price, billable: v.billable,
        }));
      const subtotal = round2(
        eq.reduce((a, l) => a + l.total, 0) +
        cr.filter((c) => c.billable).reduce((a, c) => a + c.total, 0) +
        vh.filter((v) => v.billable).reduce((a, v) => a + v.price, 0),
      );
      return { name: sp.name, venue: sp.venue || project.venue, start: sp.start, end: sp.end, equipment: eq, crew: cr, vehicles: vh, subtotal };
    });

  const gross = round2(snapSubs.reduce((a, sp) => a + sp.subtotal, 0));
  const discountAmount = round2(gross * (project.discount || 0) / 100);
  const totalHT = round2(gross - discountAmount);
  const vat = round2(totalHT * s.vatRate / 100);
  const issued = new Date();
  const valid = new Date(issued.getTime() + s.quoteValidityDays * 86400000);
  return {
    company: s.company,
    client,
    project: { number: project.number, name: project.name, venue: project.venue, start: project.start, end: project.end, notes: project.notes, discount: project.discount },
    subprojects: snapSubs,
    totalHT, discountAmount, vatRate: s.vatRate, vat, totalTTC: round2(totalHT + vat),
    issuedAt: issued.toISOString(),
    validUntil: type === 'devis' ? valid.toISOString() : undefined,
    footer: s.footer,
    hidePrices: type === 'bon_sortie' || type === 'feuille_route',
  };
}

/**
 * Génère un NOUVEAU document. Les versions précédentes restent intactes.
 * - devis / bon de sortie / feuille de route : même numéro, version +1
 * - facture : nouveau numéro à chaque fois (numérotation continue)
 */
export async function createDocument(projectId: string, type: DocType, note?: string): Promise<Doc> {
  const snapshot = await buildSnapshot(projectId, type);
  const previous = (await db.docs.where({ projectId }).toArray()).filter((d) => d.type === type);
  let number: string;
  let version = 1;
  if (type !== 'facture' && previous.length) {
    const last = previous.reduce((a, b) => (a.version > b.version ? a : b));
    number = last.number;
    version = last.version + 1;
  } else {
    number = await nextNumber(PREFIX[type]);
  }
  return save(db.docs, { projectId, type, number, version, status: 'brouillon', note, snapshot });
}
