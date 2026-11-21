import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { currentWorkspace, db } from './db';
import { DEMO_WORKSPACE, seedDemo } from './demo';
import './styles.css';
import { serverNumber, startSync } from './sync';
import { setNumberProvider } from './db';
import { warmUpScanner } from './components/Scanner';

registerSW({ immediate: true });

// La base de démo se remplit automatiquement à sa première ouverture
if (currentWorkspace() === DEMO_WORKSPACE && (await db.projects.count()) === 0) {
  await seedDemo().catch((e) => console.error('Échec de la création des données de démo', e));
}

// iPhone : Safari ignore « user-scalable=no » ; on bloque le pincement (le double tap est coupé en CSS)
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

// synchronisation automatique entre appareils (si un serveur est configuré)
setNumberProvider(serverNumber);
startSync();
(window.requestIdleCallback || ((f: () => void) => setTimeout(f, 1500)))(() => warmUpScanner());

// Téléphone : les tableaux « cards-sm » deviennent des fiches ; chaque case reçoit le titre de sa colonne
let labelling = 0;
new MutationObserver(() => {
  if (labelling) return;
  labelling = requestAnimationFrame(() => {
    labelling = 0;
    for (const t of document.querySelectorAll<HTMLTableElement>('table.cards-sm')) {
      const heads = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent?.trim() || '');
      if (!heads.length) continue;
      for (const tr of t.querySelectorAll('tbody tr')) {
        let i = 0;
        for (const td of Array.from(tr.children) as HTMLElement[]) {
          const label = heads[i] || '';
          if (td.dataset.label !== label) td.dataset.label = label;
          i += (td as HTMLTableCellElement).colSpan || 1;
        }
      }
    }
  });
}).observe(document.body, { childList: true, subtree: true });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
