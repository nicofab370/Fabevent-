import { useEffect, useState } from 'react';
import { currentWorkspace } from '../db';
import { onSync, pushEverything, setSyncUrl, syncNow, syncUrl, type SyncState } from '../sync';
import { fmtDate } from '../utils';

export function useSyncState() {
  const [s, setS] = useState<SyncState>({ status: 'off', pending: 0 });
  useEffect(() => onSync(setS), []);
  return s;
}

/** Petit état de la synchro, en bas du menu. */
export function SyncBadge({ online }: { online: boolean }) {
  const s = useSyncState();
  const label = s.status === 'off' ? 'données locales'
    : s.status === 'busy' ? 'synchronisation…'
      : s.status === 'auth' ? 'synchro : connexion requise'
        : s.status === 'error' ? 'synchro en erreur'
          : s.pending ? `${s.pending} modification(s) à envoyer` : 'synchronisé';
  return <div className={'net ' + (online ? 'on' : 'off')} title={s.message || ''}>{online ? '● En ligne' : '● Hors ligne'} · {label}</div>;
}

/** Réglages de la synchronisation (page Paramètres). */
export function SyncPanel() {
  const s = useSyncState();
  const [url, setUrl] = useState(syncUrl());
  const demo = currentWorkspace() === 'demo';
  return (
    <div className="card">
      <h2>Synchronisation entre appareils</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Avec le serveur de synchronisation (fichier <code>sync.php</code> sur ton hébergement), tous les appareils connectés partagent les mêmes
        données, automatiquement : toutes les 20 secondes, dès qu'une modification est faite et au retour du réseau. Sans réseau, tout continue
        de fonctionner et part plus tard. Les numéros de facture sont attribués par le serveur pour éviter les doublons.
      </p>
      {demo ? <p className="muted">La base de démonstration n'est jamais synchronisée.</p> : (
        <>
          <div className="toolbar">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://fabri.live/fabevent/api/sync.php" style={{ maxWidth: 420 }} aria-label="Adresse du serveur de synchronisation" />
            <button className="secondary" onClick={() => setSyncUrl(url)}>Enregistrer</button>
            <button disabled={!syncUrl()} onClick={() => syncNow()}>Synchroniser maintenant</button>
          </div>
          <p>
            État : <strong>{{ off: 'désactivée', idle: 'à jour', busy: 'en cours…', offline: 'hors ligne', auth: 'connexion requise', error: 'erreur' }[s.status]}</strong>
            {s.pending > 0 && ` · ${s.pending} modification(s) en attente`}
            {s.last && ` · dernière synchro ${fmtDate(s.last)}`}
            {s.message && <span className="avail ko"> — {s.message}</span>}
          </p>
          {s.status === 'auth' && <p><a href={new URL('/interne/login.php?r=' + encodeURIComponent(location.pathname), location.href).href}>Se connecter aux pages internes</a> puis revenir ici.</p>}
          <button className="secondary small" disabled={!syncUrl()} onClick={() => { if (confirm('Envoyer toutes les données de cet appareil au serveur ? (à faire une fois, depuis l\'appareil qui a les bonnes données)')) pushEverything(); }}>
            Envoyer toutes les données de cet appareil
          </button>
        </>
      )}
    </div>
  );
}
