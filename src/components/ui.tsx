import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, type ReactNode } from 'react';
import { db, defaultSettings } from '../db';
import type { ProjectStatus, Settings } from '../types';
import { STATUS_LABELS } from '../types';

export function useSettings(): Settings {
  const s = useLiveQuery(() => db.settings.get('main'));
  return { ...defaultSettings, ...s, company: { ...defaultSettings.company, ...s?.company } };
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="ghost" onClick={onClose} aria-label="Fermer">✕</button>
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

/** Champ numérique qui accepte la virgule. */
export function NumInput({ value, onChange, step = 'any', ...rest }: { value: number; onChange: (n: number) => void; step?: string; className?: string; min?: number; style?: React.CSSProperties }) {
  return (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) ? value : 0}
      onChange={(e) => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
      {...rest}
    />
  );
}
