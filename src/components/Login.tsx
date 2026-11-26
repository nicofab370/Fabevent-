import { useEffect, useState } from 'react';
import { createUser, hasUsers, sessionUserId, setSession, verifyUser } from '../auth';
import { db } from '../db';
import { clearLoginRequest, loginRequested, serverLogin, serverOn, serverSetup, serverStatus, type AuthError, type ServerStatus } from '../serverAuth';
import { Field } from './ui';
import { oauthAvailable, oauthLogin, OAUTH_PROVIDERS } from '../oauth';
import { verifyTotp } from '../totp';
import { serverScript } from '../mailer';
import type { User } from '../types';

/**
 * Écran de verrouillage : si la base a des comptes (sur l'appareil ou sur le serveur FabEvent), il faut se connecter ;
 * sinon (premier lancement), on crée le compte administrateur.
 * Avec un serveur, la connexion passe par lui (api/auth.php : session de 60 jours) ; hors ligne, par les comptes gardés sur l'appareil.
 * Avec MFA activé, un code TOTP (application d'authentification) est demandé après le mot de passe.
 * Les boutons Google / Microsoft / Apple n'apparaissent que si un serveur oauth.php est configuré.
 */
export function Login() {
  const anyLocal = hasUsers();
  /** état du serveur FabEvent pour cette base (undefined = vérification, null = pas de serveur / injoignable) */
  const [srv, setSrv] = useState<ServerStatus | null | undefined>(serverOn() ? undefined : null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [setupCode, setSetupCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  /** étape MFA : par le serveur (email + mot de passe renvoyés avec le code) ou sur l'appareil (compte local) */
  const [mfa, setMfa] = useState<{ server: boolean; email: string; pass: string; local?: User; setup?: boolean } | null>(null);
  const [code, setCode] = useState('');
  const [forgot, setForgot] = useState(false);
  const [fEmail, setFEmail] = useState('');
  const [fMsg, setFMsg] = useState('');
  const [fErr, setFErr] = useState('');
  const [fBusy, setFBusy] = useState(false);

  useEffect(() => {
    if (serverOn()) serverStatus().then((s) => setSrv(s));
    // reconnexion : l'email du compte ouvert sur cet appareil est déjà rempli
    const id = sessionUserId();
    if (id) db.users.get(id).then((u) => { if (u) setEmail((e) => e || u.email); });
  }, []);

  /** la base a des comptes (sur l'appareil ou sur le serveur) : on se connecte ; sinon on crée l'administrateur */
  const any = anyLocal === true || !!srv?.users;
  const needCode = srv?.setup === 'code';
  const reachable = !!srv;

  const open = (u: User) => { setSession(u.id); clearLoginRequest(); location.reload(); };

  /** Demande un lien de réinitialisation par email (serveur public.php à côté de sync.php). */
  const requestReset = async () => {
    setFMsg(''); setFErr(''); setFBusy(true);
    try {
      const url = serverScript('public.php');
      if (!url) {
        setFErr('Pas de serveur FabEvent sur cet appareil : demande à un administrateur de redéfinir ton mot de passe (Paramètres → Utilisateurs → « Mot de passe… »).');
        return;
      }
      let r: Response;
      try {
        r = await fetch(url + '?action=reset_request', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fEmail }) });
      } catch {
        setFErr('Serveur injoignable (hors ligne ?). Réessaie plus tard, ou demande à un administrateur de redéfinir ton mot de passe.');
        return;
      }
      const j = await r.json().catch(() => ({} as Record<string, unknown>));
      if (r.ok && j.ok) setFMsg('Si un compte existe avec cet email, un lien de réinitialisation vient d’être envoyé (valable 2 h, une seule fois). Pense aux spams.');
      else if (j.error === 'mail_failed') setFErr('Le serveur n’a pas pu envoyer l’email (' + String(j.detail || 'envoi indisponible') + '). Contacte ton administrateur.');
      else setFErr('Demande impossible pour l’instant (' + String(j.detail || j.error || r.status) + ').');
    } finally { setFBusy(false); }
  };

  /** Compte vérifié sur l'appareil : s'il n'existe pas encore sur le serveur, il y devient le premier administrateur. */
  const finishLocal = async (u: User, setup: boolean) => {
    if (setup) {
      if (u.role !== 'admin') throw new Error('Cette base n’a pas encore de compte sur le serveur : un administrateur doit se connecter en premier sur cet appareil.');
      await serverSetup(u, setupCode);
    }
    open(u);
  };

  /** Connexion avec le mot de passe sur l'appareil seulement (hors ligne, ou base sans serveur). */
  const loginLocal = async (setup: boolean) => {
    const u = await verifyUser(email, pass);
    if (!u) return setErr('Email ou mot de passe incorrect.');
    if (u.totpOn && u.totpSecret) { setMfa({ server: false, email, pass, local: u, setup }); setCode(''); return; }
    await finishLocal(u, setup);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (any) {
        if (!reachable) return await loginLocal(false);
        if (!srv?.users) { // comptes sur l'appareil, pas encore sur le serveur : ce compte y devient le premier
          if (needCode && !setupCode.trim()) return setErr('Indique le code d’installation (voir ci-dessous).');
          return await loginLocal(true);
        }
        try { open(await serverLogin(email, pass)); }
        catch (e2) {
          const k = (e2 as AuthError).kind;
          if (k === 'mfa') { setMfa({ server: true, email, pass }); setCode(''); }
          else if (k === 'offline') await loginLocal(false);
          else setErr((e2 as Error).message);
        }
      } else {
        if (!name.trim()) return setErr('Indique ton nom.');
        if (pass.length < 6) return setErr('Mot de passe : 6 caractères minimum.');
        if (pass !== pass2) return setErr('Les deux mots de passe ne correspondent pas.');
        if (reachable && needCode && !setupCode.trim()) return setErr('Indique le code d’installation (voir ci-dessous).');
        const u = await createUser(name, email, pass, 'admin');
        await finishLocal(u, reachable);
      }
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfa) return;
    setErr('');
    setBusy(true);
    try {
      if (mfa.server) open(await serverLogin(mfa.email, mfa.pass, code));
      else if (mfa.local?.totpSecret && await verifyTotp(mfa.local.totpSecret, code)) await finishLocal(mfa.local, !!mfa.setup);
      else setErr('Code incorrect : vérifie l’heure de ton téléphone.');
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };

  const withProvider = async (provider: typeof OAUTH_PROVIDERS[number]['id']) => {
    setErr('');
    setBusy(true);
    try {
      const u = await oauthLogin(provider);
      if (u.totpOn && u.totpSecret) { setMfa({ server: false, email: u.email, pass: '', local: u }); setCode(''); setBusy(false); } // MFA aussi après OAuth
      else open(u);
    } catch (e2) { setErr((e2 as Error).message); setBusy(false); }
  };

  const mfaUser = mfa;
  return (
    <div className="login-bg">
      <form className="card login-card" onSubmit={mfaUser ? submitMfa : submit}>
        <h1 style={{ margin: '0 0 4px' }}>Fab<span style={{ color: 'var(--accent, #d97706)' }}>Event</span></h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {srv === undefined ? 'Vérification du serveur FabEvent…'
            : mfaUser ? `Saisis le code à 6 chiffres de ton application d’authentification (${mfaUser.email}).`
            : any ? 'Connecte-toi avec ton compte FabEvent.'
            : 'Première utilisation : crée le compte administrateur de cette base.'}
        </p>
        <div className="form">
          {!any && !mfaUser && <Field label="Nom" full><input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom" /></Field>}
          {!mfaUser && <Field label="Email" full><input type="email" required autoFocus={!!any} value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" readOnly={busy && !!mfaUser} /></Field>}
          {!mfaUser && <Field label="Mot de passe" full><input type="password" required value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Mot de passe" /></Field>}
          {!any && !mfaUser && <Field label="Répéter le mot de passe" full><input type="password" required value={pass2} onChange={(e) => setPass2(e.target.value)} aria-label="Répéter le mot de passe" /></Field>}
          {mfaUser && <Field label="Code à 6 chiffres" full><input inputMode="numeric" autoFocus pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code MFA à 6 chiffres" style={{ fontSize: 22, letterSpacing: 4, textAlign: 'center' }} /></Field>}
          {!mfaUser && reachable && needCode && !srv?.users && (
            <Field label="Code d’installation" full>
              <input value={setupCode} onChange={(e) => setSetupCode(e.target.value.toUpperCase())} aria-label="Code d’installation" placeholder="10 lettres et chiffres" autoComplete="off" />
            </Field>
          )}
          {!mfaUser && reachable && needCode && !srv?.users && <p className="muted field full" style={{ margin: 0, fontSize: 12 }}>Le serveur contient déjà des données : pour créer le premier compte, il faut le code d’installation. Soit celui du fichier <code>code-installation.txt</code> (dossier de données de FabEvent, voir <code>api/diag.php</code>), soit celui que tu choisis dans <code>api/fabevent-config.php</code> (<code>'setup_code' =&gt; '…'</code>, déposé par FTP).</p>}
          {serverOn() && srv === null && <p className="muted field full" style={{ margin: 0, fontSize: 12 }}>Serveur FabEvent injoignable : connexion sur cet appareil uniquement ; la synchronisation reprendra après une connexion en ligne.</p>}
          {err && <p className="avail ko field full" style={{ margin: 0 }}>{err}</p>}
          <div className="form-actions">
            <button type="submit" disabled={busy || srv === undefined}>{busy ? '…' : mfaUser ? 'Vérifier le code' : any ? 'Se connecter' : 'Créer le compte administrateur'}</button>
            {mfaUser && <button type="button" className="secondary" onClick={() => { setMfa(null); setCode(''); setErr(''); }}>Retour</button>}
            {!mfaUser && loginRequested() && <button type="button" className="secondary" onClick={() => { clearLoginRequest(); location.reload(); }} title="Revenir à FabEvent sans te reconnecter : tes modifications restent sur cet appareil">Plus tard</button>}
          </div>
          {any && !mfaUser && !forgot && (
            <p style={{ textAlign: 'center', margin: '12px 0 0' }}>
              <button type="button" className="secondary small" title="Un lien de réinitialisation (valable 2 h) est envoyé par email si un serveur FabEvent est configuré" onClick={() => { setForgot(true); setFEmail(email); setFMsg(''); setFErr(''); }}>Mot de passe oublié ?</button>
            </p>
          )}
          {any && !mfaUser && forgot && (
            <div className="info" style={{ marginTop: 12 }}>
              <p className="muted" style={{ margin: '0 0 8px' }}>Indique l’email de ton compte : un lien de réinitialisation (valable 2 h, une seule fois) est envoyé par le serveur FabEvent, s’il est configuré.</p>
              <Field label="Email du compte" full><input type="email" required value={fEmail} onChange={(e) => setFEmail(e.target.value)} aria-label="Email du compte pour la réinitialisation" /></Field>
              {fMsg && <p className="avail ok" style={{ margin: '8px 0' }}>{fMsg}</p>}
              {fErr && <p className="avail ko" style={{ margin: '8px 0' }}>{fErr}</p>}
              <div className="form-actions">
                <button type="button" disabled={fBusy} onClick={requestReset}>{fBusy ? '…' : 'Envoyer le lien de réinitialisation'}</button>
                <button type="button" className="secondary" onClick={() => setForgot(false)}>Retour</button>
              </div>
            </div>
          )}
          {any && !mfaUser && oauthAvailable() && (
            <>
              <div className="muted" style={{ textAlign: 'center', margin: '10px 0 4px', fontSize: 11 }}>ou</div>
              <div className="oauth-btns">
                {OAUTH_PROVIDERS.map((p) => (
                  <button key={p.id} type="button" className="secondary oauth-btn" disabled={busy} onClick={() => withProvider(p.id)} aria-label={`Se connecter avec ${p.label}`}>
                    {p.label}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </form>
    </div>
  );
}
