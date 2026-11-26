import { useLiveQuery } from 'dexie-react-hooks';
import { currentWorkspace, db } from './db';
import type { OAuthProvider, Role, User } from './types';
import { uid } from './utils';

/** compte ouvert sur l'appareil, propre à chaque base (on passe d'une base à l'autre sans se reconnecter) */
const SESS = 'fab.session';
const sessKey = (ws = currentWorkspace()) => `${SESS}.${ws}`;

/** Hachage SHA-256 salé (WebCrypto, dispo partout en HTTPS/localhost). */
export async function hashPass(pass: string, salt: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pass}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const newSalt = () => uid() + uid();

export async function createUser(name: string, email: string, pass: string, role: Role, personId?: string): Promise<User> {
  const mail = email.trim().toLowerCase();
  if (await db.users.where({ email: mail }).count()) throw new Error('Cette adresse email est déjà utilisée.');
  const salt = newSalt();
  const u: User = { id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), name: name.trim(), email: mail, salt, passHash: await hashPass(pass, salt), role, personId: personId || undefined, active: true };
  await db.users.put(u);
  return u;
}

export async function verifyUser(email: string, pass: string): Promise<User | null> {
  const u = await db.users.where({ email: email.trim().toLowerCase() }).first();
  if (!u || !u.active) return null;
  return (await hashPass(pass, u.salt)) === u.passHash ? u : null;
}

// (ancienne clé commune à toutes les bases : encore lue, le temps d'une reconnexion)
export const sessionUserId = (): string | null => { try { return localStorage.getItem(sessKey()) ?? localStorage.getItem(SESS); } catch { return null; } };
export function setSession(id: string | null, ws?: string) {
  try {
    if (id) localStorage.setItem(sessKey(ws), id); else localStorage.removeItem(sessKey(ws));
    localStorage.removeItem(SESS);
  } catch { /* sans stockage */ }
}
/** se déconnecter : de toutes les bases de l'appareil */
export function logout() {
  try { for (const k of Object.keys(localStorage)) if (k === SESS || k.startsWith(SESS + '.')) localStorage.removeItem(k); } catch { /* sans stockage */ }
}

/** Base sans aucun compte = accès administrateur implicite (démo, première ouverture). */
const OPEN_ADMIN: User = { id: '', createdAt: '', updatedAt: '', name: 'Base ouverte', email: '', salt: '', passHash: '', role: 'admin', active: true };

/** Utilisateur connecté ; admin implicite si la base n'a pas de comptes, null si verrouillée sans session. */
export function useUser(): User | null {
  return useLiveQuery(async () => {
    const all = await db.users.toArray();
    if (all.length === 0) return OPEN_ADMIN;
    const id = sessionUserId();
    const u = id ? all.find((x) => x.id === id) : undefined;
    return u && u.active ? u : undefined;
  }, []) || null;
}

export function hasUsers(): boolean | undefined {
  return useLiveQuery(() => db.users.count().then((n) => n > 0), []);
}

/* ---------- permissions par rôle : voir src/roles.ts ---------- */

async function findUserByEmail(email: string): Promise<User | undefined> {
  return db.users.where({ email: email.trim().toLowerCase() }).first();
}

/**
 * Connexion externe (Google / Microsoft / Apple) : le serveur a vérifié l'identité du fournisseur
 * et renvoie un profil (email vérifié). On rattache à un compte existant par email ;
 * sinon on crée un compte désactivé (un administrateur devra l'activer et lui donner un rôle).
 */
export async function linkOAuth(email: string, provider: OAuthProvider, sub: string, name?: string): Promise<User> {
  const mail = email.trim().toLowerCase();
  if (!mail) throw new Error('Le fournisseur n\'a pas renvoyé d\'adresse email vérifiée.');
  const now = new Date().toISOString();
  let u = await findUserByEmail(mail);
  if (!u) {
    u = { id: uid(), createdAt: now, updatedAt: now, name: (name || mail).trim(), email: mail, salt: '', passHash: '', role: 'subcontractor', active: false, oauth: [{ provider, sub }] };
    await db.users.put(u);
    return u;
  }
  const oauth = [...(u.oauth || []).filter((o) => !(o.provider === provider && o.sub === sub)), { provider, sub }];
  await db.users.update(u.id, { oauth, updatedAt: now });
  return { ...u, oauth };
}
