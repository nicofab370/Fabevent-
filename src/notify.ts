/**
 * Centre de notifications (la cloche) : devis expirés, factures échues, devis acceptés / refusés / consultés en ligne,
 * demandes de modification, changements de statut, notes, stock critique, contrats et documents du personnel qui expirent,
 * tâches en retard, bons de commande à approuver.
 *
 * Chaque notification a une clé unique : une même alerte n'est jamais créée deux fois.
 * Les vérifications tournent au démarrage puis toutes les heures (checkNotifications).
 * Si une adresse est réglée (Paramètres → Notifications), elles partent aussi par email (serveur FabEvent).
 */
import { db, getSettings } from './db';
import { sendMail, serverScript } from './mailer';
import { projectedStock, type StockUse } from './stock';
import { RESERVING } from './types';
import type { Doc, NotifKind, Notification } from './types';
import { DOC_LABELS, NOTIF_LABELS } from './types';
import { fmtDate, uid } from './utils';

export async function notify(kind: NotifKind, key: string, text: string, link?: string, title = NOTIF_LABELS[kind]): Promise<Notification | null> {
  const s = await getSettings();
  if (s.notifOff?.includes(kind)) return null;
  if (await db.notifications.where('key').equals(key).count()) return null;
  const now = new Date().toISOString();
  const n: Notification = { id: uid(), createdAt: now, updatedAt: now, kind, key, title, text, link };
  await db.notifications.add(n);
  const to = (s.notifEmail || '').trim();
  if (to && serverScript('mail.php')) {
    try {
      await sendMail({ to, subject: `[FabEvent] ${title}`, body: `${text}${link ? `\n\n${location.origin}${location.pathname}#${link}` : ''}` }, [], { kind: 'notification' });
      await db.notifications.update(n.id, { emailedAt: new Date().toISOString() });
    } catch { /* l'email n'est pas parti : la notification reste dans l'application */ }
  }
  return n;
}

const day = (d = new Date()) => d.toISOString().slice(0, 10);
const docName = (d: Doc) => `${DOC_LABELS[d.type]} ${d.number}${d.snapshot.project?.name ? ` (${d.snapshot.project.name})` : ''}`;

/** Événements notés sur un document par la page publique (client) : une notification par événement. */
export async function docEvents(d: Doc) {
  for (const h of d.history || []) {
    if (h.by !== 'client') continue;
    const link = '/documents/' + d.id;
    if (h.event === 'accepte') await notify('devis_signe', `doc:${d.id}:accepte:${h.at}`, `${docName(d)} accepté en ligne${d.snapshot.client?.company ? ` par ${d.snapshot.client.company}` : ''}.`, link);
    else if (h.event === 'refuse') await notify('devis_refuse', `doc:${d.id}:refuse:${h.at}`, `${docName(d)} refusé en ligne.`, link);
    else if (h.event === 'remarque') await notify('devis_remarque', `doc:${d.id}:remarque:${h.at}`, `Demande de modification sur ${docName(d)} : « ${(d.clientRemarks || []).find((r) => r.at === h.at)?.text?.slice(0, 160) || ''} »`, link);
    else if (h.event === 'ouvert') await notify('devis_vu', `doc:${d.id}:ouvert`, `${docName(d)} consulté par le client pour la première fois.`, link);
  }
}

/** Quantités de consommables prévues dans les projets à venir et pas encore sorties du stock, par article. */
export async function consumableUses(): Promise<Map<string, StockUse[]>> {
  const eq = new Map((await db.equipment.toArray()).map((e) => [e.id, e]));
  const subs = new Map((await db.subprojects.toArray()).map((s) => [s.id, s]));
  const out = new Map<string, StockUse[]>();
  for (const l of await db.lines.toArray()) {
    const e = l.equipmentId ? eq.get(l.equipmentId) : undefined;
    const sp = subs.get(l.subprojectId);
    if (!e || e.kind !== 'vente' || l.consumed || l.optional || !sp || !RESERVING.includes(sp.status)) continue;
    const arr = out.get(e.id) || [];
    arr.push({ date: sp.prepStart || sp.start, qty: l.qty });
    out.set(e.id, arr);
  }
  return out;
}

let running = false;
/** Vérifications périodiques (au démarrage, puis toutes les heures). */
export async function checkNotifications(now = new Date()) {
  if (running) return;
  running = true;
  try {
    const today = day(now);
    const { applyPlannedStock } = await import('./components/ConsumableStock');
    await applyPlannedStock(today);
    const docs = await db.docs.toArray();
    for (const d of docs) {
      await docEvents(d);
      // devis envoyé dont la date de validité est passée sans réponse
      if (d.type === 'devis' && d.status === 'envoye' && d.snapshot.validUntil && d.snapshot.validUntil.slice(0, 10) < today)
        await notify('devis_expire', `devis_expire:${d.id}`, `${docName(d)} a expiré le ${fmtDate(d.snapshot.validUntil, false)} sans réponse du client.`, '/documents/' + d.id);
      // facture ou acompte non payé à l'échéance
      if ((d.type === 'facture' || d.type === 'acompte') && d.status !== 'paye' && d.status !== 'brouillon' && d.snapshot.dueDate && d.snapshot.dueDate.slice(0, 10) < today)
        await notify('facture_echue', `facture_echue:${d.id}`, `${docName(d)} n'est pas payée (échéance ${fmtDate(d.snapshot.dueDate, false)}).`, '/documents/' + d.id);
    }
    // consommables sous leur seuil (maintenant ou d'après les mouvements programmés)
    const uses = await consumableUses();
    for (const e of await db.equipment.toArray()) {
      if (e.archived || !e.criticalStock) continue;
      const p = projectedStock(e, today, uses.get(e.id));
      if (p.reachDate) await notify('stock_critique', `stock:${e.id}:${p.reachDate}`, `${e.name} : stock sous le seuil de ${e.criticalStock} ${p.reachDate <= today ? 'dès maintenant' : 'le ' + fmtDate(p.reachDate, false)} (${p.min} restant).`, '/materiel/' + e.id);
    }
    // contrats du personnel qui se terminent dans 30 jours, documents expirés
    const in30 = day(new Date(now.getTime() + 30 * 86400000));
    for (const p of await db.people.toArray()) {
      const end = p.contract?.end?.slice(0, 10);
      if (end && end >= today && end <= in30) await notify('contrat_fin', `contrat:${p.id}:${end}`, `Le contrat de ${p.name} se termine le ${fmtDate(end, false)}.`, '/equipe?p=' + p.id);
    }
    for (const f of await db.files.where('personId').above('').toArray()) {
      if (f.expires && f.expires.slice(0, 10) < today) {
        const person = f.personId ? await db.people.get(f.personId) : undefined;
        await notify('document_expire', `docperso:${f.id}:${f.expires}`, `${f.name}${person ? ` (${person.name})` : ''} a expiré le ${fmtDate(f.expires, false)}.`, '/equipe' + (person ? '?p=' + person.id : ''));
      }
    }
    // tâches en retard (projets et page Tâches)
    for (const p of await db.projects.toArray()) {
      if (p.isTemplate || p.status === 'annule') continue;
      for (const t of p.tasks || []) if (!t.done && t.due && t.due.slice(0, 10) < today)
        await notify('tache', `tache:${p.id}:${t.id}`, `Tâche en retard (${p.name}) : ${t.text}`, '/projets/' + p.id);
    }
    for (const t of await db.tasks.toArray()) if (!t.done && t.due && t.due.slice(0, 10) < today)
      await notify('tache', `tache:${t.id}`, `Tâche en retard : ${t.text}`, '/taches');
    for (const po of await db.purchaseOrders.where('status').equals('a_approuver').toArray())
      await notify('bon_commande', `po:${po.id}:${po.updatedAt}`, `Le bon de commande ${po.number}${po.supplierName ? ` (${po.supplierName})` : ''} attend une approbation.`, '/bons-de-commande');
  } finally { running = false; }
}

export const markAllRead = () => db.notifications.filter((n) => !n.read).modify({ read: true });
