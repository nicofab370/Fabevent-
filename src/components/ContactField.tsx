import { useState } from 'react';
import { fold as norm } from '../utils';
import type { Contact } from '../types';
import { Icon } from './Icon';
import { Empty, Modal } from './ui';

/*
 * Choisir un client ou un lieu sans longue liste déroulante :
 * on tape quelques lettres (nom, ville, code postal) et les correspondances s'affichent,
 * ou « Parcourir » ouvre une fenêtre avec recherche et filtres (ville, étiquette).
 */

const haystack = (c: Contact) => norm([c.company, c.city, c.postalCode, c.address, c.firstName, c.lastName, ...(c.tags || [])].filter(Boolean).join(' '));
const matches = (c: Contact, q: string) => norm(q).split(/\s+/).filter(Boolean).every((w) => haystack(c).includes(w));
const place = (c: Contact) => [c.postalCode, c.city].filter(Boolean).join(' ');

export function ContactField({ contacts, value, onChange, label, placeholder }: {
  contacts: Contact[];
  value?: string;
  onChange: (id: string | undefined) => void;
  /** « lieu », « client »… (dans les textes de la fenêtre) */
  label: string;
  placeholder?: string;
}) {
  const current = contacts.find((c) => c.id === value);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [browse, setBrowse] = useState(false);
  const results = q.trim() ? contacts.filter((c) => matches(c, q)).sort((a, b) => Number(!norm(a.company).startsWith(norm(q))) - Number(!norm(b.company).startsWith(norm(q))) || a.company.localeCompare(b.company, 'fr')).slice(0, 8) : [];
  const pick = (c?: Contact) => { onChange(c?.id); setQ(''); setOpen(false); setHi(0); };

  return (
    <div className="contact-field">
      <div className="quick-add-box">
        <input
          value={open ? q : current?.company || ''}
          placeholder={placeholder || `Tape quelques lettres du ${label}…`}
          aria-label={`Rechercher un ${label}`}
          onFocus={() => { setOpen(true); setQ(''); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQ(e.target.value); setHi(0); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); if (results[hi]) pick(results[hi]); }
            else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); (e.target as HTMLInputElement).blur(); }
          }} />
        {open && q.trim() !== '' && (
          <ul className="quick-add-list" role="listbox" aria-label={`${label} correspondants`}>
            {results.length === 0 && <li className="muted">Aucun {label} ne correspond</li>}
            {results.map((c, i) => (
              <li key={c.id} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''} onMouseDown={(ev) => { ev.preventDefault(); pick(c); }}>
                <span>{c.company}</span><span className="muted">{place(c)}</span>
              </li>
            ))}
            <li className="qa-browse" onMouseDown={(ev) => { ev.preventDefault(); setOpen(false); setBrowse(true); }}>Parcourir avec filtres…</li>
          </ul>
        )}
      </div>
      <button type="button" className="secondary small" title={`Choisir un ${label} dans une fenêtre avec filtres`} aria-label={`Parcourir les ${label}s`} onClick={() => setBrowse(true)}><Icon name="search" /></button>
      {current && <button type="button" className="ghost small" title={`Retirer le ${label}`} aria-label={`Retirer le ${label}`} onClick={() => pick(undefined)}><Icon name="x" /></button>}
      {browse && <ContactChooser contacts={contacts} label={label} initialQ={q} onPick={(c) => { pick(c); setBrowse(false); }} onClose={() => setBrowse(false)} />}
    </div>
  );
}

/** fenêtre : recherche, filtre par ville et par étiquette, liste avec adresse */
function ContactChooser({ contacts, label, initialQ = '', onPick, onClose }: { contacts: Contact[]; label: string; initialQ?: string; onPick: (c: Contact) => void; onClose: () => void }) {
  const [q, setQ] = useState(initialQ);
  const [city, setCity] = useState('');
  const [tag, setTag] = useState('');
  const base = contacts.filter((c) => matches(c, q));
  const cities = Array.from(base.reduce((m, c) => (c.city ? m.set(c.city.trim(), (m.get(c.city.trim()) || 0) + 1) : m), new Map<string, number>()))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr')).slice(0, 12);
  const tags = Array.from(new Set(contacts.flatMap((c) => c.tags || []))).sort();
  const list = base.filter((c) => (!city || c.city?.trim() === city) && (!tag || c.tags?.includes(tag))).sort((a, b) => a.company.localeCompare(b.company, 'fr'));
  return (
    <Modal title={`Choisir un ${label}`} onClose={onClose} wide>
      <div className="picker" onKeyDown={(e) => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); if (list.length === 1) onPick(list[0]); } }}>
        <div className="picker-filters">
          <input autoFocus placeholder="Rechercher (nom, ville, code postal, adresse, étiquette)…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Rechercher dans les ${label}s`} />
          {cities.length > 1 && (
            <div className="chips" aria-label="Villes">
              <button type="button" className={'chip' + (!city ? ' on' : '')} onClick={() => setCity('')}>Toutes ({base.length})</button>
              {cities.map(([c, n]) => <button type="button" key={c} className={'chip' + (city === c ? ' on' : '')} onClick={() => setCity(city === c ? '' : c)}>{c} ({n})</button>)}
            </div>
          )}
          {tags.length > 0 && (
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 'auto' }} aria-label="Étiquette">
                <option value="">Toutes étiquettes</option>
                {tags.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="pick-list">
          {list.length === 0 ? <Empty>Aucun {label}.</Empty> : list.map((c) => (
            <div key={c.id} className="pick-row contact-row" role="button" tabIndex={0} onClick={() => onPick(c)} onKeyDown={(e) => { if (e.key === 'Enter') onPick(c); }}>
              <div className="pick-name">
                <div><strong>{c.company}</strong></div>
                <div className="muted" style={{ fontSize: 11 }}>{[c.address, place(c), c.phone].filter(Boolean).join(' · ')}</div>
              </div>
              <span className="muted">{(c.spots?.length ? `${c.spots.length} endroit(s)` : '') || (c.persons?.length ? `${c.persons.length} contact(s)` : '')}</span>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
