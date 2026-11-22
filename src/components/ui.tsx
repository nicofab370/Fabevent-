import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { db, defaultSettings } from '../db';
import type { ProjectStatus, Settings } from '../types';
import { STATUS_LABELS } from '../types';
import { Icon } from './Icon';

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('main'));
  return { ...defaultSettings, ...s, company: { ...defaultSettings.company, ...s?.company } };
}

/** fenêtres ouvertes, la dernière au-dessus : Échap ne ferme que celle du dessus */
const openModals: object[] = [];

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const self = useRef({}).current;
  useEffect(() => {
    openModals.push(self);
    return () => { openModals.splice(openModals.indexOf(self), 1); };
  }, [self]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && openModals[openModals.length - 1] === self && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose, self]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button type="button" className="ghost" onClick={onClose} aria-label="Fermer"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Field({ label, children, full }: { label: string; children: ReactNode; full?: boolean }) {
  return (
    <label className={'field' + (full ? ' full' : '')}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function StatusBadge({ status }: { status: ProjectStatus }) {
  return <span className={`badge st-${status}`}>{STATUS_LABELS[status]}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      <div className="actions">{children}</div>
    </div>
  );
}

/**
 * Champ numérique qui accepte la virgule. On peut le vider complètement : aucun « 0 » ne reste
 * pendant la saisie (le champ vide vaut 0 pour les calculs). Au clic, le contenu est sélectionné
 * pour être remplacé directement.
 */
export function NumInput({ value, onChange, step = 'any', placeholder, ...rest }: { value: number; onChange: (n: number) => void; step?: string; className?: string; min?: number; style?: React.CSSProperties; placeholder?: string; title?: string; 'aria-label'?: string }) {
  const shown = (n: number) => (Number.isFinite(n) ? String(n).replace('.', ',') : '');
  const [text, setText] = useState(shown(value));
  const focused = useRef(false);
  // valeur changée ailleurs : on la reprend, sauf pendant la saisie
  useEffect(() => {
    if (!focused.current) setText((t) => (t === '' && !value ? '' : shown(value)));
  }, [value]);
  return (
    <input
      type="text"
      inputMode="decimal"
      data-step={step}
      value={text}
      placeholder={placeholder ?? '0'}
      onFocus={(e) => { focused.current = true; e.currentTarget.select(); }}
      onBlur={() => { focused.current = false; setText((t) => (t.trim() === '' ? '' : shown(value))); }}
      onChange={(e) => {
        const raw = e.target.value;
        if (!/^-?\d*[.,]?\d*$/.test(raw.trim())) return;
        setText(raw);
        const n = parseFloat(raw.replace(',', '.'));
        onChange(raw.trim() === '' || raw.trim() === '-' || isNaN(n) ? 0 : n);
      }}
      {...rest}
    />
  );
}
