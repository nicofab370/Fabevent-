import { moveUnitToDepot } from './codes';
import { db, mainDepotId } from './db';
import type { Settings, Transfer } from './types';
import { isVirtualKit, patch } from './utils';

/*
 * Transfert définitif effectué : le stock change vraiment de dépôt (stock propre de chaque dépôt, unités choisies).
 * Le transfert ne compte plus ensuite dans les disponibilités (sinon il compterait deux fois).
 * Un transfert temporaire ou planifié reste une réservation datée.
 */

/** déplace (sens 1) ou remet en place (sens -1) le stock d'un transfert définitif */
export async function applyTransfer(t: Transfer, settings: Pick<Settings, 'depots'>, sign: 1 | -1, label = '') {
  const main = mainDepotId(settings);
  const [from, to] = sign === 1 ? [t.fromDepotId, t.toDepotId] : [t.toDepotId, t.fromDepotId];
  for (const l of t.lines) {
    const e = await db.equipment.get(l.equipmentId);
    if (!e || isVirtualKit(e) || e.accessoryOnly) continue;
    if (e.trackSerials) {
      for (const id of l.unitIds || []) await moveUnitToDepot(id, to, label || `Transfert ${t.number}`);
      continue;
    }
    // vrac : le dépôt principal a « le reste » ; les autres dépôts ont leur quantité propre
    const stock = { ...(e.stock || {}) };
    if (from !== main) stock[from] = (stock[from] || 0) - l.qty;
    if (to !== main) stock[to] = (stock[to] || 0) + l.qty;
    await patch(db.equipment, e.id, {
      stock,
      stockLog: [...(e.stockLog || []), { at: new Date().toISOString(), delta: 0, text: `[${new Date().toLocaleDateString('fr-FR')}] ${label || `Transfert ${t.number}`} : ${l.qty} ${sign === 1 ? 'déplacé(s)' : 'remis'} vers ${settings.depots?.find((d) => d.id === to)?.name || 'dépôt principal'}` }],
    });
  }
}

/** transferts définitifs déjà « effectués » avant cette version : leur stock est déplacé une fois */
export async function applyDoneTransfers(): Promise<number> {
  const settings = (await db.settings.get('main')) as Settings | undefined;
  if (!settings || (settings.depots?.length || 0) < 2) return 0;
  const todo = (await db.transfers.toArray()).filter((t) => !t.end && t.status === 'effectue' && !t.applied);
  for (const t of todo) {
    // unités déjà rangées par l'ancienne version : on ne les déplace pas deux fois
    await applyTransfer(t, settings, 1);
    await patch(db.transfers, t.id, { applied: true });
  }
  return todo.length;
}
