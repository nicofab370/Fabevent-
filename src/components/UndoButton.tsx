import { useEffect, useState } from 'react';
import { lastUndo, onUndoChange, undo, undoCount } from '../undo';
import { Icon } from './Icon';

/** Bouton « Annuler » (et Ctrl+Z / Cmd+Z hors des champs de saisie) */
export function UndoButton({ compact }: { compact?: boolean }) {
  const [, setTick] = useState(0);
  const [toast, setToast] = useState('');
  useEffect(() => onUndoChange(() => setTick((t) => t + 1)), []);
  const step = lastUndo();
  const run = async () => {
    const label = await undo().catch((e) => { setToast(`Impossible d'annuler : ${(e as Error).message}`); return null; });
    if (label) setToast(`Annulé — ${label}`);
  };
  useEffect(() => {
    if (compact) return; // un seul écouteur clavier
    const key = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return; // annulation native du champ
      if (!undoCount()) return;
      e.preventDefault();
      run();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);
  return (
    <>
      <button type="button" className={'undo-btn' + (compact ? ' compact' : '')} disabled={!step} onClick={run}
        title={step ? `Annuler : ${step.label} (Ctrl+Z)` : 'Rien à annuler'} aria-label={step ? `Annuler : ${step.label}` : 'Rien à annuler'}>
        <Icon name="reset" />{!compact && <span>Annuler{undoCount() > 1 ? ` (${undoCount()})` : ''}</span>}
      </button>
      {toast && <div className="undo-toast" role="status">{toast}</div>}
    </>
  );
}
