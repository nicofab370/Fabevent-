import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Retour à l'endroit où l'on était : la position de défilement de chaque page (chemin + onglet)
 * est retenue ; en revenant en arrière (bouton du navigateur, « ← Projet » d'un document…),
 * la page redescend à cette position dès que son contenu, chargé depuis la base, est assez long.
 */
const KEY = 'fab.scroll';
let mem: Record<string, number> = {};
try { mem = JSON.parse(sessionStorage.getItem(KEY) || '{}'); } catch { /* sans stockage */ }
const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify(mem)); } catch { /* sans stockage */ } };
const here = () => window.location.hash.replace(/^#/, '') || '/';

/** position retenue pour une page (utile aux tests) */
export const scrollOf = (path: string) => mem[path] || 0;

export function useScrollMemory() {
  const loc = useLocation();
  const navType = useNavigationType();
  /** pendant une restauration, on n'enregistre pas les positions intermédiaires */
  const restoring = useRef(false);

  useEffect(() => {
    let t: number | undefined;
    const on = () => {
      if (restoring.current) return;
      const path = here(), y = Math.round(window.scrollY);
      mem[path] = y;
      window.clearTimeout(t);
      t = window.setTimeout(persist, 300);
    };
    window.addEventListener('scroll', on, { passive: true });
    return () => { window.removeEventListener('scroll', on); window.clearTimeout(t); };
  }, []);

  useLayoutEffect(() => {
    const path = loc.pathname + loc.search;
    const wanted = navType === 'POP' || (loc.state as { restore?: boolean } | null)?.restore;
    const target = mem[path] || 0;
    if (!wanted || target <= 0) return;
    restoring.current = true;
    let stop = false;
    const cancel = () => { stop = true; };
    // l'utilisateur fait défiler lui-même : on n'insiste pas
    window.addEventListener('wheel', cancel, { passive: true, once: true });
    window.addEventListener('touchstart', cancel, { passive: true, once: true });
    const t0 = Date.now();
    const tick = () => {
      if (stop) return done();
      const max = document.documentElement.scrollHeight - window.innerHeight;
      if (max >= target - 2) { window.scrollTo(0, target); return done(); }
      if (Date.now() - t0 > 2500) { window.scrollTo(0, Math.max(0, max)); return done(); }
      window.setTimeout(tick, 60);
    };
    const done = () => {
      window.removeEventListener('wheel', cancel);
      window.removeEventListener('touchstart', cancel);
      window.setTimeout(() => { restoring.current = false; }, 80);
    };
    window.setTimeout(tick, 30);
    return () => { stop = true; };
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps
}
