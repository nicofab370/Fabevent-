/** « Rechercher dans Peppol » : trouve l'identifiant Peppol d'une société dans l'annuaire public (par le serveur FabEvent). */
import { useState } from 'react';
import { currentWorkspace } from '../db';
import { serverScript } from '../mailer';
import { Modal } from './ui';

export function PeppolSearch({ c, onFound }: { c: { company?: string; vatNumber?: string; siret?: string }; onFound: (id: string) => void }) {
  const [res, setRes] = useState<{ id: string; name: string; country: string }[] | null>(null);
  const [msg, setMsg] = useState('');
  const url = serverScript('lookup.php');
  if (!url) return null;
  const search = async () => {
    const q = (c.vatNumber || c.siret || c.company || '').replace(/^BE/i, '').trim();
    if (!q) { setMsg('Indique d’abord le nom, le n° de TVA ou d’entreprise.'); setRes([]); return; }
    setMsg('Recherche…'); setRes([]);
    try {
      const r = await fetch(`${url}?peppol=${encodeURIComponent(q)}&ws=${encodeURIComponent(currentWorkspace())}`, { credentials: 'include', cache: 'no-store' });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail || 'Annuaire indisponible.');
      setRes(j.results || []);
      setMsg(j.results?.length ? '' : 'Aucune société trouvée dans l’annuaire Peppol.');
    } catch (e) { setMsg((e as Error).message); }
  };
  return (
    <>
      <button type="button" className="secondary small" onClick={search} title="Chercher l'identifiant dans l'annuaire public Peppol">Rechercher dans Peppol</button>
      {res && (
        <Modal title="Annuaire Peppol" onClose={() => setRes(null)}>
          {msg && <p className="muted">{msg}</p>}
          <ul className="pick-list">
            {res.map((r) => <li key={r.id}><button type="button" className="link-btn" onClick={() => { onFound(r.id); setRes(null); }}>{r.name || 'Sans nom'} <span className="muted">· {r.id}{r.country ? ` · ${r.country}` : ''}</span></button></li>)}
          </ul>
        </Modal>
      )}
    </>
  );
}
