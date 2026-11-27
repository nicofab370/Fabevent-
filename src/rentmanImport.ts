/**
 * Import dans FabEvent du fichier produit par tools/rentman-import/export.mjs (export Rentman).
 * Ajoute les fiches à la base ouverte, sans rien effacer. Chaque fiche importée a un identifiant « rm-… » :
 * un nouvel import ajoute ce qui manque, et met à jour les fiches déjà importées seulement si on le demande
 * (sinon les modifications faites dans FabEvent sont gardées).
 */
import { db, suppressLog } from './db';

/** Ordre d'import : les fiches référencées d'abord. */
const ORDER = ['categories', 'contacts', 'equipment', 'units', 'people', 'vehicles', 'projects', 'subprojects', 'lines', 'crew', 'vehicleAssignments'] as const;
type Table = (typeof ORDER)[number];

export const RENTMAN_LABELS: Record<Table, string> = {
  categories: 'catégories', contacts: 'contacts (clients, lieux)', equipment: 'articles', units: 'unités numérotées', people: 'personnes (équipe)',
  vehicles: 'véhicules', projects: 'projets', subprojects: 'sous-projets', lines: 'lignes de matériel', crew: 'postes', vehicleAssignments: 'véhicules des projets',
};

export interface RentmanFile {
  app: 'fabevent';
  kind: 'import';
  source: 'rentman';
  exportedAt: string;
  report?: { counts?: Record<string, number>; warnings?: string[]; skipped?: string[] };
  data: Partial<Record<Table, { id: string }[]>>;
}

export function readRentmanFile(text: string): RentmanFile {
  let j: RentmanFile;
  try { j = JSON.parse(text); } catch { throw new Error('Fichier illisible (JSON attendu).'); }
  if (j?.app !== 'fabevent' || j.kind !== 'import' || j.source !== 'rentman' || !j.data) throw new Error('Ce fichier n’est pas un export Rentman pour FabEvent.');
  return j;
}

export interface ImportResult { table: Table; added: number; updated: number; kept: number }

export async function importRentman(file: RentmanFile, opts: { update: boolean }): Promise<ImportResult[]> {
  const out: ImportResult[] = [];
  suppressLog(true); // pas d'historique « Annuler » pour des milliers de fiches
  try {
    for (const t of ORDER) {
      const rows = (file.data[t] || []).filter((r) => r && typeof r.id === 'string' && r.id.startsWith('rm-'));
      if (!rows.length) continue;
      const table = db.table(t);
      const existing = await table.bulkGet(rows.map((r) => r.id));
      const toPut: { id: string }[] = [];
      let added = 0, updated = 0, kept = 0;
      rows.forEach((r, i) => {
        const cur = existing[i] as Record<string, unknown> | undefined;
        if (!cur) { toPut.push(r); added++; }
        else if (opts.update) { toPut.push({ ...cur, ...r }); updated++; }
        else kept++;
      });
      for (let i = 0; i < toPut.length; i += 500) await table.bulkPut(toPut.slice(i, i + 500));
      out.push({ table: t, added, updated, kept });
    }
  } finally { suppressLog(false); }
  return out;
}
