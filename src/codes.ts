import { db } from './db';
import type { Equipment, SerialUnit } from './types';
import { nowIso, patch } from './utils';

export interface CodeHit {
  equipment: Equipment;
  unit?: SerialUnit;
}

const norm = (s?: string) => (s || '').trim().toLowerCase();

/** QR « lien vers la fiche » (…#/q/F-S-0010-03) : on en extrait le code. */
export function codeFromScan(raw: string): string {
  const m = raw.trim().match(/#\/q\/([^?#\s]+)/);
  return m ? decodeURIComponent(m[1]) : raw.trim();
}

/** Code imprimé sur l'étiquette d'un article en vrac : code-barres existant, sinon son code (F-S-0010), sinon un code généré. */
export function labelCode(e: { id: string; code?: string; barcode?: string }): string {
  return e.barcode || e.code?.replace(/\s+/g, '') || `FE-${e.id.slice(0, 8).toUpperCase()}`;
}

/** « Chargeur 65 W, 2 × Câble USB-C » */
export function contentsText(e?: Pick<Equipment, 'contents'>): string {
  return (e?.contents || []).map((c) => (c.qty > 1 ? `${c.qty} × ${c.name}` : c.name)).join(', ');
}

/**
 * Retrouve l'article (et l'unité) d'un code scanné : étiquette FabEvent, code article,
 * numéro de série, ou l'un des « codes en plus » (code-barres du fabricant, ancienne étiquette…).
 */
export function findByCode(raw: string, equipment: Equipment[], units: SerialUnit[]): CodeHit | undefined {
  const c = norm(codeFromScan(raw));
  if (!c) return undefined;
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const unit = units.find((u) => norm(u.barcode) === c || norm(u.serial) === c || (u.extraCodes || []).some((x) => norm(x) === c));
  if (unit) {
    const e = eqMap.get(unit.equipmentId);
    if (e) return { equipment: e, unit };
  }
  const e = equipment.find((x) => norm(x.barcode) === c || norm(x.code) === c || (x.extraCodes || []).some((y) => norm(y) === c));
  return e ? { equipment: e } : undefined;
}

/** Le code est-il déjà utilisé par un autre article ou une autre unité ? */
export function codeOwner(raw: string, equipment: Equipment[], units: SerialUnit[]): CodeHit | undefined {
  return findByCode(raw, equipment, units);
}

/** Ajoute un code en plus à un article ou à une unité (20 au plus). */
export async function addExtraCode(target: { equipmentId: string; unitId?: string }, raw: string) {
  const code = raw.replace(/[\s,;]+/g, '').slice(0, 120);
  if (!code) return;
  if (target.unitId) {
    const u = await db.units.get(target.unitId);
    if (!u) return;
    const list = u.extraCodes || [];
    if (!list.some((x) => norm(x) === norm(code))) await patch(db.units, u.id, { extraCodes: [...list, code].slice(-20) });
  } else {
    const e = await db.equipment.get(target.equipmentId);
    if (!e) return;
    const list = e.extraCodes || [];
    if (!list.some((x) => norm(x) === norm(code))) await patch(db.equipment, e.id, { extraCodes: [...list, code].slice(-20) });
  }
}

export async function removeExtraCode(target: { equipmentId: string; unitId?: string }, code: string) {
  if (target.unitId) {
    const u = await db.units.get(target.unitId);
    if (u) await patch(db.units, u.id, { extraCodes: (u.extraCodes || []).filter((x) => norm(x) !== norm(code)) });
  } else {
    const e = await db.equipment.get(target.equipmentId);
    if (e) await patch(db.equipment, e.id, { extraCodes: (e.extraCodes || []).filter((x) => norm(x) !== norm(code)) });
  }
}

/* ---------- État des unités, avec historique daté (comme les remarques datées de FABRI.live) ---------- */

export type UnitState = 'ok' | 'fix' | 'repair' | 'lost';
export const UNIT_STATE_LABELS: Record<UnitState, string> = {
  ok: 'En service', fix: 'À réparer (utilisable)', repair: 'En réparation (hors service)', lost: 'Perdue',
};

export function unitState(u: Pick<SerialUnit, 'status' | 'defect'>): UnitState {
  if (u.status === 'perdu') return 'lost';
  if (u.status === 'hs') return 'repair';
  return u.defect ? 'fix' : 'ok';
}

const today = () => new Date().toLocaleDateString('fr-FR');

/**
 * Change l'état d'une unité en gardant une ligne d'historique datée :
 * perdue (sort du stock), à réparer (reste utilisable), en réparation (hors service), remise en service / retrouvée.
 */
export async function setUnitState(unitId: string, state: UnitState, note = '', projectId?: string) {
  const u = await db.units.get(unitId);
  if (!u) return;
  const before = unitState(u);
  const text =
    state === 'lost' ? `PERDUE${note ? ` — ${note}` : ''}`
      : state === 'fix' ? `À RÉPARER (utilisable) — ${note || 'raison non précisée'}`
        : state === 'repair' ? `EN RÉPARATION (hors service) — ${note || 'raison non précisée'}`
          : before === 'lost' ? `Retrouvée, remise en stock${note ? ` · ${note}` : ''}`
            : before === 'repair' || before === 'fix' ? `Remise en service (réparée)${note ? ` · ${note}` : ''}` : `Remise en service${note ? ` · ${note}` : ''}`;
  await patch(db.units, unitId, {
    status: state === 'lost' ? 'perdu' : state === 'repair' ? 'hs' : 'ok',
    defect: state === 'fix' ? note || 'à vérifier' : undefined,
    history: [...(u.history || []), { at: nowIso(), text: `[${today()}] ${text}`, projectId }],
  });
}
