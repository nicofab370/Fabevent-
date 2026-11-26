import { useState } from 'react';
import { applyPlace, applyVat, lookupVat, searchPlaces, type Place } from '../lookup';
import type { Contact } from '../types';
import { Icon } from './Icon';

type Draft = Partial<Contact>;

/**
 * Remplir la fiche d'un client ou d'un lieu automatiquement :
 * - par le n° de TVA (registre européen VIES : nom officiel, adresse, pays ; Peppol belge) ;
 * - par une recherche sur la carte (OpenStreetMap : adresse, téléphone).
 * Rien n'est enregistré avant « Enregistrer » : tout reste modifiable.
 */
export function ContactLookup<T extends Draft>({ c, setC }: { c: T; setC: (c: T) => void }) {
  const [q, setQ] = useState<string | null>(null);
  const [hits, setHits] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const byVat = async () => {
    setBusy('vat'); setMsg(null);
    try {
      const v = await lookupVat(c.vatNumber || '');
      if (!v.valid) setMsg({ ok: false, text: `N° de TVA ${v.vatNumber} inconnu ou inactif au registre européen (VIES).` });
      else { setC(applyVat(c, v)); setMsg({ ok: true, text: `Rempli depuis le registre TVA européen : ${[v.name, v.address, [v.postalCode, v.city].filter(Boolean).join(' ')].filter(Boolean).join(', ')}. À vérifier.` }); }
    } catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(''); }
  };
  const search = async (text: string) => {
    setBusy('map'); setMsg(null); setHits(null);
    try { const h = await searchPlaces(text); setHits(h); if (!h.length) setMsg({ ok: false, text: 'Rien trouvé : précise le nom et la ville.' }); }
    catch (e) { setMsg({ ok: false, text: (e as Error).message }); } finally { setBusy(''); }
  };
  const pick = (p: Place) => { setC(applyPlace(c, p)); setHits(null); setQ(null); setMsg({ ok: true, text: `Adresse reprise : ${[p.address, p.postalCode, p.city].filter(Boolean).join(', ')}. À vérifier.` }); };

  return (
    <div className="field full lookup">
      <div className="lookup-actions">
        <button type="button" className="secondary small" disabled={!!busy || !(c.vatNumber || '').trim()} onClick={byVat}
          title={(c.vatNumber || '').trim() ? 'Nom officiel, adresse et pays depuis le registre TVA européen (VIES)' : 'Saisis d’abord le n° de TVA'}>
          <Icon name="search" />{busy === 'vat' ? 'Recherche…' : 'Remplir depuis le n° TVA'}
        </button>
        <button type="button" className="secondary small" disabled={!!busy} onClick={() => { const t = [c.company, c.city].filter(Boolean).join(' '); setQ(t); setHits(null); if (t.trim()) search(t); }}
          title="Chercher l’adresse sur la carte (OpenStreetMap) d’après le nom et la ville">
          <Icon name="search" />Chercher l’adresse
        </button>
      </div>
      {q !== null && (
        <div className="lookup-search">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); search(q); } }}
            placeholder="ex. Parc de la Boverie Liège" aria-label="Rechercher une adresse" autoFocus />
          <button type="button" className="small" disabled={!!busy || !q.trim()} onClick={() => search(q)}>{busy === 'map' ? '…' : 'Chercher'}</button>
          <button type="button" className="ghost small" onClick={() => { setQ(null); setHits(null); }}>Fermer</button>
        </div>
      )}
      {hits && hits.length > 0 && (
        <ul className="lookup-hits">
          {hits.map((h, i) => <li key={i}><button type="button" onClick={() => pick(h)}><strong>{h.name || h.address || h.city}</strong><span className="muted">{h.label}</span></button></li>)}
        </ul>
      )}
      {msg && <p className={'avail ' + (msg.ok ? 'ok' : 'ko')} style={{ margin: '4px 0 0' }}>{msg.text}</p>}
    </div>
  );
}
