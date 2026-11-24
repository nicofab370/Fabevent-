import { useState } from 'react';
import { createUser, hasUsers, setSession, verifyUser } from '../auth';
import { Field } from './ui';

/**
 * Écran de verrouillage : si la base a des comptes, il faut se connecter ;
 * sinon (premier lancement), on crée le compte administrateur.
 */
export function Login() {
  const any = hasUsers();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [pass2, setPass2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      if (any) {
        const u = await verifyUser(email, pass);
        if (!u) setErr('Email ou mot de passe incorrect.');
        else { setSession(u.id); location.reload(); }
      } else {
        if (!name.trim()) return setErr('Indique ton nom.');
        if (pass.length < 6) return setErr('Mot de passe : 6 caractères minimum.');
        if (pass !== pass2) return setErr('Les deux mots de passe ne correspondent pas.');
        const u = await createUser(name, email, pass, 'admin');
        setSession(u.id);
        location.reload();
      }
    } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="login-bg">
      <form className="card login-card" onSubmit={submit}>
        <h1 style={{ margin: '0 0 4px' }}>Fab<span style={{ color: 'var(--accent, #d97706)' }}>Event</span></h1>
        <p className="muted" style={{ marginTop: 0 }}>{any ? 'Connecte-toi pour ouvrir cette base.' : 'Première utilisation : crée le compte administrateur de cette base.'}</p>
        <div className="form">
          {!any && <Field label="Nom" full><input autoFocus value={name} onChange={(e) => setName(e.target.value)} aria-label="Nom" /></Field>}
          <Field label="Email" full><input type="email" required autoFocus={!!any} value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" /></Field>
          <Field label="Mot de passe" full><input type="password" required value={pass} onChange={(e) => setPass(e.target.value)} aria-label="Mot de passe" /></Field>
          {!any && <Field label="Répéter le mot de passe" full><input type="password" required value={pass2} onChange={(e) => setPass2(e.target.value)} aria-label="Répéter le mot de passe" /></Field>}
          {err && <p className="avail ko field full" style={{ margin: 0 }}>{err}</p>}
          <div className="form-actions">
            <button type="submit" disabled={busy}>{busy ? '…' : any ? 'Se connecter' : 'Créer le compte administrateur'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}
