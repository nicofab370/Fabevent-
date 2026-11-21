import { db, logIsSuppressed, TABLES } from './db';

/*
 * Annuler (Ctrl+Z) : chaque modification de la base est mémorisée avec l'état d'avant.
 * Les changements faits d'un même geste (une transaction, ou à moins d'une seconde d'écart)
 * forment une seule étape. L'annulation remet les fiches telles qu'elles étaient
 * (et la synchronisation envoie ce retour en arrière aux autres appareils).
 * Historique en mémoire, perdu au rechargement de la page.
 * Jamais annulés : les numéros attribués (compteurs) et la création d'une facture, d'un acompte
 * ou d'un avoir (la numérotation doit rester continue).
 */

interface Entry { table: string; id: string; before?: unknown; created?: Record<string, unknown> }
export interface UndoStep { label: string; at: number; entries: Entry[] }

const SKIP = new Set(['log']);
const MAX_STEPS = 40;
const GROUP_MS = 1000;
const NUMBERED = new Set(['facture', 'acompte', 'avoir']);
const NAMES: Record<string, string> = {
  contacts: 'contact', categories: 'catégorie', equipment: 'article', projects: 'projet', subprojects: 'sous-projet',
  lines: 'ligne de matériel', people: 'technicien', crew: 'poste', vehicles: 'véhicule', vehicleAssignments: 'transport',
  docs: 'document', settings: 'paramètres', units: 'numéro de série', repairs: 'réparation', inspections: 'contrôle',
  subrentals: 'sous-location', costs: 'coût supplémentaire', unavailability: 'indisponibilité', files: 'fichier',
  transfers: 'transfert', appointments: 'rendez-vous', checklists: 'checklist', crewRequests: 'demande de dispo',
};

const steps: UndoStep[] = [];
let lastAt = 0;
let lastTx: unknown = null;
let pausedUntil = 0;
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
const notify = () => {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => { notifyTimer = null; listeners.forEach((l) => l()); }, 50);
};

const clone = <T,>(v: T): T => { try { return structuredClone(v); } catch { return JSON.parse(JSON.stringify(v)); } };
const nameOf = (o: unknown) => {
  const r = (o || {}) as Record<string, unknown>;
  const v = r.name ?? r.title ?? r.company ?? r.function ?? r.label ?? r.number ?? '';
  return v ? ` « ${String(v).slice(0, 40)} »` : '';
};

function record(table: string, id: string, kind: 'ajout' | 'modification' | 'suppression', before: unknown, after: unknown, tx: unknown) {
  if (logIsSuppressed() || Date.now() < pausedUntil) return;
  const t = tx as { __remote?: boolean; __undo?: boolean } | undefined;
  if (t?.__remote || t?.__undo) return;
  const now = Date.now();
  let step = steps[steps.length - 1];
  if (!step || (tx !== lastTx && now - lastAt > GROUP_MS)) {
    const verb = kind === 'ajout' ? 'Ajout' : kind === 'suppression' ? 'Suppression' : 'Modification';
    step = { label: `${verb} : ${NAMES[table] || table}${nameOf(after ?? before)}`, at: now, entries: [] };
    steps.push(step);
    if (steps.length > MAX_STEPS) steps.shift();
  } else if (step.entries.length && !step.label.endsWith('…') && !step.entries.some((e) => e.table === table && e.id === id)) {
    step.label += ' …';
  }
  lastAt = now; lastTx = tx;
  // on garde l'état le plus ancien de chaque fiche dans l'étape
  if (!step.entries.some((e) => e.table === table && e.id === id)) {
    step.entries.push({ table, id, before: before === undefined ? undefined : clone(before), created: kind === 'ajout' ? (after as Record<string, unknown>) : undefined });
  }
  notify();
}

let installed = false;
export function installUndo() {
  if (installed) return;
  installed = true;
  for (const name of TABLES) {
    if (SKIP.has(name)) continue;
    const t = db.table(name);
    t.hook('creating', (key, obj, tx) => { record(name, String(key ?? (obj as { id?: string }).id), 'ajout', undefined, obj, tx); });
    t.hook('updating', (mods, key, obj, tx) => {
      const keys = Object.keys(mods).filter((k) => k !== 'updatedAt');
      if (name === 'settings' && keys.every((k) => k.startsWith('counters'))) return; // simple numérotation
      if (keys.length) record(name, String(key), 'modification', obj, { ...(obj as object), ...mods }, tx);
    });
    t.hook('deleting', (key, obj, tx) => { if (obj) record(name, String(key), 'suppression', obj, undefined, tx); });
  }
}

/** n'enregistre rien pendant ms millisecondes (chargement de données, import technique…) */
export function pauseUndo(ms = 1500) { pausedUntil = Date.now() + ms; }
export function clearUndo() { steps.length = 0; notify(); }
export const lastUndo = (): UndoStep | undefined => steps[steps.length - 1];
export const undoCount = () => steps.length;
export function onUndoChange(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }

/** annule la dernière étape ; renvoie son libellé */
export async function undo(): Promise<string | null> {
  const step = steps.pop();
  if (!step) return null;
  lastTx = null; lastAt = 0;
  const tables = Array.from(new Set(step.entries.map((e) => e.table)));
  await db.transaction('rw', tables.map((t) => db.table(t)), async (tx) => {
    (tx as unknown as { __undo: boolean }).__undo = true;
    for (const e of [...step.entries].reverse()) {
      const table = db.table(e.table);
      if (e.before === undefined) {
        const cur = (await table.get(e.id)) as Record<string, unknown> | undefined;
        if (e.table === 'docs' && NUMBERED.has(String((cur ?? e.created)?.type))) continue;
        await table.delete(e.id);
      } else {
        let b = e.before as Record<string, unknown>;
        if (e.table === 'settings') {
          const cur = (await table.get(e.id)) as Record<string, unknown> | undefined;
          if (cur?.counters) b = { ...b, counters: cur.counters };
        }
        await table.put({ ...b, updatedAt: new Date().toISOString() });
      }
    }
  });
  notify();
  return step.label;
}
