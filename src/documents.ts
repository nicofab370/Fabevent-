import { db, DEFAULT_DOC_STYLE, getSettings, nextNumber } from './db';
import type { Doc, DocSnapshot, DocType, Lang, Settings, SnapshotSub, VatRegime } from './types';
import { VAT_MENTIONS_I18N } from './i18n';
import { DEFAULT_VAT_MENTIONS, structuredCommunication } from './payment';
import { INVOICE_TYPES } from './types';
import { crewAmount, crewWindow, daysBetween, factorFor, lineDays, lineTotal, round2, save, sortPeriods } from './utils';

const PREFIX: Record<DocType, 'D' | 'F' | 'AV' | 'BS' | 'FR' | 'RP'> = {
  devis: 'D', facture: 'F', acompte: 'F', avoir: 'AV', rappel: 'RP', bon_sortie: 'BS', feuille_route: 'FR',
};

/** Taux et mention selon le régime de TVA du projet (ou, à défaut, du client). */
function vatFor(regime: VatRegime, s: Settings, lang: Lang = 'fr'): { rate: number; mention?: string } {
  if (regime === 'normal') return { rate: s.vatRate };
  if (lang !== 'fr') return { rate: 0, mention: VAT_MENTIONS_I18N[lang][regime] };
  return { rate: 0, mention: s.vatMentions?.[regime] || DEFAULT_VAT_MENTIONS[regime] };
}

