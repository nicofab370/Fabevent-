import { useEffect, useState } from 'react';
import { currentWorkspace } from '../db';
import { onSync, pushEverything, setSyncUrl, syncNow, syncUrl, type SyncState } from '../sync';
import { fmtDate } from '../utils';
import { requestLogin } from '../serverAuth';
import { Icon } from './Icon';

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
  // connexion au serveur expirée : le badge ouvre l'écran de connexion FabEvent
  if (s.status === 'auth') return <button type="button" className="net off net-login" onClick={requestLogin} title="Se reconnecter au serveur FabEvent pour synchroniser et envoyer les mails"><Icon name="dot" size="0.7em" />{label} — se reconnecter</button>;
  return <div className={'net ' + (online ? 'on' : 'off')} title={s.message || ''}><Icon name="dot" size="0.7em" />{online ? 'En ligne' : 'Hors ligne'} · {label}</div>;
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
        Chaque base a sa propre adresse de serveur : une base « société isolée » peut viser un autre serveur ou une autre connexion interne.
      </p>
      {demo ? <p className="muted">La base de démonstration n'est jamais synchronisée.</p> : (
        <>
          <div className="toolbar">
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://fabri.live/fabevent/api/sync.php" style={{ maxWidth: 420 }} aria-label="Adresse du serveur de synchronisation (propre à cette base)" />
            <button className="secondary" onClick={() => setSyncUrl(url)}>Enregistrer</button>
            <button disabled={!syncUrl()} onClick={() => syncNow()}>Synchroniser maintenant</button>
          </div>
          <p>
            État : <strong>{{ off: 'désactivée', idle: 'à jour', busy: 'en cours…', offline: 'hors ligne', auth: 'connexion requise', error: 'erreur' }[s.status]}</strong>
            {s.pending > 0 && ` · ${s.pending} modification(s) en attente`}
            {s.last && ` · dernière synchro ${fmtDate(s.last)}`}
            {s.message && <span className="avail ko"> — {s.message}</span>}
          </p>
          {s.status === 'auth' && <p><button type="button" className="small" onClick={requestLogin}>Se reconnecter au serveur FabEvent</button></p>}
          <button className="secondary small" disabled={!syncUrl()} onClick={() => { if (confirm('Envoyer toutes les données de cet appareil au serveur ? (à faire une fois, depuis l\'appareil qui a les bonnes données)')) pushEverything(); }}>
            Envoyer toutes les données de cet appareil
          </button>
        </>
      )}
    </div>
  );
}
