import Dexie, { type Table } from 'dexie';
import type {
  Category, Contact, CrewAssignment, Doc, Equipment, EquipmentLine, Person, Project, Settings, Subproject, Vehicle,
  VehicleAssignment,
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
  }
}

export const db = new FabDB('fabevent_' + currentWorkspace());

export const TABLES = [
  'contacts', 'categories', 'equipment', 'projects', 'subprojects', 'lines', 'people', 'crew', 'vehicles',
  'vehicleAssignments', 'docs', 'settings',
] as const;

export const defaultSettings: Settings = {
  id: 'main',
  company: { name: 'FabEvent' },
  vatRate: 20,
  factors: [1, 1.5, 2, 2.5, 3, 3.5, 4],
  factorExtraPerDay: 0.5,
  quoteValidityDays: 30,
  footer: 'Conditions générales de location disponibles sur demande.',
  appUrl: '',
  counters: {},
};

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('main');
  return { ...defaultSettings, ...s, company: { ...defaultSettings.company, ...s?.company } };
}

/** Numérotation : P-2026-001, D-2026-001, F-2026-001… */
export async function nextNumber(kind: 'P' | 'D' | 'F' | 'BS' | 'FR'): Promise<string> {
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
