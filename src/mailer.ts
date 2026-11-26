import type { Attachment, MailDraft } from './email';
import type { MailKind, MailTemplate, Settings } from './types';
import { currentWorkspace } from './db';
import { syncEnabled, syncNow, syncUrl } from './sync';
import { uid } from './utils';

/*
 * Envoi des emails directement depuis FabEvent : par le serveur (mail.php à côté de sync.php sur l'hébergement),
 * avec les pièces jointes. Sans serveur (GitHub Pages, ordinateur sans hébergement), FabEvent garde les autres
 * façons d'envoyer (partage, brouillon .eml, messagerie).
 * Les liens publics (réponse de disponibilité, inscription des techniciens) sont servis par public.php.
 */

/** Adresse d'un script serveur à côté de sync.php (vide sans serveur). */
export function serverScript(name: 'mail.php' | 'public.php' | 'oauth.php' | 'auth.php'): string {
  const s = syncUrl();
  if (!s) return '';
  try { const u = new URL(s, location.href); u.pathname = u.pathname.replace(/[^/]*$/, name); u.search = ''; return u.href; } catch { return ''; }
}

export interface MailServer { ok: boolean; mode?: string; from?: string; error?: string; /** il faut se reconnecter au serveur FabEvent */ login?: boolean }
let cached: { at: number; v: MailServer } | null = null;

/** Le serveur peut-il envoyer les mails ? (réponse gardée 5 minutes) */
export async function mailServer(force = false): Promise<MailServer> {
  const url = serverScript('mail.php');
  if (!url) return { ok: false, error: 'Pas de serveur FabEvent configuré (Paramètres → Synchronisation).' };
  if (!force && cached && Date.now() - cached.at < 300000) return cached.v;
  let v: MailServer;
  try {
    const r = await fetch(url + '?action=status&ws=' + encodeURIComponent(currentWorkspace()), { credentials: 'include', cache: 'no-store' });
    if ((r.headers.get('content-type') || '').includes('text/html')) {
      v = { ok: false, error: 'API mail non atteinte (la page de l’application est renvoyée) : déposer le dossier api/ à côté de l’application (ex. /fabevent/api/mail.php) — voir docs/deploiement-fabri.md' };
    } else {
      const j = await r.json().catch(() => ({}));
      v = r.ok && j.ok ? { ok: true, mode: j.mode, from: j.from }
        : r.status === 401 ? { ok: false, login: true, error: 'connexion au serveur FabEvent expirée sur cet appareil.' }
        : { ok: false, error: j.detail || 'Envoi indisponible sur le serveur.' };
    }
  } catch {
    v = { ok: false, error: 'Serveur injoignable (hors ligne ?).' };
  }
  // seul un « ok » est gardé : après une connexion, l'envoi direct revient tout de suite
  cached = v.ok ? { at: Date.now(), v } : null;
  return v;
}

