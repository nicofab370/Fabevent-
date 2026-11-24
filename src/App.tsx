import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useAlerts } from './alerts';
import { GlobalSearch } from './components/GlobalSearch';
import { currentWorkspace, db } from './db';
import { patch, save } from './utils';
import { APP_PR, APP_PR_URL, APP_VERSION } from './version';
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
import Inventory from './pages/Inventory';
import Labels from './pages/Labels';
import Templates from './pages/Templates';
import Transfers from './pages/Transfers';
import Warehouse from './pages/Warehouse';
import FreeChecklists, { FreeChecklistPage, ProjectChecklist } from './pages/Checklist';
import ProjectDetail from './pages/ProjectDetail';
import Projects from './pages/Projects';
import SettingsPage from './pages/Settings';
import Vehicles from './pages/Vehicles';
import Shortages from './pages/Shortages';
import { SyncBadge } from './components/SyncPanel';
import Venues, { VenueDetail } from './pages/Venues';
import CrewAssignmentPage from './pages/crewAssign';
import QrCard from './pages/QrCard';
import { Icon, type IconName } from './components/Icon';
import { OpenTabs } from './components/OpenTabs';
import { UndoButton } from './components/UndoButton';

const NAV: [string, string, IconName][] = [
  ['/', 'Tableau de bord', 'grid'],
  ['/projets', 'Projets', 'folder'],
  ['/planning', 'Planning', 'calendar'],
  ['/materiel', 'Matériel', 'box'],
  ['/entrepot', 'Entrepôt', 'scan'],
  ['/penuries', 'Pénuries', 'warning'],
  ['/souslocations', 'Sous-locations', 'swap'],
  ['/transferts', 'Transferts', 'transfer'],
  ['/maintenance', 'Maintenance', 'wrench'],
  ['/contacts', 'Contacts', 'users'],
  ['/lieux', 'Lieux', 'building'],
  ['/equipe', 'Équipe', 'user'],
  ['/attribution', 'Attribution', 'user-check'],
  ['/vehicules', 'Véhicules', 'truck'],
  ['/comptabilite', 'Export comptable', 'receipt'],
  ['/rapports', 'Rapports', 'chart'],
  ['/import', 'Import', 'upload'],
  ['/modeles', 'Modèles de documents', 'file'],
  ['/parametres', 'Paramètres', 'sliders'],
];

export default function App() {
  const [online, setOnline] = useState(navigator.onLine);
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const alerts = useAlerts();
  /** badge d'alerte par entrée du menu */
  const badge: Record<string, [number, string]> = {
    '/penuries': [alerts.penuries, 'manques réels de matériel à venir'],
    '/comptabilite': [alerts.enRetard, 'factures en retard de paiement'],
    '/maintenance': [alerts.controles, 'contrôles périodiques à faire dans les 30 jours'],
    '/equipe': [alerts.postes, 'postes prévus sans technicien'],
    '/attribution': [alerts.postes, 'postes prévus sans technicien'],
  };
  // devis accepté en ligne avec des options choisies : les lignes passent en « non optionnelles » (facturées), une seule fois
  const pendingOpts = useLiveQuery(() => db.docs.filter((d) => d.type === 'devis' && d.status === 'accepte' && (d.acceptedOptions || []).length > 0 && !d.optionsApplied).toArray(), []) || [];
  useEffect(() => {
    for (const d of pendingOpts) void (async () => {
      for (const id of d.acceptedOptions || []) await patch(db.lines, id, { optional: false });
      await save(db.docs, { ...d, optionsApplied: true });
    })();
  }, [pendingOpts]);
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
              <Icon name={icon} />{label}
              {badge[to]?.[0] > 0 && <span className="nav-badge" title={badge[to][1]}>{badge[to][0]}</span>}
            </NavLink>
          ))}
        </nav>
        <UndoButton />
        <SyncBadge online={online} />
        <div className="side-version">v{APP_VERSION} · <a href={APP_PR_URL} target="_blank" rel="noreferrer">PR #{APP_PR}</a></div>
      </aside>
      <GlobalSearch />
      <div className="topbar">
        <button className="ghost" onClick={() => setMenu(!menu)} aria-label="Menu"><Icon name="menu" /></button>
        <div className="brand">Fab<span>Event</span></div>
        <UndoButton compact />
      </div>
      <main className="main">
        <OpenTabs />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projets" element={<Projects />} />
          <Route path="/projets/:id" element={<ProjectDetail />} />
          <Route path="/documents/:id" element={<DocumentView />} />
          <Route path="/planning" element={<Calendar />} />
          <Route path="/materiel" element={<EquipmentList />} />
          <Route path="/materiel/:id" element={<EquipmentDetail />} />
          <Route path="/lieux" element={<Venues />} />
          <Route path="/lieux/:id" element={<VenueDetail />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/q/:code" element={<QrCard />} />
          <Route path="/attribution" element={<CrewAssignmentPage />} />
          <Route path="/equipe" element={<Crew />} />
          <Route path="/vehicules" element={<Vehicles />} />
          <Route path="/comptabilite" element={<Accounting />} />
          <Route path="/rapports" element={<Reports />} />
          <Route path="/entrepot" element={<Warehouse />} />
          <Route path="/entrepot/:id" element={<ProjectChecklist />} />
          <Route path="/checklists" element={<FreeChecklists />} />
          <Route path="/checklists/:id" element={<FreeChecklistPage />} />
          <Route path="/penuries" element={<Shortages />} />
          <Route path="/souslocations" element={<Subrentals />} />
          <Route path="/souslocations/:id" element={<SubrentalDetail />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/transferts" element={<Transfers />} />
          <Route path="/modeles" element={<Templates />} />
          <Route path="/etiquettes" element={<Labels />} />
          <Route path="/inventaire" element={<Inventory />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/parametres" element={<SettingsPage />} />
          <Route path="*" element={<p>Page introuvable.</p>} />
        </Routes>
      </main>
    </div>
  );
}
