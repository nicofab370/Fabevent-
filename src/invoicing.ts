import { db, getSettings } from './db';
import type { Contact, Doc, InvoiceMoment, Project, Settings } from './types';
import { CONFIRMED } from './types';
import { round2 } from './utils';

/** Moments proposés par défaut (modifiables dans Paramètres). */
export const DEFAULT_MOMENTS: InvoiceMoment[] = [
  { id: 'm_unique', name: 'Facture après la prestation', percent: 100, trigger: 'fin' },
  { id: 'm_acompte', name: 'Acompte à la commande', percent: 30, trigger: 'accord' },
  { id: 'm_solde', name: 'Solde après la prestation', percent: 70, trigger: 'fin' },
];

export function settingsMoments(s: Pick<Settings, 'invoiceMoments'>): InvoiceMoment[] {
  return s.invoiceMoments?.length ? s.invoiceMoments : DEFAULT_MOMENTS;
}

/** Moments du projet : ceux du projet, sinon du client, sinon du type de projet, sinon une facture unique. */
export function projectMoments(p: Pick<Project, 'moments' | 'typeName'>, client: Pick<Contact, 'moments'> | undefined, s: Pick<Settings, 'invoiceMoments' | 'projectTypes'>): InvoiceMoment[] {
  const all = settingsMoments(s);
  const ids = p.moments?.length ? p.moments : client?.moments?.length ? client.moments : s.projectTypes?.find((t) => t.name === p.typeName)?.moments;
  const picked = (ids || []).map((id) => all.find((m) => m.id === id)).filter((m): m is InvoiceMoment => !!m);
  return picked.length ? picked : [{ id: 'm_unique', name: 'Facture après la prestation', percent: 100, trigger: 'fin' }];
}

type MomentState = 'facture' | 'en_retard' | 'a_facturer' | 'a_venir';
export const MOMENT_STATE_LABELS: Record<MomentState, string> = {
  facture: 'Facturé', en_retard: 'En retard', a_facturer: 'À facturer', a_venir: 'À venir',
};

export interface ScheduleRow {
  moment: InvoiceMoment;
  /** date (aaaa-mm-jj) à laquelle facturer ; vide tant que le projet n'est pas confirmé */
  due: string;
  amountHT: number;
  /** part cumulée du total à avoir facturée après ce moment */
  cumulativeHT: number;
  state: MomentState;
  /** dernier moment : facture finale (déduit les acomptes) */
  final: boolean;
}

const addDays = (iso: string, n: number) => {
  const d = new Date(iso.slice(0, 10) + 'T12:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Échéancier : chaque moment est facturé quand le total déjà facturé atteint sa part cumulée.
 * Il passe « à facturer » quelques jours avant son échéance, « en retard » une fois la date dépassée.
 */
export function invoiceSchedule(
  p: Pick<Project, 'start' | 'end' | 'status' | 'confirmedAt'> & { createdAt?: string }, moments: InvoiceMoment[], totalHT: number, invoicedHT: number,
  today = new Date().toISOString().slice(0, 10), horizonDays = 14,
): ScheduleRow[] {
  const confirmed = CONFIRMED.includes(p.status);
  const sumPct = moments.reduce((a, m) => a + m.percent, 0) || 100;
  let cum = 0;
  return moments.map((m, i) => {
    const share = m.percent / sumPct;
    const amountHT = round2(totalHT * share);
    cum += share;
    const cumulativeHT = round2(totalHT * cum);
    const due = m.trigger === 'accord'
      ? (confirmed ? (p.confirmedAt || p.createdAt || p.start).slice(0, 10) : '')
      : m.trigger === 'avant' ? addDays(p.start, -(m.days || 0)) : addDays(p.end, m.days || 0);
    let state: MomentState;
    if (invoicedHT >= cumulativeHT - 0.01 && totalHT > 0) state = 'facture';
    else if (!confirmed || !due) state = 'a_venir';
    else if (due < today) state = 'en_retard';
    else if (due <= addDays(today, horizonDays)) state = 'a_facturer';
    else state = 'a_venir';
    return { moment: m, due, amountHT, cumulativeHT, state, final: i === moments.length - 1 };
  });
}

/** HT déjà facturé (factures + acomptes non repris + avoirs). */
export function invoicedTotal(docs: Pick<Doc, 'type' | 'number' | 'snapshot'>[]): number {
  const deducted = new Set(docs.flatMap((d) => (d.snapshot.deposits || []).map((x) => x.number)));
  return round2(docs
    .filter((d) => (d.type === 'facture' || d.type === 'avoir' || (d.type === 'acompte' && !deducted.has(d.number))))
    .reduce((a, d) => a + d.snapshot.totalHT, 0));
}

interface BillingRow {
  project: Project;
  client?: Contact;
  total: number;
  invoiced: number;
  reste: number;
  /** évènement terminé (date de fin passée) et pas annulé */
  past: boolean;
  free: boolean;
}

/**
 * Réca­p de facturation par projet : total HT, déjà facturé HT, reste à facturer,
 * et drapeau « évènement passé » (fin < aujourd'hui) quand il reste quelque chose à facturer.
 */
export function billingRecap(projects: Project[], docs: Doc[], totals: Map<string, number>, contacts: Contact[] = [], today = new Date().toISOString().slice(0, 10)): BillingRow[] {
  const cMap = new Map(contacts.map((c) => [c.id, c]));
  return projects
    .filter((p) => !p.isTemplate)
    .map((p) => {
      const pDocs = docs.filter((d) => d.projectId === p.id);
      const total = totals.get(p.id) || 0;
      const invoiced = invoicedTotal(pDocs);
      const reste = round2(total - invoiced);
      const past = !!p.end && p.end.slice(0, 10) < today && p.status !== 'annule';
      return { project: p, client: p.clientId ? cMap.get(p.clientId) : undefined, total, invoiced, reste, past, free: !!p.free };
    })
    .filter((r) => r.free || r.total > 0.005 || r.invoiced > 0.005 || r.reste > 0.005)
    .sort((a, b) => {
      const rank = (r: BillingRow) => (r.past && r.reste > 0.005 && !r.free ? 0 : r.reste > 0.005 && !r.free ? 1 : 2);
      return rank(a) - rank(b) || (a.project.end || '').localeCompare(b.project.end || '');
    });
}

/** Projets confirmés avec un moment de facturation en attente (pour « À facturer »). */
export async function loadInvoicingQueue(totals: Map<string, number>) {
  const s = await getSettings();
  const [projects, contacts, docs] = await Promise.all([db.projects.toArray(), db.contacts.toArray(), db.docs.toArray()]);
  const cMap = new Map(contacts.map((c) => [c.id, c]));
  const today = new Date().toISOString().slice(0, 10);
  return projects
    .filter((p) => !p.isTemplate && CONFIRMED.includes(p.status))
    .map((p) => {
      const total = totals.get(p.id) || 0;
      const pDocs = docs.filter((d) => d.projectId === p.id);
      const invoiced = invoicedTotal(pDocs);
      const rows = invoiceSchedule(p, projectMoments(p, p.clientId ? cMap.get(p.clientId) : undefined, s), total, invoiced, today);
      return { project: p, client: p.clientId ? cMap.get(p.clientId) : undefined, total, invoiced, rows, next: rows.find((r) => r.state !== 'facture') };
    });
}
