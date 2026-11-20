import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { currentWorkspace } from './db';
import Accounting from './pages/Accounting';
import Calendar from './pages/Calendar';
import Contacts from './pages/Contacts';
import Crew from './pages/Crew';
import Dashboard from './pages/Dashboard';
import DocumentView from './pages/DocumentView';
import EquipmentDetail from './pages/EquipmentDetail';
import EquipmentList from './pages/EquipmentList';
import ImportPage from './pages/Import';
import ProjectDetail from './pages/ProjectDetail';
import Projects from './pages/Projects';
import SettingsPage from './pages/Settings';
import Vehicles from './pages/Vehicles';

const NAV = [
  ['/', 'Tableau de bord', '◧'],
  ['/projets', 'Projets', '▤'],
  ['/planning', 'Planning', '▦'],
  ['/materiel', 'Matériel', '◫'],
  ['/contacts', 'Contacts', '☰'],
  ['/equipe', 'Équipe', '☺'],
  ['/vehicules', 'Véhicules', '⛟'],
  ['/comptabilite', 'Export comptable', '€'],
  ['/import', 'Import', '⇪'],
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
          <Route path="/import" element={<ImportPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="*" element={<p>Page introuvable.</p>} />
        </Routes>
      </main>
    </div>
  );
}
