import { useState } from 'react';
import { createUser, hasUsers, setSession, verifyUser } from '../auth';
import { Field } from './ui';
import { oauthAvailable, oauthLogin, OAUTH_PROVIDERS } from '../oauth';
import { verifyTotp } from '../totp';
import type { User } from '../types';

/**
 * Écran de verrouillage : si la base a des comptes, il faut se connecter ;
 * sinon (premier lancement), on crée le compte administrateur.
 * Avec MFA activé, un code TOTP (application d'authentification) est demandé après le mot de passe.
 * Les boutons Google / Microsoft / Apple n'apparaissent que si un serveur oauth.php est configuré.
 */
export function Login() {
  const any = hasUsers();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfaUser, setMfaUser] = useState<User | null>(null);
  const [code, setCode] = useState('');

  const open = (u: User) => { setSession(u.id); location.reload(); };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (any) {
        const u = await verifyUser(email, pass);
        if (!u) setErr('Email ou mot de passe incorrect.');
        else if (u.totpOn && u.totpSecret) { setMfaUser(u); setCode(''); }
        else open(u);
      } else {
        if (!name.trim()) return setErr('Indique ton nom.');
        if (pass.length < 6) return setErr('Mot de passe : 6 caractères minimum.');
        if (pass !== pass2) return setErr('Les deux mots de passe ne correspondent pas.');
        open(await createUser(name, email, pass, 'admin'));
      }
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaUser?.totpSecret) return;
    setErr('');
    setBusy(true);
    try {
      if (await verifyTotp(mfaUser.totpSecret, code)) open(mfaUser);
      else setErr('Code incorrect : vérifie l’heure de ton téléphone.');
    } finally { setBusy(false); }
  };

  const withProvider = async (provider: typeof OAUTH_PROVIDERS[number]['id']) => {
    setErr('');
    setBusy(true);
    try {
      const u = await oauthLogin(provider);
      if (u.totpOn && u.totpSecret) { setMfaUser(u); setCode(''); setBusy(false); } // MFA aussi après OAuth
      else open(u);
    } catch (e2) { setErr((e2 as Error).message); setBusy(false); }
  };

  return (
    <div className="login-bg">
      <form className="card login-card" onSubmit={mfaUser ? submitMfa : submit}>
        <h1 style={{ margin: '0 0 4px' }}>Fab<span style={{ color: 'var(--accent, #d97706)' }}>Event</span></h1>
        <p className="muted" style={{ marginTop: 0 }}>
          {mfaUser ? `Saisis le code à 6 chiffres de ton application d’authentification (${mfaUser.email}).`
            : any ? 'Connecte-toi pour ouvrir cette base.'
            : 'Première utilisation : crée le compte administrateur de cette base.'}
        </p>
        <div className="form">
          {!any && !mfaUser && <Field label="Nom" full><input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom" /></Field>}
          {!mfaUser && <Field label="Email" full><input type="email" required autoFocus={!!any} value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" readOnly={busy && !!mfaUser} /></Field>}
          {!mfaUser && <Field label="Mot de passe" full><input type="password" required value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Mot de passe" /></Field>}
          {!any && !mfaUser && <Field label="Répéter le mot de passe" full><input type="password" required value={pass2} onChange={(e) => setPass2(e.target.value)} aria-label="Répéter le mot de passe" /></Field>}
          {mfaUser && <Field label="Code à 6 chiffres" full><input inputMode="numeric" autoFocus pattern="[0-9]{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code MFA à 6 chiffres" style={{ fontSize: 22, letterSpacing: 4, textAlign: 'center' }} /></Field>}
          {err && <p className="avail ko field full" style={{ margin: 0 }}>{err}</p>}
          <div className="form-actions">
            <button type="submit" disabled={busy}>{busy ? '…' : mfaUser ? 'Vérifier le code' : any ? 'Se connecter' : 'Créer le compte administrateur'}</button>
            {mfaUser && <button type="button" className="secondary" onClick={() => { setMfaUser(null); setCode(''); setErr(''); }}>Retour</button>}
          </div>
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
