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
import { installUndo } from './undo';
import { ensureUnitNumbers } from './unitNumbers';
import { ensureSerialCodes } from './autoCodes';
import { applyDoneTransfers } from './transferApply';

installUndo();

registerSW({ immediate: true });

// La base de démo se remplit automatiquement à sa première ouverture
if (currentWorkspace() === DEMO_WORKSPACE && (await db.projects.count()) === 0) {
  await seedDemo().catch((e) => console.error('Échec de la création des données de démo', e));
}

// unités sérialisées sans numéro #x (créées avant, importées) : on les numérote
await ensureUnitNumbers().catch(() => 0);
// articles sérialisés sans code interne : code logique (dépôt-catégorie-numéro), unités = code + numéro #x
await ensureSerialCodes().catch(() => 0);
// transferts définitifs déjà effectués : le stock change vraiment de dépôt (une seule fois)
await applyDoneTransfers().catch(() => 0);

// iPhone : Safari ignore « user-scalable=no » ; on bloque le pincement (le double tap est coupé en CSS)
document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });

// synchronisation automatique entre appareils (si un serveur est configuré)
setNumberProvider(serverNumber);
startSync();
(window.requestIdleCallback || ((f: () => void) => setTimeout(f, 1500)))(() => warmUpScanner());

// Téléphone : tous les tableaux « list » deviennent des fiches (cards-sm) ; chaque case reçoit le titre de sa colonne
// (les documents .doc et les aperçus d'étiquettes .lab restent de vrais tableaux, y compris en impression)
let labelling = 0;
new MutationObserver(() => {
  if (labelling) return;
  labelling = requestAnimationFrame(() => {
    labelling = 0;
    for (const t of document.querySelectorAll<HTMLTableElement>('table.list')) {
      if (t.closest('.doc') || t.closest('.lab') || t.closest('.pdf-root')) continue;
      if (!t.querySelector('thead th')) continue;
      t.classList.add('cards-sm');
      const heads = Array.from(t.querySelectorAll('thead th')).map((th) => th.textContent?.trim() || '');
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
