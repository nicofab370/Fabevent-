/**
 * Import dans FabEvent du fichier produit par tools/rentman-import/export.mjs (export Rentman).
 * Ajoute les fiches à la base ouverte, sans rien effacer. Chaque fiche importée a un identifiant « rm-… » :
 * un nouvel import ajoute ce qui manque, et met à jour les fiches déjà importées seulement si on le demande
 * (sinon les modifications faites dans FabEvent sont gardées).
 * Les fichiers (documents, photos) arrivent dans des paquets à part (« …-fichiers-N.json »), choisis avec le fichier principal.
 */
import { db, getSettings, suppressLog } from './db';
import { resizeImage } from './image';
import type { Contact, Doc, Equipment, Project, Settings } from './types';

/** Ordre d'import : les fiches référencées d'abord. */
const ORDER = [
  'categories', 'contacts', 'equipment', 'units', 'people', 'vehicles', 'projects', 'subprojects', 'lines', 'crew', 'vehicleAssignments',
  'costs', 'subrentals', 'repairs', 'unavailability', 'appointments', 'docs',
] as const;
type Table = (typeof ORDER)[number];
type Label = Table | 'settings' | 'files' | 'photos';

export const RENTMAN_LABELS: Record<Label, string> = {
  categories: 'catégories', contacts: 'contacts (clients, lieux, fournisseurs)', equipment: 'articles', units: 'unités numérotées', people: 'personnes (équipe)',
  vehicles: 'véhicules', projects: 'projets', subprojects: 'sous-projets', lines: 'lignes de matériel', crew: 'postes', vehicleAssignments: 'véhicules des projets',
  costs: 'coûts supplémentaires', subrentals: 'sous-locations', repairs: 'réparations', unavailability: 'indisponibilités', appointments: 'rendez-vous',
  docs: 'devis et factures', settings: 'types de projet, dépôts, grilles de coefficients et comptes', files: 'fichiers', photos: 'photos du matériel',
};

interface RentmanFileItem { id: string; name: string; type: string; size: number; base64: string; createdAt?: string; projectId?: string; personId?: string; photoOf?: string }

export interface RentmanFile {
  app: 'fabevent';
  kind: 'import';
  source: 'rentman';
  exportedAt: string;
  /** paquet de fichiers (documents, photos) à joindre au fichier principal */
  part?: 'fichiers';
  /** fichier principal : nombre de paquets de fichiers produits */
  parts?: number;
  report?: { counts?: Record<string, number>; warnings?: string[]; skipped?: string[] };
  data: Partial<Record<Table, { id: string }[]>> & {
    settings?: { projectTypes?: Settings['projectTypes']; depots?: Settings['depots']; factorGroups?: Settings['factorGroups']; ledgers?: Settings['ledgers'] }[];
    files?: RentmanFileItem[];
  };
}

export function readRentmanFile(text: string): RentmanFile {
  let j: RentmanFile;
  try { j = JSON.parse(text); } catch { throw new Error('Fichier illisible (JSON attendu).'); }
  if (j?.app !== 'fabevent' || j.kind !== 'import' || j.source !== 'rentman' || !j.data) throw new Error('Ce fichier n’est pas un export Rentman pour FabEvent.');
  return j;
}

/** Fichier principal + paquets de fichiers → un seul import. */
export function mergeRentmanFiles(list: RentmanFile[]): RentmanFile {
  const main = list.find((f) => !f.part);
  const files = list.flatMap((f) => (f.part ? f.data.files || [] : []));
  if (!main) {
    if (!files.length) throw new Error('Aucun export Rentman dans ces fichiers.');
    // fichiers seuls (le principal a déjà été importé)
    return { app: 'fabevent', kind: 'import', source: 'rentman', exportedAt: list[0].exportedAt, data: { files } };
  }
  return files.length ? { ...main, data: { ...main.data, files } } : main;
}

export interface ImportResult { table: Label; added: number; updated: number; kept: number; /** fiches déjà là, dont des champs vides ont été remplis */ filled?: number }

const isEmpty = (v: unknown) => v == null || v === '' || v === 0 || (Array.isArray(v) && v.length === 0);
/** Fiche déjà importée, sans mise à jour demandée : seuls ses champs vides (ou à 0) reçoivent la valeur de Rentman. */
export function fillEmpty(cur: Record<string, unknown>, r: Record<string, unknown>): Record<string, unknown> | null {
  let changed = false;
  const out = { ...cur };
  for (const [k, v] of Object.entries(r)) {
    if (k === 'id' || k === 'createdAt' || k === 'updatedAt' || isEmpty(v) || !isEmpty(cur[k])) continue;
    out[k] = v;
    changed = true;
  }
  return changed ? out : null;
}