async function b64(b: Blob): Promise<string> {
  const bytes = new Uint8Array(await b.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export const splitAddrs = (s: string) => s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);

/**
 * Synchronise AVANT d'envoyer : les liens du mail (disponibilité, fiche, devis…) n'existent sur le serveur
 * qu'une fois la donnée synchronisée ; sinon le destinataire qui clique vite voit « lien expiré ».
 */
async function syncFirst() {
  if (!syncEnabled()) return;
  let st = await syncNow();
  for (let i = 0; i < 40 && st.status === 'busy'; i++) {
    await new Promise((res) => setTimeout(res, 250)); // une synchro était déjà en cours : on attend la suivante
    st = await syncNow();
  }
  // le mail ne part pas si ses liens ne marcheraient pas encore chez le destinataire
  if (st.status === 'auth') throw new Error('Connexion au serveur FabEvent expirée : reconnecte-toi, puis renvoie (rien n’est perdu).');
  if (st.status === 'error' || st.status === 'offline') throw new Error('Synchronisation impossible pour l’instant (' + (st.message || 'hors ligne') + ') : réessaie dans un moment.');
}

/** Envoie le mail par le serveur. Lève une erreur lisible si l'envoi échoue. */
export async function sendMail(m: MailDraft & { cc?: string; bcc?: string; replyTo?: string }, attachments: Attachment[]): Promise<{ to: string[] }> {
  const url = serverScript('mail.php');
  if (!url) throw new Error('Pas de serveur FabEvent configuré.');
  await syncFirst();
  const r = await fetch(url + '?action=send&ws=' + encodeURIComponent(currentWorkspace()), {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: splitAddrs(m.to), cc: splitAddrs(m.cc || ''), bcc: splitAddrs(m.bcc || ''), replyTo: m.replyTo || '', subject: m.subject, text: m.body,
      attachments: await Promise.all(attachments.map(async (a) => ({ name: a.name, type: a.type, data: await b64(a.blob) }))),
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.ok) throw new Error(j.detail || (r.status === 401 ? 'Connexion au serveur FabEvent expirée : reconnecte-toi pour envoyer.' : `Envoi refusé (${r.status}).`));
  return { to: j.to || [] };
}

/** Jeton secret d'un lien public (impossible à deviner). */
export function newToken(len = 32): string {
  const a = new Uint8Array(len);
  crypto.getRandomValues(a);
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from(a, (x) => abc[x % abc.length]).join('');
}
export const requestLink = (token: string) => { const u = serverScript('public.php'); return u ? `${u}?r=${token}` : ''; };
export const signupLink = (key: string) => { const u = serverScript('public.php'); return u ? `${u}?s=${key}` : ''; };
/** lien « ma fiche » d'un technicien : il met à jour ses coordonnées (public.php?m=…) */
export const mySheetLink = (token: string) => { const u = serverScript('public.php'); return u ? `${u}?m=${token}` : ''; };
/** lien public d'acceptation / refus d'un devis (public.php?d=…) */
export const quoteLink = (token: string) => { const u = serverScript('public.php'); return u ? `${u}?d=${token}` : ''; };

/* ---------- modèles de mail ---------- */

export const MAIL_KINDS: Record<MailKind, string> = {
  devis: 'Devis', facture: 'Facture', acompte: 'Facture d\'acompte', avoir: 'Avoir', rappel: 'Rappel de paiement', bon_sortie: 'Bon de sortie',
  feuille_route: 'Feuille de route', planning: 'Planning technicien', dispo: 'Demande de disponibilité', confirmation: 'Confirmation de poste',
  annulation: 'Annulation de poste', sous_location: 'Commande de sous-location', autre: 'Autre',
};

/** Variables utilisables dans les modèles : {prenom} {client} {projet} {numero} {lieu} {dates} {montant} {echeance} {societe} {lien} {postes} {adresse} {contact} */
export const MAIL_VARS: Record<string, string> = {
  prenom: 'prénom du destinataire', client: 'client', projet: 'nom du projet', numero: 'n° du document', lieu: 'lieu', adresse: 'adresse du lieu', dates: 'dates du projet',
  montant: 'montant TTC', echeance: 'échéance', societe: 'ta société', lien: 'lien de réponse', postes: 'liste des postes', contact: 'contact sur place',
};

const SIGN = '\n\nCordialement,\n{societe}';
export const DEFAULT_TEMPLATES: Record<MailKind, Omit<MailTemplate, 'id' | 'kind'>> = {
  devis: { name: 'Devis (standard)', subject: 'Devis {numero} — {projet}', body: 'Bonjour {prenom},\n\nVeuillez trouver ci-joint notre devis {numero} pour « {projet} » ({dates}).\nN\'hésitez pas à revenir vers nous pour toute question.' + SIGN },
  facture: { name: 'Facture (standard)', subject: 'Facture {numero} — {projet}', body: 'Bonjour {prenom},\n\nVeuillez trouver ci-joint notre facture {numero} pour « {projet} », d\'un montant de {montant}, payable pour le {echeance}.' + SIGN },
  acompte: { name: 'Acompte (standard)', subject: 'Facture d\'acompte {numero} — {projet}', body: 'Bonjour {prenom},\n\nVeuillez trouver ci-joint la facture d\'acompte {numero} pour « {projet} » ({montant}).' + SIGN },
  avoir: { name: 'Avoir (standard)', subject: 'Avoir {numero} — {projet}', body: 'Bonjour {prenom},\n\nVeuillez trouver ci-joint notre avoir {numero} pour « {projet} ».' + SIGN },
  rappel: { name: 'Rappel (courtois)', subject: 'Rappel — facture {numero}', body: 'Bonjour {prenom},\n\nSauf erreur de notre part, la facture {numero} ({montant}), échue le {echeance}, reste impayée. Vous la trouverez en pièce jointe.\nSi le paiement est en cours, merci de ne pas tenir compte de ce rappel.' + SIGN },
  bon_sortie: { name: 'Bon de sortie', subject: 'Bon de sortie — {projet}', body: 'Bonjour {prenom},\n\nVeuillez trouver ci-joint le bon de sortie du matériel pour « {projet} ».' + SIGN },
  feuille_route: { name: 'Feuille de route', subject: 'Feuille de route — {projet}', body: 'Bonjour {prenom},\n\nVoici la feuille de route pour « {projet} » ({dates}, {lieu}).' + SIGN },
  planning: { name: 'Planning technicien', subject: 'Planning — {projet}', body: 'Bonjour {prenom},\n\nVoici ton planning pour « {projet} » ({lieu}) :\n\n{postes}\n\nLe fichier agenda joint (.ics) ajoute ces horaires à ton calendrier.' + SIGN },
  dispo: { name: 'Demande de disponibilité', subject: 'Disponible pour « {projet} » ?', body: 'Bonjour {prenom},\n\nEs-tu disponible pour « {projet} » ({lieu}) ?\n\n{postes}\n\nRéponds en un clic : {lien}' + SIGN },
  confirmation: { name: 'Confirmation de poste', subject: 'Confirmé : {projet}', body: 'Bonjour {prenom},\n\nC\'est confirmé, merci ! Voici les détails :\n\nProjet : {projet}\nLieu : {lieu}\nAdresse : {adresse}\n\nTes postes :\n{postes}\n\nContact sur place : {contact}\n\nL\'agenda (.ics) est joint.' + SIGN },
  annulation: { name: 'Annulation de poste', subject: 'Annulation — {projet}', body: 'Bonjour {prenom},\n\nLe poste prévu pour « {projet} » ne te concerne finalement plus :\n\n{postes}\n\nMerci et à bientôt sur un prochain projet.' + SIGN },
  sous_location: { name: 'Commande de sous-location', subject: 'Commande — {projet}', body: 'Bonjour {prenom},\n\nVoici notre commande pour « {projet} » ({dates}).' + SIGN },
  autre: { name: 'Message libre', subject: '{projet}', body: 'Bonjour {prenom},\n\n' + SIGN },
};

/** Modèles d'un type : ceux enregistrés, sinon celui par défaut. */
export function templatesFor(s: Pick<Settings, 'mailTemplates'>, kind: MailKind): MailTemplate[] {
  const own = (s.mailTemplates || []).filter((t) => t.kind === kind);
  return own.length ? own : [{ id: 'default-' + kind, kind, ...DEFAULT_TEMPLATES[kind] }];
}

export function fillVars(text: string, vars: Record<string, string | undefined>): string {
  return text.replace(/\{([a-z_]+)\}/g, (m, k) => (k in vars ? vars[k] || '' : m)).replace(/ \(\)/g, '').replace(/\n{3,}/g, '\n\n');
}

/** Transforme un texte rempli en modèle : les valeurs connues redeviennent des {variables}. */
export function toTemplate(text: string, vars: Record<string, string | undefined>): string {
  let out = text;
  const entries = Object.entries(vars).filter(([, v]) => v && v.length >= 3).sort((a, b) => b[1]!.length - a[1]!.length);
  for (const [k, v] of entries) out = out.split(v!).join(`{${k}}`);
  return out;
}

export const newTemplate = (kind: MailKind, name: string, subject: string, body: string): MailTemplate => ({ id: uid(), kind, name, subject, body });
