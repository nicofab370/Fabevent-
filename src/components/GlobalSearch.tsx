import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db';
import { DOC_LABELS } from '../types';
import { Icon, type IconName } from './Icon';

interface Hit { kind: string; icon: IconName; label: string; sub?: string; to: string }

/**
 * Recherche globale (Ctrl+K / Cmd+K) : projets, matériel (nom, code, code-barres, étiquettes),
 * unités sérialisées, contacts, techniciens et documents. Entrée = ouvre le résultat sélectionné.
 */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const nav = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => { if (!o) setTimeout(() => inputRef.current?.focus(), 30); return !o; });
        setQ(''); setSel(0);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const equipment = useLiveQuery(() => db.equipment.toArray(), []) || [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) || [];
  const people = useLiveQuery(() => db.people.toArray(), []) || [];
  const docs = useLiveQuery(() => db.docs.toArray(), []) || [];
  const units = useLiveQuery(() => db.units.toArray(), []) || [];

  const hits = useMemo<Hit[]>(() => {
    const qn = q.trim().toLowerCase();
    if (qn.length < 2) return [];
    const out: Hit[] = [];
    for (const p of projects) if ([p.number, p.name, p.venue, p.externalRef].join(' ').toLowerCase().includes(qn)) out.push({ kind: 'Projet', icon: 'folder', label: `${p.number} ${p.name}`, sub: p.venue, to: '/projets/' + p.id });
    for (const e of equipment) if (!e.archived && [e.name, e.code, e.barcode, ...(e.tags || [])].join(' ').toLowerCase().includes(qn)) out.push({ kind: 'Matériel', icon: 'box', label: e.name, sub: e.code || e.barcode || '', to: '/materiel/' + e.id });
    for (const u of units) if ([u.barcode, u.serial].join(' ').toLowerCase().includes(qn)) out.push({ kind: 'Unité', icon: 'box', label: u.barcode || u.serial || '', sub: 'unité → fiche article', to: '/materiel/' + u.equipmentId });
    for (const c of contacts) if ([c.company, c.email, c.phone, ...(c.persons || []).map((p) => `${p.name} ${p.email}`)].join(' ').toLowerCase().includes(qn)) out.push({ kind: 'Contact', icon: 'users', label: c.company, sub: c.email || '', to: '/contacts?q=' + encodeURIComponent(c.company) });
    for (const p of people) if ([p.name, p.email, p.role].join(' ').toLowerCase().includes(qn)) out.push({ kind: 'Technicien', icon: 'user', label: p.name, sub: p.email || '', to: '/equipe?q=' + encodeURIComponent(p.name) });
    for (const d of docs) if ([d.number, DOC_LABELS[d.type]].join(' ').toLowerCase().includes(qn)) out.push({ kind: 'Document', icon: 'file', label: `${DOC_LABELS[d.type]} ${d.number}`, sub: projects.find((p) => p.id === d.projectId)?.name, to: '/documents/' + d.id });
    return out.slice(0, 25);
  }, [q, projects, equipment, contacts, people, docs, units]);

  const go = (h: Hit) => { setOpen(false); nav(h.to); };
  if (!open) return null;
  return (
    <div className="modal-bg gs-bg" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="gs" role="dialog" aria-label="Recherche globale">
        <div className="gs-head">
          <Icon name="search" />
          <input ref={inputRef} autoFocus value={q} placeholder="Rechercher un projet, du matériel, un code, un contact, un technicien, un document… (Ctrl+K)"
            aria-label="Recherche globale" onChange={(e) => { setQ(e.target.value); setSel(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === 'Enter' && hits[sel]) go(hits[sel]);
            }} />
          <button type="button" className="ghost small" aria-label="Fermer la recherche" onClick={() => setOpen(false)}><Icon name="x" /></button>
        </div>
        {q.trim().length >= 2 && (
          <div className="gs-list">
            {hits.length === 0 && <p className="muted" style={{ padding: 12 }}>Aucun résultat.</p>}
            {hits.map((h, i) => (
              <button key={h.kind + h.to + h.label} type="button" className={'gs-hit' + (i === sel ? ' on' : '')} onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
                <Icon name={h.icon} /><span className="gs-label">{h.label}</span>{h.sub && <span className="muted">{h.sub}</span>}<span className="gs-kind">{h.kind}</span>
              </button>
            ))}
          </div>
        )}
        {q.trim().length < 2 && <p className="muted" style={{ padding: 12, margin: 0 }}>Tape au moins 2 caractères. ↑↓ pour choisir, Entrée pour ouvrir.</p>}
      </div>
    </div>
  );
}
