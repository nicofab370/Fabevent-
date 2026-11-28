/**
 * Onglet Matériel d'un projet :
 * - suggestions « souvent loué avec » (d'après l'historique des projets, sans IA) ;
 * - totaux de transport (poids, volume, caisses selon « rangé par ») ;
 * - export de la liste des biens du carnet ATA (dédouanement temporaire hors UE).
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { db } from '../../db';
import { volumeL } from '../../lookup';
import type { EquipmentLine } from '../../types';
import { download, money } from '../../utils';
import type { ProjectData } from './shared';
import { addEquipmentToSub } from './EquipmentTab';

/** Articles souvent présents dans les mêmes projets que ceux déjà choisis. */
export function coRented(projectLines: EquipmentLine[], allLines: EquipmentLine[], max = 8): { equipmentId: string; score: number }[] {
  const mine = new Set(projectLines.map((l) => l.equipmentId).filter(Boolean) as string[]);
  if (!mine.size) return [];
  const byProject = new Map<string, Set<string>>();
  for (const l of allLines) if (l.equipmentId && !l.parentLineId) { const s = byProject.get(l.projectId) || new Set(); s.add(l.equipmentId); byProject.set(l.projectId, s); }
  const score = new Map<string, number>();
  const pid = projectLines[0]?.projectId;
  for (const [p, set] of byProject) {
    if (p === pid) continue;
    const overlap = [...set].filter((x) => mine.has(x)).length;
    if (!overlap) continue;
    for (const e of set) if (!mine.has(e)) score.set(e, (score.get(e) || 0) + overlap);
  }
  return [...score].map(([equipmentId, s]) => ({ equipmentId, score: s })).sort((a, b) => b.score - a.score).slice(0, max);
}

export function EquipmentExtras({ d }: { d: ProjectData }) {
  const allLines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const [hidden, setHidden] = useState(false);
  const eqMap = d.eqMap;
  const lines = d.lines.filter((l) => !l.optional);
  const sugg = useMemo(() => coRented(d.lines, allLines).map((x) => ({ ...x, e: eqMap.get(x.equipmentId) })).filter((x) => x.e && !x.e.archived && !x.e.hideInPicker), [d.lines, allLines, eqMap]);
  // transport : poids, volume et caisses (« rangé par N »)
  let kg = 0, liters = 0, cases = 0;
  for (const l of lines) {
    const e = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
    if (!e || l.parentLineId) continue;
    const boxes = e.packedPer && e.packedPer > 1 ? Math.ceil(l.qty / e.packedPer) : 0;
    cases += boxes;
    kg += (e.weight || 0) * l.qty;
    liters += e.dims ? volumeL(e.dims) * (boxes ? boxes * e.packedPer! : l.qty) : 0;
  }
  const exportAta = () => {
    const rows = [['Description', 'N° article', 'Pays d\'origine', 'Poids unitaire (kg)', 'Quantité', 'Poids total (kg)', 'Valeur unitaire (€)', 'Valeur totale (€)', 'N° de série']];
    let totQ = 0, totKg = 0, totV = 0;
    for (const l of lines) {
      const e = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
      if (!e || e.accessoryOnly) continue;
      const value = e.replacementValue || 0;
      const serials = [...(l.outSerials || [])].join(' ');
      rows.push([e.name, e.code || '', e.originCountry || '', String(e.weight || ''), String(l.qty), String(Math.round((e.weight || 0) * l.qty * 100) / 100), value.toFixed(2), (value * l.qty).toFixed(2), serials]);
      totQ += l.qty; totKg += (e.weight || 0) * l.qty; totV += value * l.qty;
    }
    rows.push(['TOTAL', '', '', '', String(totQ), String(Math.round(totKg * 100) / 100), '', totV.toFixed(2), '']);
    const cell = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    download(`carnet-ATA-${d.project.number}.csv`, '﻿' + rows.map((r) => r.map(cell).join(';')).join('\r\n'), 'text/csv;charset=utf-8');
  };
  const missingOrigin = lines.filter((l) => l.equipmentId && !eqMap.get(l.equipmentId)?.originCountry).length;
  return (
    <div className="eq-extras no-print">
      <div className="toolbar">
        {(kg > 0 || liters > 0 || cases > 0) && <span className="muted">Transport : {kg ? `${Math.round(kg)} kg` : ''}{liters ? ` · ${String(Math.round(liters / 100) / 10).replace('.', ',')} m³` : ''}{cases ? ` · ${cases} caisse(s)` : ''}</span>}
        <button className="secondary small" onClick={exportAta} disabled={!lines.length} title={missingOrigin ? `${missingOrigin} ligne(s) sans pays d'origine (fiche de l'article)` : 'Liste des biens pour le carnet ATA'}>Liste du carnet ATA (CSV)</button>
      </div>
      {sugg.length > 0 && !hidden && (
        <div className="card suggestions">
          <div className="page-head" style={{ marginBottom: 6 }}>
            <h3 style={{ margin: 0 }}>Suggestions : souvent loué avec ce matériel</h3>
            <button className="ghost small" onClick={() => setHidden(true)}>Masquer</button>
          </div>
          <div className="chips">
            {sugg.map(({ e }) => (
              <button key={e!.id} className="secondary small" title={`Ajouter 1 × ${e!.name} au premier sous-projet`}
                onClick={() => d.subs[0] && addEquipmentToSub(d.subs[0], d.av.equipment, d.lines.filter((l) => l.subprojectId === d.subs[0].id), { [e!.id]: 1 }, undefined, d.client?.discounts?.equipment || 0)}>
                + {e!.name} <span className="muted">{money(e!.dailyPrice)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
