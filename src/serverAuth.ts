import { currentWorkspace, db } from './db';
import type { User } from './types';
import { serverScript } from './mailer';
import { syncEnabled } from './sync';

/**
 * Connexion au serveur FabEvent (api/auth.php) avec les comptes FabEvent eux-mêmes.
 * Aucune dépendance aux pages internes du site : FabEvent existe seul (ex. fabri.live/fabevent).
 *
 * Le serveur garde une session (cookie, 60 jours, prolongée à l'usage). Si elle disparaît
 * (données du site effacées, nouvel appareil, mot de passe changé), l'application le signale
 * et demande simplement de se reconnecter : les modifications restent sur l'appareil en attendant.
 */

export interface ServerStatus { ok: boolean; session: boolean; user?: User | null; users: boolean; setup: 'open' | 'code' | null }
export type AuthError = Error & { kind?: 'bad' | 'mfa' | 'mfa_bad' | 'too_many' | 'setup_code' | 'exists' | 'offline' | 'server' };

const FLAG = 'fab.login';
const authUrl = () => serverScript('auth.php');
/** Le serveur FabEvent est-il configuré pour cette base ? */
export const serverOn = () => syncEnabled() && !!authUrl();

const fail = (kind: AuthError['kind'], msg: string): AuthError => Object.assign(new Error(msg), { kind });

async function call(action: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = authUrl();
  if (!url) throw fail('offline', 'Pas de serveur FabEvent configuré.');
  let r: Response;
  try {
    r = await fetch(`${url}?action=${action}&ws=${encodeURIComponent(currentWorkspace())}`, {
      method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify({ ws: currentWorkspace(), ...body }) : undefined,
    });
  } catch { throw fail('offline', 'Serveur injoignable (hors ligne ?).'); }
  if ((r.headers.get('content-type') || '').includes('text/html')) throw fail('offline', 'Serveur FabEvent non atteint (api/auth.php absent ?).');
  const j = await r.json().catch(() => ({} as Record<string, unknown>));
  if (r.ok && j.ok) return j;
  const e = String(j.error || '');
  if (e === 'bad') throw fail('bad', 'Email ou mot de passe incorrect.');
  if (e === 'mfa') throw fail('mfa', 'Code MFA demandé.');
  if (e === 'mfa_bad') throw fail('mfa_bad', 'Code incorrect : vérifie l’heure de ton téléphone.');
  if (e === 'too_many') throw fail('too_many', 'Trop d’essais : réessaie dans 15 minutes.');
  if (e === 'setup_code') throw fail('setup_code', 'Code d’installation incorrect.');
  if (e === 'exists') throw fail('exists', 'Cette base a déjà un compte sur le serveur : connecte-toi avec lui.');
  throw fail('server', String(j.detail || e || `Erreur du serveur (${r.status})`));
}

export async function serverStatus(): Promise<ServerStatus | null> {
  if (!serverOn()) return null;
  try { return (await call('status')) as unknown as ServerStatus; } catch { return null; }
}

/** Garde (ou met à jour) le compte sur l'appareil, pour pouvoir se connecter aussi hors ligne. */
async function keep(u: User | undefined): Promise<User> {
  if (!u?.id) throw fail('server', 'Réponse du serveur incomplète.');
  const local = await db.users.get(u.id);
  if (!local || String(local.updatedAt || '') < String(u.updatedAt || '') || local.passHash !== u.passHash) await db.users.put(u);
  return u;
}

export async function serverLogin(email: string, password: string, code?: string): Promise<User> {
  const j = await call('login', { email, password, code: code || undefined });
  return keep(j.user as User);
}

/** Premier compte administrateur d'une base sur le serveur (code d'installation si le serveur a déjà des données). */
export async function serverSetup(user: User, code?: string): Promise<User> {
  const j = await call('setup', { user, code: code || undefined });
  return keep(j.user as User);
}

export async function serverLogout() {
  if (!serverOn()) return;
  try { await call('logout', {}); } catch { /* hors ligne : la session expirera d'elle-même */ }
}

/** Affiche l'écran de connexion (reconnexion au serveur), sans rien effacer sur l'appareil. */
export function requestLogin() {
  try { sessionStorage.setItem(FLAG, '1'); } catch { /* sans stockage */ }
  location.reload();
}
export const loginRequested = () => { try { return sessionStorage.getItem(FLAG) === '1'; } catch { return false; } };
export const clearLoginRequest = () => { try { sessionStorage.removeItem(FLAG); } catch { /* sans stockage */ } };
