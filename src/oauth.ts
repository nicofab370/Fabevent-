/*
 * Connexion externe (OAuth 2.0 / OIDC) : Google, Microsoft, Apple.
 *
 * Déroulement : une popup s'ouvre sur oauth.php (à côté de sync.php sur l'hébergement),
 * qui redirige vers le fournisseur (avec state + PKCE), revient en callback, échange le code
 * côté serveur et renvoie à l'application un code à usage unique par postMessage.
 * L'application échange ce code contre le profil vérifié (POST oauth.php?action=login),
 * puis rattache le compte local par email (voir auth.linkOAuth).
 *
 * Sans serveur configuré (GitHub Pages, poste isolé), les boutons ne sont pas proposés.
 */
import { linkOAuth } from './auth';
import { currentWorkspace } from './db';
import { serverScript } from './mailer';
import type { OAuthProvider, User } from './types';

export const OAUTH_PROVIDERS: { id: OAuthProvider; label: string }[] = [
  { id: 'google', label: 'Google' },
  { id: 'microsoft', label: 'Microsoft' },
  { id: 'apple', label: 'Apple' },
];

interface OAuthProfile { email: string; name?: string; provider: OAuthProvider; sub: string }

export const oauthAvailable = () => !!serverScript('oauth.php');

export function oauthLogin(provider: OAuthProvider): Promise<User> {
  return new Promise((resolve, reject) => {
    const base = serverScript('oauth.php');
    if (!base) { reject(new Error('Pas de serveur configuré (Paramètres → Synchronisation).')); return; }
    let origin: string;
    try { origin = new URL(base).origin; } catch { reject(new Error('Adresse du serveur invalide.')); return; }
    const url = `${base}?action=authorize&provider=${provider}&app=${encodeURIComponent(location.origin)}`;
    const win = window.open(url, 'fabevent-oauth', 'width=520,height=680');
    if (!win) { reject(new Error('Popup bloquée : autorise les popups pour ce site, puis réessaie.')); return; }
    let done = false;
    const finish = (fn: () => void) => { if (done) return; done = true; clearInterval(timer); window.removeEventListener('message', onMsg); fn(); };
    const timer = setInterval(() => { if (win.closed) finish(() => reject(new Error('Connexion annul\u00e9e.'))); }, 500);
    const onMsg = async (ev: MessageEvent) => {
      if (ev.origin !== origin) return;
      const d = ev.data;
      if (!d || d.source !== 'fabevent-oauth' || typeof d.code !== 'string' || !d.code) return;
      finish(() => {});
      try {
        const r = await fetch(`${base}?action=login&code=${encodeURIComponent(d.code)}&ws=${encodeURIComponent(currentWorkspace())}`, { method: 'POST', credentials: 'include' });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.ok) throw new Error(j.error || 'Échec de la connexion externe.');
        const p = j.profile as OAuthProfile;
        const u = await linkOAuth(p.email, p.provider, p.sub, p.name);
        if (!u.active) { reject(new Error('Ce compte vient d\u00eatre créé et doit être validé par un administrateur (Paramètres → Utilisateurs).')); return; }
        resolve(u);
      } catch (e) { reject(e as Error); }
    };
    window.addEventListener('message', onMsg);
  });
}