const fromBase64 = (b64: string, type: string) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
};

/** devis et factures Rentman : en-tête de la société et client complétés avec ceux de la base */
async function fillDocs(rows: { id: string }[]) {
  const company = (await getSettings()).company;
  const docs = rows as Doc[];
  const projects = await db.projects.bulkGet(docs.map((d) => d.projectId));
  const clients = await db.contacts.bulkGet(projects.map((p) => (p as Project | undefined)?.clientId || ''));
  docs.forEach((d, i) => {
    d.snapshot = { ...d.snapshot, company, client: (clients[i] as Contact | undefined) || undefined };
  });
}

export async function importRentman(file: RentmanFile, opts: { update: boolean }): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  suppressLog(true); // pas d'historique « Annuler » pour des milliers de fiches
  try {
    for (const t of ORDER) {
      const rows = (file.data[t] || []).filter((r) => r && typeof r.id === 'string' && r.id.startsWith('rm-'));
      if (!rows.length) continue;
      if (t === 'docs') await fillDocs(rows);
      const table = db.table(t);
      const existing = await table.bulkGet(rows.map((r) => r.id));
      const toPut: { id: string }[] = [];
      let added = 0, updated = 0, kept = 0, filled = 0;
      rows.forEach((r, i) => {
        const cur = existing[i] as Record<string, unknown> | undefined;
        if (!cur) { toPut.push(r); added++; }
        else if (opts.update) { toPut.push({ ...cur, ...r }); updated++; }
        else {
          const f = fillEmpty(cur, r as unknown as Record<string, unknown>);
          if (f) { toPut.push(f as { id: string }); filled++; }
          kept++;
        }
      });
      for (let i = 0; i < toPut.length; i += 500) await table.bulkPut(toPut.slice(i, i + 500));
      out.push({ table: t, added, updated, kept, filled });
    }

    // types de projet et dépôts : ajoutés aux paramètres s'ils n'y sont pas (même nom = gardé)
    const patch = file.data.settings?.[0];
    if (patch) {
      const s = await getSettings();
      const types = [...(s.projectTypes || [])], depots = [...(s.depots || [])];
      const groups = [...(s.factorGroups || [])], ledgers = [...(s.ledgers || [])];
      let added = 0, kept = 0;
      for (const g of patch.factorGroups || []) { if (groups.some((x) => x.id === g.id)) kept++; else { groups.push(g); added++; } }
      for (const l of patch.ledgers || []) { if (ledgers.some((x) => x.id === l.id || x.code === l.code)) kept++; else { ledgers.push(l); added++; } }
      for (const t of patch.projectTypes || []) { if (types.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) kept++; else { types.push(t); added++; } }
      for (const d of patch.depots || []) { if (depots.some((x) => x.id === d.id || x.name.toLowerCase() === d.name.toLowerCase())) kept++; else { depots.push(d); added++; } }
      if (added) await db.settings.put({ ...s, projectTypes: types, depots, factorGroups: groups.length ? groups : undefined, ledgers: ledgers.length ? ledgers : undefined });
      out.push({ table: 'settings', added, updated: 0, kept });
    }

    // fichiers des projets et de l'équipe ; photos du matériel (réduites comme une photo prise dans FabEvent)
    const items = file.data.files || [];
    if (items.length) {
      const docs = items.filter((f) => !f.photoOf), photos = items.filter((f) => f.photoOf);
      const have = new Set((await db.files.bulkGet(docs.map((f) => f.id))).filter(Boolean).map((f) => f!.id));
      let added = 0, kept = 0;
      for (const f of docs) {
        if (have.has(f.id) && !opts.update) { kept++; continue; }
        await db.files.put({ id: f.id, projectId: f.projectId || '', personId: f.personId, name: f.name, type: f.type, size: f.size, blob: fromBase64(f.base64, f.type), createdAt: f.createdAt || new Date().toISOString() });
        added++;
      }
      if (docs.length) out.push({ table: 'files', added, updated: 0, kept });
      let pAdded = 0, pKept = 0;
      for (const f of photos) {
        const e = (await db.equipment.get(f.photoOf!)) as Equipment | undefined;
        if (!e || (e.photo && !opts.update)) { pKept++; continue; }
        try {
          const photo = await resizeImage(new File([fromBase64(f.base64, f.type)], f.name, { type: f.type }));
          await db.equipment.update(e.id, { photo });
          pAdded++;
        } catch { pKept++; }
      }
      if (photos.length) out.push({ table: 'photos', added: pAdded, updated: 0, kept: pKept });
    }
  } finally { suppressLog(false); }
  return out;
}
