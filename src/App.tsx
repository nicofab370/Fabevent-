import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { currentWorkspace } from './db';
import { DEMO_WORKSPACE } from './demo';
import Accounting from './pages/Accounting';
import Calendar from './pages/Calendar';
import Contacts from './pages/Contacts';
import Crew from './pages/Crew';
import Dashboard from './pages/Dashboard';
import DocumentView from './pages/DocumentView';
import EquipmentDetail from './pages/EquipmentDetail';
import EquipmentList from './pages/EquipmentList';
import ImportPage from './pages/Import';
import Maintenance from './pages/Maintenance';
import Reports from './pages/Reports';
import Subrentals, { SubrentalDetail } from './pages/Subrentals';
import Templates from './pages/Templates';
import Transfers from './pages/Transfers';
import Warehouse, { WarehouseScan } from './pages/Warehouse';
import ProjectDetail from './pages/ProjectDetail';
import Projects from './pages/Projects';
import SettingsPage from './pages/Settings';
import Vehicles from './pages/Vehicles';

const NAV = [
  ['/', 'Tableau de bord', '◧'],
  ['/projets', 'Projets', '▤'],
  ['/planning', 'Planning', '▦'],
  ['/materiel', 'Matériel', '◫'],
  ['/entrepot', 'Entrepôt', '⇄'],
  ['/souslocations', 'Sous-locations', '⇆'],
  ['/transferts', 'Transferts', '⇵'],
  ['/maintenance', 'Maintenance', '⚒'],
  ['/contacts', 'Contacts', '☰'],
  ['/equipe', 'Équipe', '☺'],
  ['/vehicules', 'Véhicules', '⛟'],
  ['/comptabilite', 'Export comptable', '€'],
  ['/rapports', 'Rapports', '↗'],
  ['/import', 'Import', '⇪'],
  ['/modeles', 'Modèles de documents', '✎'],
  ['/parametres', 'Paramètres', '⚙'],
] as const;

export default function App() {
  const [online, setOnline] = useState(navigator.onLine);
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  return (
    <div className="layout">
      <aside className={'sidebar' + (menu ? ' open' : '')}>
        <div className="brand">Fab<span>Event</span></div>
        <div className="ws">Base : {currentWorkspace()}</div>
        {currentWorkspace() === DEMO_WORKSPACE && <NavLink to="/parametres" className="demo-badge">Données fictives de démo</NavLink>}
        <nav>
          {NAV.map(([to, label, icon]) => (
            <NavLink key={to} to={to} end={to === '/'}>
              <span className="ico">{icon}</span>{label}
            </NavLink>
          ))}
        </nav>
        <div className={'net ' + (online ? 'on' : 'off')}>{online ? '● En ligne' : '● Hors ligne'} · données locales</div>
      </aside>
      <div className="topbar">
        <button className="ghost" onClick={() => setMenu(!menu)} aria-label="Menu">☰</button>
        <div className="brand">Fab<span>Event</span></div>
      </div>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projets" element={<Projects />} />
          <Route path="/projets/:id" element={<ProjectDetail />} />
          <Route path="/documents/:id" element={<DocumentView />} />
          <Route path="/planning" element={<Calendar />} />
          <Route path="/materiel" element={<EquipmentList />} />
          <Route path="/materiel/:id" element={<EquipmentDetail />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/equipe" element={<Crew />} />
          <Route path="/vehicules" element={<Vehicles />} />
          <Route path="/comptabilite" element={<Accounting />} />
          <Route path="/rapports" element={<Reports />} />
          <Route path="/entrepot" element={<Warehouse />} />
          <Route path="/entrepot/:id" element={<WarehouseScan />} />
          <Route path="/souslocations" element={<Subrentals />} />
          <Route path="/souslocations/:id" element={<SubrentalDetail />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/transferts" element={<Transfers />} />
          <Route path="/modeles" element={<Templates />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="*" element={<p>Page introuvable.</p>} />
        </Routes>
      </main>
    </div>
  );
}
