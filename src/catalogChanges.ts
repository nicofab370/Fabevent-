/**
 * Changements du catalogue depuis l'ajout du matériel dans un projet : prix, nom, contenu d'un kit.
 * Rien n'est appliqué tout seul aux projets ; ces changements sont proposés, et on choisit ligne par ligne
 * de les appliquer ou de les ignorer (ils ne sont alors plus proposés).
 */
import { db } from './db';
import type { Equipment, EquipmentLine } from './types';
import { isFixedKit, isKitPart, isVirtualKit, money, nowIso, patch, uid } from './utils';

export interface CatalogChange {
  key: string;
  lineId: string;
  kind: 'prix' | 'nom' | 'contenu';
  /** nom de la ligne concernée */
  line: string;
  /** ce qui a changé, en clair */
  text: string;
  /** prix modifié à la main dans le projet : la mise à jour n'est pas proposée cochée */
  manual?: boolean;
}

/** Signature de la composition d'un kit (pour ne plus proposer une composition ignorée). */
export const kitSig = (e: Pick<Equipment, 'kitItems'>) => e.kitItems.map((k) => `${k.equipmentId}:${k.qty}`).sort().join(',');

/** Le contenu du kit est-il détaillé en lignes dans les projets ? (kit virtuel, ou kit fixe à vérifier) */
const detailsParts = (e: Equipment) => isVirtualKit(e) || (isFixedKit(e) && !!e.kitCheck && e.kitItems.length > 0);

export function catalogChanges(lines: EquipmentLine[], equipment: Equipment[]): CatalogChange[] {
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const out: CatalogChange[] = [];
  for (const l of lines) {
    const eq = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
    if (!eq) continue;
    const parent = l.parentLineId ? lines.find((x) => x.id === l.parentLineId) : undefined;
    const part = !!parent && isKitPart(l, parent.equipmentId ? eqMap.get(parent.equipmentId) : undefined);
    // prix : lignes facturées (le contenu gratuit d'un kit n'a pas de prix)
    const base = l.catalogPrice ?? (l.unitPrice ? l.unitPrice : undefined);
    if (!part && base !== undefined && eq.dailyPrice !== base) {
      const manual = l.catalogPrice !== undefined && l.unitPrice !== l.catalogPrice;
      out.push({ key: `prix:${l.id}`, lineId: l.id, kind: 'prix', line: l.name, manual,
        text: manual
          ? `Prix du catalogue ${money(base)} → ${money(eq.dailyPrice)} (prix du projet modifié à la main : ${money(l.unitPrice)})`
          : `Prix ${money(l.unitPrice)} → ${money(eq.dailyPrice)}` });
    }
    // nom de l'article
    if (!part && eq.name !== l.name && l.catalogName !== eq.name) {
      out.push({ key: `nom:${l.id}`, lineId: l.id, kind: 'nom', line: l.name, text: `Renommé au catalogue : « ${eq.name} »` });
    }
    // contenu d'un kit : comparé aux lignes de contenu du projet
    if (!parent && detailsParts(eq) && l.kitAck !== kitSig(eq)) {
      const parts = lines.filter((c) => c.parentLineId === l.id && isKitPart(c, eq));
      if (!parts.length) continue; // contenu jamais détaillé (ancien projet) : rien à comparer
      const have = new Map<string, number>();
      for (const c of parts) if (c.equipmentId) have.set(c.equipmentId, (have.get(c.equipmentId) || 0) + c.qty);
      const diffs: string[] = [];
      for (const k of eq.kitItems) {
        const want = k.qty * l.qty, got = have.get(k.equipmentId) || 0;
        const name = eqMap.get(k.equipmentId)?.name || '?';
        if (!got) diffs.push(`+ ${want} × ${name}`);
        else if (got !== want) diffs.push(`${name} : ${got} → ${want}`);
        have.delete(k.equipmentId);
      }
      for (const [id, n] of have) diffs.push(`− ${n} × ${eqMap.get(id)?.name || '?'} (retiré du kit)`);
      if (diffs.length) out.push({ key: `contenu:${l.id}`, lineId: l.id, kind: 'contenu', line: l.name, text: `Contenu du kit modifié : ${diffs.join(', ')}` });
    }
  }
  return out;
}

/** Applique (ou ignore) les changements choisis. */
export async function resolveCatalogChanges(changes: CatalogChange[], mode: 'appliquer' | 'ignorer', lines: EquipmentLine[], equipment: Equipment[]) {
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  for (const c of changes) {
    const l = lines.find((x) => x.id === c.lineId);
    const eq = l?.equipmentId ? eqMap.get(l.equipmentId) : undefined;
    if (!l || !eq) continue;
    if (c.kind === 'prix') {
      await patch(db.lines, l.id, mode === 'appliquer' ? { unitPrice: eq.dailyPrice, catalogPrice: eq.dailyPrice } : { catalogPrice: eq.dailyPrice });
    } else if (c.kind === 'nom') {
      await patch(db.lines, l.id, mode === 'appliquer' ? { name: eq.name, catalogName: eq.name } : { catalogName: eq.name });
    } else {
      if (mode === 'appliquer') {
        const parts = lines.filter((x) => x.parentLineId === l.id && isKitPart(x, eq));
        const t = nowIso();
        let order = l.order + 0.01;
        for (const k of eq.kitItems) {
          const want = k.qty * l.qty;
          const [first, ...dup] = parts.filter((x) => x.equipmentId === k.equipmentId);
          for (const d of dup) await db.lines.delete(d.id);
          const item = eqMap.get(k.equipmentId);
          if (first) { if (first.qty !== want) await patch(db.lines, first.id, { qty: want, kitPart: true }); }
          else await db.lines.put({
            id: uid(), createdAt: t, updatedAt: t, projectId: l.projectId, subprojectId: l.subprojectId, groupId: l.groupId, equipmentId: k.equipmentId,
            name: item?.name || '?', qty: want, unitPrice: 0, discount: 0, order: (order += 0.01), parentLineId: l.id, kitPart: true,
            optional: l.optional, periodIds: l.periodIds,
          });
        }
        for (const x of parts) if (!eq.kitItems.some((k) => k.equipmentId === x.equipmentId)) await db.lines.delete(x.id);
      }
      await patch(db.lines, l.id, { kitAck: kitSig(eq) });
    }
  }
}
