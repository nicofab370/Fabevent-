import { newArticleCode, unitSuffix } from './codegen';
import { db } from './db';
import type { Equipment, SerialUnit, Settings } from './types';
import { nowIso } from './utils';

/*
 * Article sérialisé sans code interne : il reçoit un code logique, comme un nouvel article
 * (dépôt-catégorie-numéro, ex. F-S-0042). Ses unités sans code prennent ce code + leur numéro #x
 * sur 2 caractères (#3 → F-S-0042-03), le même que celui d'une unité créée dans FabEvent.
 */

/** codes manquants (fonction pure, pour les tests) : articles à modifier et unités à modifier */
export function missingSerialCodes(equipment: Equipment[], units: SerialUnit[], settings: Pick<Settings, 'depots' | 'codeLetter'>, cats: Parameters<typeof newArticleCode>[2]) {
  const known = equipment.map((e) => ({ code: e.code }));
  const eqOut: Equipment[] = [];
  const unitOut: SerialUnit[] = [];
  const taken = new Set(units.flatMap((u) => [u.barcode, u.serial]).filter(Boolean).map((c) => c!.toUpperCase()));
  for (const e of equipment) {
    if (!e.trackSerials) continue;
    let code = e.code?.trim();
    if (!code) {
      code = newArticleCode(e, settings, cats, known);
      known.push({ code });
      eqOut.push({ ...e, code });
    }
    for (const u of units.filter((x) => x.equipmentId === e.id && !x.barcode?.trim())) {
      // le numéro #x de l'unité donne la fin du code ; s'il est déjà pris, le premier suivant libre
      let n = u.number || 1, c = `${code}-${unitSuffix(n)}`;
      while (taken.has(c.toUpperCase())) c = `${code}-${unitSuffix(++n)}`;
      taken.add(c.toUpperCase());
      unitOut.push({ ...u, barcode: c });
    }
  }
  return { equipment: eqOut, units: unitOut };
}

/** applique les codes manquants (au démarrage, après une synchronisation ou un import) */
export async function ensureSerialCodes(): Promise<number> {
  const settings = (await db.settings.get('main')) as Settings | undefined;
  if (!settings) return 0;
  const { equipment, units } = missingSerialCodes(await db.equipment.toArray(), await db.units.toArray(), settings, await db.categories.toArray());
  const t = nowIso();
  if (equipment.length) await db.equipment.bulkPut(equipment.map((e) => ({ ...e, updatedAt: t })));
  if (units.length) await db.units.bulkPut(units.map((u) => ({ ...u, updatedAt: t })));
  return equipment.length + units.length;
}
