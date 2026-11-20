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

// synchronisation automatique entre appareils (si un serveur est configuré)
setNumberProvider(serverNumber);
startSync();
(window.requestIdleCallback || ((f: () => void) => setTimeout(f, 1500)))(() => warmUpScanner());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
