import Dexie, { type Table } from 'dexie';
import type {
  Appointment, Category, Contact, CrewAssignment, Doc, DocStyle, Transfer, Equipment, EquipmentLine, Inspection, LogEntry, Person, Project, ProjectCost, ProjectFile, Repair,
  SerialUnit, Settings, Subproject, Subrental, Unavailability, Vehicle, VehicleAssignment,
} from './types';

const WS_KEY = 'fabevent.workspace';
const WS_LIST_KEY = 'fabevent.workspaces';

function safeGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeSet(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* stockage indisponible */ }
}

/** Chaque "base" est une base IndexedDB séparée sur l'appareil. */
export function currentWorkspace(): string {
  return safeGet(WS_KEY) || 'principal';
}
export function listWorkspaces(): string[] {
  try {
    const list = JSON.parse(safeGet(WS_LIST_KEY) || '[]') as string[];
    return Array.from(new Set(['principal', ...list]));
  } catch {
    return ['principal'];
  }
}
export function switchWorkspace(name: string) {
  const list = listWorkspaces();
  if (!list.includes(name)) safeSet(WS_LIST_KEY, JSON.stringify([...list, name]));
  safeSet(WS_KEY, name);
  location.hash = '#/';
  location.reload();
}

export class FabDB extends Dexie {
  contacts!: Table<Contact, string>;
  categories!: Table<Category, string>;
  equipment!: Table<Equipment, string>;
  projects!: Table<Project, string>;
  subprojects!: Table<Subproject, string>;
  lines!: Table<EquipmentLine, string>;
  people!: Table<Person, string>;
  crew!: Table<CrewAssignment, string>;
  vehicles!: Table<Vehicle, string>;
  vehicleAssignments!: Table<VehicleAssignment, string>;
  docs!: Table<Doc, string>;
  settings!: Table<Settings, string>;
  units!: Table<SerialUnit, string>;
  repairs!: Table<Repair, string>;
  inspections!: Table<Inspection, string>;
  subrentals!: Table<Subrental, string>;
  costs!: Table<ProjectCost, string>;
  unavailability!: Table<Unavailability, string>;
  files!: Table<ProjectFile, string>;
  log!: Table<LogEntry, string>;
  transfers!: Table<Transfer, string>;
  appointments!: Table<Appointment, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      contacts: 'id, type, company, updatedAt',
      categories: 'id, name',
      equipment: 'id, name, code, categoryId, barcode, updatedAt',
      projects: 'id, number, clientId, status, start, end, updatedAt',
      subprojects: 'id, projectId, start, end, status',
      lines: 'id, projectId, subprojectId, equipmentId',
      people: 'id, name',
      crew: 'id, projectId, subprojectId, personId, start',
      vehicles: 'id, name',
      vehicleAssignments: 'id, projectId, subprojectId, vehicleId, start',
      docs: 'id, projectId, type, number, createdAt',
      settings: 'id',
    });
    this.version(2).stores({
      units: 'id, equipmentId, serial, barcode',
      repairs: 'id, equipmentId, status',
      inspections: 'id, equipmentId, unitId, date',
      subrentals: 'id, projectId, subprojectId, supplierId, status',
      costs: 'id, projectId',
      unavailability: 'id, personId',
    });
    this.version(3).stores({
      files: 'id, projectId',
      log: 'id, projectId, at',
    });
    this.version(4).stores({
      transfers: 'id, fromDepotId, toDepotId, status, start',
    });
    this.version(5).stores({
      files: 'id, projectId, personId',
    });
    this.version(6).stores({
      appointments: 'id, start',
    });
    // interlocuteurs identifiés (services du client) : on numérote les fiches existantes
    this.version(7).stores({}).upgrade(async (tx) => {
      await tx.table('contacts').toCollection().modify((c: Contact) => {
        if (c.persons?.some((p) => !p.id)) c.persons = c.persons.map((p) => (p.id ? p : { ...p, id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36) }));
      });
    });
  }
}

export const db = new FabDB('fabevent_' + currentWorkspace());

export const TABLES = [
  'contacts', 'categories', 'equipment', 'projects', 'subprojects', 'lines', 'people', 'crew', 'vehicles',
  'vehicleAssignments', 'docs', 'settings', 'units', 'repairs', 'inspections', 'subrentals', 'costs', 'unavailability', 'files', 'log', 'transfers', 'appointments',
] as const;

/** Identifiant du dépôt principal (ou 'main' s'il n'y a pas de dépôts déclarés). */
export function mainDepotId(s: Pick<Settings, 'depots'>): string {
  return s.depots?.[0]?.id || 'main';
}
/** Plusieurs dépôts déclarés ? Sinon tout fonctionne comme avec un dépôt unique. */
export function multiDepot(s: Pick<Settings, 'depots'>): boolean {
  return (s.depots?.length || 0) > 1;
}

export const DEFAULT_DOC_STYLE: DocStyle = {
  color: '#111111', font: 'sans', logoPosition: 'gauche', showCode: true, showFactor: true, showDiscount: true, showGroups: true,
  showSubtotals: true, showPeriods: true, hideZero: false, hideEquipmentDetail: false, showSignature: true,
};

export const DEFAULT_PROJECT_TYPES: { name: string; color: string; moments?: string[] }[] = [
  { name: 'Prestation', color: '#2563eb' },
  { name: 'Location sèche', color: '#16a34a' },
  { name: 'Vente', color: '#9333ea' },
  { name: 'Tournée', color: '#ea580c' },
];