/** Clé de variable d'un champ personnalisé : « Repas fourni » → repas_fourni */
export function fieldKey(label: string): string {
  return label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export interface DocOptions {
  /** acompte : pourcentage du total TTC du projet */
  percent?: number;
  /** acompte / avoir : montant HT fixe (prioritaire sur percent) */
  amountHT?: number;
  /** avoir : facture d'origine */
  invoiceId?: string;
  /** facture partielle : uniquement ces salles */
  subIds?: string[];
  note?: string;
}

/** Construit une photo figée du projet à l'instant T. */
export async function buildSnapshot(projectId: string, type: DocType, only?: { include?: string[]; exclude?: string[] }): Promise<DocSnapshot> {
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
    .filter((sp) => sp.status !== 'annule' && (!only?.include || only.include.includes(sp.id)) && !only?.exclude?.includes(sp.id))
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
          const a = crewAmount(c, s, project.travelMinutes, c.personId ? pMap.get(c.personId)?.costRate : undefined);
          const [dep, back] = crewWindow(c, project.travelMinutes);
          const p = c.personId ? pMap.get(c.personId) : undefined;
          return {
            function: c.function, person: c.final === false ? (p ? 'à confirmer' : undefined) : p?.name, phone: c.final === false ? undefined : p?.phone, start: c.start, end: c.end, days: a.unit === 'jour' ? a.qty : 0, rate: c.rate, total: a.billed,
            billable: c.billable, unit: a.unit, hours: a.unit === 'heure' ? a.hours : undefined, overtime: a.overtime || undefined,
            departure: dep !== c.start ? dep : undefined, back: back !== c.end ? back : undefined,
          };
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
  // les frais supplémentaires vont sur la facture finale, pas sur une facture partielle par salle
  const extras = only?.include ? [] : costs.filter((c) => c.billable && c.price).map((c) => ({ label: c.label, qty: c.qty || 1, unitPrice: c.price!, total: round2((c.qty || 1) * c.price!) }));
  const gross = round2(snapSubs.reduce((a, sp) => a + sp.subtotal, 0) + extras.reduce((a, x) => a + x.total, 0));
  const discountAmount = round2(gross * (project.discount || 0) / 100);
  const totalHT = round2(gross - discountAmount);
  const regime: VatRegime = project.vatRegime || client?.vatRegime || 'normal';
  const lang: Lang = project.language || client?.language || 'fr';
  const { rate: vatRate, mention: vatMention } = vatFor(regime, s, lang);
  const customFields = (s.customFields || []).filter((f) => f.entity === 'projet' || f.entity === 'contact').map((f) => {
    const v = f.entity === 'projet' ? project.custom?.[f.id] : client?.custom?.[f.id];
    return { key: fieldKey(f.label), label: f.label, value: v === undefined || v === '' ? '' : f.type === 'oui_non' ? (v ? 'Oui' : 'Non') : f.type === 'date' ? new Date(String(v)).toLocaleDateString('fr-FR') : String(v) };
  });
  const vat = round2(totalHT * vatRate / 100);
  const issued = new Date();
  const optionalTotal = round2(snapSubs.reduce((a, sp) => a + sp.equipment.filter((l) => l.optional).reduce((b, l) => b + l.total, 0), 0));
  return {
    company: s.company,
    client,
    project: { number: project.number, name: project.name, venue: project.venue, start: project.start, end: project.end, notes: project.notes, discount: project.discount, externalRef: project.externalRef },
    subprojects: snapSubs,
    extras: isPacking || !extras.length ? undefined : extras,
    totalHT, discountAmount, vatRate, vat, totalTTC: round2(totalHT + vat), vatRegime: regime, vatMention, lang, customFields,
    issuedAt: issued.toISOString(),
    validUntil: isQuote ? new Date(issued.getTime() + s.quoteValidityDays * 86400000).toISOString() : undefined,
    dueDate: INVOICE_TYPES.includes(type) ? new Date(issued.getTime() + s.paymentDays * 86400000).toISOString() : undefined,
    footer: s.footer,
    hidePrices: isPacking,
    template: { style: { ...DEFAULT_DOC_STYLE, ...s.templates?.style }, html: s.templates?.html, ...s.templates?.types?.[type] },
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
  // salles déjà facturées séparément (facture partielle non annulée par un avoir total)
  const fullyCredited = new Set(projectDocs.filter((d) => d.type === 'avoir').map((d) => {
    const inv = projectDocs.find((x) => x.number === d.snapshot.refNumber);
    return inv && Math.abs(d.snapshot.totalHT) >= Math.abs(inv.snapshot.totalHT) - 0.01 ? inv.number : '';
  }));
  const partials = projectDocs.filter((d) => d.type === 'facture' && d.subprojectIds?.length && !fullyCredited.has(d.number));
  const alreadyInvoiced = partials.flatMap((d) => d.subprojectIds || []);
  const only = type !== 'facture' ? undefined : opts.subIds?.length ? { include: opts.subIds.filter((x) => !alreadyInvoiced.includes(x)) } : alreadyInvoiced.length ? { exclude: alreadyInvoiced } : undefined;
  if (only?.include && !only.include.length) throw new Error('Ces salles sont déjà facturées.');
  let snapshot = await buildSnapshot(projectId, type, only);
  if (type === 'facture' && partials.length && !opts.subIds?.length) {
    snapshot = { ...snapshot, partialInvoices: partials.map((d) => ({ number: d.number, rooms: d.snapshot.subprojects.map((x) => x.name), ht: d.snapshot.totalHT })) };
  }
  if (type === 'facture' && opts.subIds?.length) snapshot = { ...snapshot, partialRooms: snapshot.subprojects.map((x) => x.name) };

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
    snapshot = {
      ...simple({ ...snapshot, vatRate: inv.snapshot.vatRate, vatRegime: inv.snapshot.vatRegime, vatMention: inv.snapshot.vatMention },
        `Avoir sur ${inv.type === 'acompte' ? "facture d'acompte" : 'facture'} ${inv.number}`, ht),
      refNumber: inv.number,
    };
  }
  if (type === 'rappel') {
    const inv = opts.invoiceId ? await db.docs.get(opts.invoiceId) : undefined;
    if (!inv) throw new Error('Facture introuvable');
    const st = await getSettings();
    const level = projectDocs.filter((d) => d.type === 'rappel' && d.snapshot.reminder?.invoiceNumber === inv.number).length + 1;
    const due = round2(inv.snapshot.totalTTC - (inv.snapshot.deposits || []).reduce((a, x) => a + x.ttc, 0));
    snapshot = {
      ...inv.snapshot, subprojects: [], extras: undefined, deposits: undefined, optionalTotal: undefined, hidePrices: false,
      simpleLines: [{ label: `Facture ${inv.number} du ${new Date(inv.snapshot.issuedAt).toLocaleDateString('fr-FR')}`, ht: due }],
      totalHT: due, vat: 0, vatRate: 0, discountAmount: 0, totalTTC: due, vatMention: undefined,
      issuedAt: new Date().toISOString(), dueDate: new Date(Date.now() + (st.reminderDays ?? 10) * 86400000).toISOString(),
      refNumber: inv.number, template: snapshot.template,
      reminder: { level, invoiceNumber: inv.number, invoiceDate: inv.snapshot.issuedAt, invoiceDue: inv.snapshot.dueDate, amount: due },
      payment: inv.snapshot.payment,
    };
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
  // virement : communication structurée belge (ou numéro de facture)
  if ((type === 'facture' || type === 'acompte') && !snapshot.payment) {
    const st = await getSettings();
    snapshot = { ...snapshot, payment: st.structuredComm !== false ? { communication: structuredCommunication(number), structured: true } : { communication: number, structured: false } };
  }
  const project = await db.projects.get(projectId);
  return save(db.docs, {
    projectId, type, number, version, status: 'brouillon', note: opts.note, contactPerson: project?.contactPerson, snapshot,
    subprojectIds: type === 'facture' && only?.include ? only.include : undefined,
  });
}
