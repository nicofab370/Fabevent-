import { db, getSettings, nextNumber } from './db';
import type { Doc, DocSnapshot, DocType, SnapshotSub } from './types';
import { INVOICE_TYPES } from './types';
import { daysBetween, factorFor, lineDays, lineTotal, round2, save, sortPeriods } from './utils';

const PREFIX: Record<DocType, 'D' | 'F' | 'AV' | 'BS' | 'FR'> = {
  devis: 'D', facture: 'F', acompte: 'F', avoir: 'AV', bon_sortie: 'BS', feuille_route: 'FR',
};

export interface DocOptions {
  /** acompte : pourcentage du total TTC du projet */
  percent?: number;
  /** acompte / avoir : montant HT fixe (prioritaire sur percent) */
  amountHT?: number;
  /** avoir : facture d'origine */
  invoiceId?: string;
  note?: string;
}

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
  const isQuote = type === 'devis';
  const isPacking = type === 'bon_sortie' || type === 'feuille_route';

  const snapSubs: SnapshotSub[] = subs
    .filter((sp) => sp.status !== 'annule')
    .map((sp) => {
      const groupName = new Map((sp.groups || []).map((g) => [g.id, g.name]));
      const eq = lines
        .filter((l) => l.subprojectId === sp.id && (isQuote || isPacking || !l.optional))
        .sort((a, b) => a.order - b.order)
        .map((l) => {
          const e = l.equipmentId ? eMap.get(l.equipmentId) : undefined;
          const perPiece = e?.kind === 'vente';
          const days = lineDays(l, sp);
          return {
            name: l.name,
            code: e?.code,
            qty: l.qty,
            unitPrice: l.unitPrice,
            days: perPiece ? 1 : days,
            factor: perPiece ? 1 : l.factor ?? factorFor(days, s),
            discount: l.discount,
            total: lineTotal(l, days, s, perPiece),
            group: (l.groupId && groupName.get(l.groupId)) || l.group,
            optional: !!l.optional,
            unit: perPiece ? 'pièce' as const : 'jour' as const,
          };
        });
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
          start: v.start, end: v.end, price: v.price, billable: v.billable, km: v.km || undefined, trips: v.km ? v.trips : undefined,
        }));
      const subtotal = round2(
        eq.filter((l) => !l.optional).reduce((a, l) => a + l.total, 0) +
        cr.filter((c) => c.billable).reduce((a, c) => a + c.total, 0) +
        vh.filter((v) => v.billable).reduce((a, v) => a + v.price, 0),
      );
      const periods = sp.periods?.length ? sortPeriods(sp.periods).map(({ name, kind, start, end }) => ({ name, kind, start, end })) : undefined;
      return { name: sp.name, venue: sp.venue || project.venue, start: sp.prepStart || sp.start, end: sp.returnEnd || sp.end, periods, equipment: eq, crew: cr, vehicles: vh, subtotal };
    });

  const costs = await db.costs.where({ projectId }).toArray();
  const extras = costs.filter((c) => c.billable && c.price).map((c) => ({ label: c.label, qty: c.qty || 1, unitPrice: c.price!, total: round2((c.qty || 1) * c.price!) }));
  const gross = round2(snapSubs.reduce((a, sp) => a + sp.subtotal, 0) + extras.reduce((a, x) => a + x.total, 0));
  const discountAmount = round2(gross * (project.discount || 0) / 100);
  const totalHT = round2(gross - discountAmount);
  const vat = round2(totalHT * s.vatRate / 100);
  const issued = new Date();
  const optionalTotal = round2(snapSubs.reduce((a, sp) => a + sp.equipment.filter((l) => l.optional).reduce((b, l) => b + l.total, 0), 0));
  return {
    company: s.company,
    client,
    project: { number: project.number, name: project.name, venue: project.venue, start: project.start, end: project.end, notes: project.notes, discount: project.discount, externalRef: project.externalRef },
    subprojects: snapSubs,
    extras: isPacking || !extras.length ? undefined : extras,
    totalHT, discountAmount, vatRate: s.vatRate, vat, totalTTC: round2(totalHT + vat),
    issuedAt: issued.toISOString(),
    validUntil: isQuote ? new Date(issued.getTime() + s.quoteValidityDays * 86400000).toISOString() : undefined,
    dueDate: INVOICE_TYPES.includes(type) ? new Date(issued.getTime() + s.paymentDays * 86400000).toISOString() : undefined,
    footer: s.footer,
    hidePrices: isPacking,
    optionalTotal: isQuote && optionalTotal ? optionalTotal : undefined,
  };
}

function simple(base: DocSnapshot, label: string, ht: number): DocSnapshot {
  const totalHT = round2(ht);
  const vat = round2(totalHT * base.vatRate / 100);
  return { ...base, subprojects: [], simpleLines: [{ label, ht: totalHT }], discountAmount: 0, totalHT, vat, totalTTC: round2(totalHT + vat), optionalTotal: undefined };
}

/**
 * Génère un NOUVEAU document. Les versions précédentes restent intactes.
 * - devis / bon de sortie / feuille de route : même numéro, version +1
 * - facture, acompte : numérotation continue F-…, avoir : AV-…
 */
export async function createDocument(projectId: string, type: DocType, opts: DocOptions = {}): Promise<Doc> {
  const projectDocs = await db.docs.where({ projectId }).toArray();
  let snapshot = await buildSnapshot(projectId, type);

  if (type === 'facture') {
    // On déduit les acomptes déjà facturés (hors acomptes annulés par un avoir)
    const cancelled = new Set(projectDocs.filter((d) => d.type === 'avoir').map((d) => d.snapshot.refNumber));
    const deposits = projectDocs.filter((d) => d.type === 'acompte' && !cancelled.has(d.number)).map((d) => ({ number: d.number, ttc: d.snapshot.totalTTC }));
    if (deposits.length) snapshot = { ...snapshot, deposits };
  }
  if (type === 'acompte') {
    const quote = projectDocs.filter((d) => d.type === 'devis').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    const baseHT = quote ? quote.snapshot.totalHT : snapshot.totalHT;
    const pct = opts.percent ?? 30;
    const ht = opts.amountHT ?? baseHT * pct / 100;
    const label = opts.amountHT != null
      ? `Acompte — projet ${snapshot.project.number} ${snapshot.project.name}`
      : `Acompte de ${pct} % — projet ${snapshot.project.number} ${snapshot.project.name}`;
    snapshot = { ...simple(snapshot, label, ht), refNumber: quote?.number };
  }
  if (type === 'avoir') {
    const inv = opts.invoiceId ? await db.docs.get(opts.invoiceId) : undefined;
    if (!inv) throw new Error('Facture d\'origine introuvable');
    const ht = -(opts.amountHT ?? inv.snapshot.totalHT);
    snapshot = { ...simple({ ...snapshot, vatRate: inv.snapshot.vatRate }, `Avoir sur ${inv.type === 'acompte' ? "facture d'acompte" : 'facture'} ${inv.number}`, ht), refNumber: inv.number };
  }

  const previous = projectDocs.filter((d) => d.type === type);
  let number: string;
  let version = 1;
  if (!INVOICE_TYPES.includes(type) && previous.length) {
    const last = previous.reduce((a, b) => (a.version > b.version ? a : b));
    number = last.number;
    version = last.version + 1;
  } else {
    number = await nextNumber(PREFIX[type]);
  }
  const project = await db.projects.get(projectId);
  return save(db.docs, { projectId, type, number, version, status: 'brouillon', note: opts.note, contactPerson: project?.contactPerson, snapshot });
}