export const defaultSettings: Settings = {
  id: 'main',
  company: { name: 'FabEvent' },
  vatRate: 20,
  factors: [1, 1.5, 2, 2.5, 3, 3.5, 4],
  factorExtraPerDay: 0.5,
  quoteValidityDays: 30,
  paymentDays: 30,
  structuredComm: true,
  overtimeAfter: 10,
  overtimeRate: 50,
  reminderDays: 10,
  pricePerKm: 1,
  defaultTrips: 2,
  footer: 'Conditions générales de location disponibles sur demande.',
  appUrl: '',
  counters: {},
};

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('main');
  return { ...defaultSettings, ...s, company: { ...defaultSettings.company, ...s?.company } };
}

/** Numérotation : P-2026-001, D-2026-001, F-2026-001… */
export async function nextNumber(kind: 'P' | 'D' | 'F' | 'AV' | 'BS' | 'FR' | 'SL' | 'TR' | 'RP'): Promise<string> {
  return db.transaction('rw', db.settings, async () => {
    const s = await getSettings();
    const year = new Date().getFullYear();
    const key = `${kind}-${year}`;
    const n = (s.counters[key] || 0) + 1;
    await db.settings.put({ ...s, counters: { ...s.counters, [key]: n } });
    return `${key}-${String(n).padStart(3, '0')}`;
  });
}

export function appBaseUrl(s: Settings): string {
  if (s.appUrl) return s.appUrl.replace(/#.*$/, '').replace(/\/?$/, '/');
  return location.origin + location.pathname;
}

/* ---------- Registre des modifications (onglet Registre du projet) ---------- */

let logSuppressed = false;
/** Désactive le registre (ex. pendant la création des données de démo). */
export function suppressLog(v: boolean) { logSuppressed = v; }

const LOGGED: Record<string, string> = {
  projects: 'Projet', subprojects: 'Salle', lines: 'Matériel', crew: 'Poste', vehicleAssignments: 'Transport',
  costs: 'Coût supplémentaire', docs: 'Document', subrentals: 'Sous-location', files: 'Fichier',
};
const FIELD_LABELS: Record<string, string> = {
  name: 'nom', qty: 'quantité', unitPrice: 'prix', discount: 'remise', status: 'statut', start: 'début', end: 'fin',
  periods: 'horaires', groups: 'groupes', personId: 'personne', rate: 'tarif', cost: 'coût', billable: 'facturation', optional: 'option',
  clientId: 'client', venue: 'lieu', venueId: 'lieu', notes: 'notes', tasks: 'tâches', function: 'fonction', vehicleId: 'véhicule',
  driverId: 'chauffeur', price: 'prix', amount: 'montant', label: 'libellé', groupId: 'groupe', periodId: 'créneau', lines: 'lignes',
  supplierId: 'fournisseur', contactPerson: 'interlocuteur', typeName: 'type', color: 'couleur', externalRef: 'référence externe',
  outQty: 'sortie entrepôt', inQty: 'retour entrepôt', outSerials: 'sortie entrepôt', inSerials: 'retour entrepôt', prepStart: 'préparation', returnEnd: 'retour',
};

function describe(obj: Record<string, unknown>): string {
  const v = obj.name ?? obj.function ?? obj.label ?? obj.number ?? '';
  return v ? ` « ${String(v)} »` : '';
}

function writeLog(projectId: string | undefined, entityId: string, text: string, fields?: string[]) {
  if (logSuppressed || !projectId) return;
  // en dehors de la transaction en cours
  setTimeout(async () => {
    try {
      if (!(await db.projects.get(projectId))) return;
      const at = new Date().toISOString();
      const last = await db.log.where('projectId').equals(projectId).last();
      // les saisies successives sur la même ligne sont regroupées (2 min)
      if (last && fields && last.fields && last.entityId === entityId && Date.parse(at) - Date.parse(last.at) < 120000) {
        const merged = Array.from(new Set([...last.fields, ...fields]));
        await db.log.put({ ...last, at, fields: merged, text: text.replace(/ : .*$/, ' : ' + merged.join(', ')) });
      } else {
        await db.log.add({ id: crypto.randomUUID?.() || String(Math.random()), projectId, entityId, at, text, fields });
      }
    } catch { /* registre indisponible */ }
  }, 0);
}

for (const [table, label] of Object.entries(LOGGED)) {
  const t = db.table(table);
  const pid = (o: Record<string, unknown>) => (table === 'projects' ? (o.id as string) : (o.projectId as string));
  t.hook('creating', (_k, obj) => { writeLog(pid(obj), obj.id, `${label}${describe(obj)} ajouté`); });
  t.hook('updating', (mods, _k, obj) => {
    const keys = Array.from(new Set(Object.keys(mods).map((k) => k.split('.')[0]).filter((k) => k !== 'updatedAt' && k !== 'createdAt')));
    if (!keys.length) return;
    const fields = Array.from(new Set(keys.map((k) => FIELD_LABELS[k] || k)));
    writeLog(pid(obj), obj.id, `${label}${describe({ ...obj, ...mods })} modifié : ${fields.join(', ')}`, fields);
  });
  t.hook('deleting', (_k, obj) => { if (obj) writeLog(pid(obj), obj.id, `${label}${describe(obj)} supprimé`); });
}
