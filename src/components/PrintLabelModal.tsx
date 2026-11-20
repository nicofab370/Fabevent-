import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { contentsText, labelCode } from '../codes';
import { appBaseUrl, db } from '../db';
import { save } from '../utils';
import PtouchPanel, { type LabelData } from './PtouchPanel';
import { Modal, NumInput, useSettings } from './ui';

/**
 * Impression rapide de l'étiquette d'un article (ou de ses unités) sur l'étiqueteuse Brother PT-P750W,
 * depuis la fiche ou la modification de l'article.
 */
export default function PrintLabelModal({ equipmentId, unitIds, onClose }: { equipmentId: string; unitIds?: string[]; onClose: () => void }) {
  const settings = useSettings();
  const eq = useLiveQuery(() => db.equipment.get(equipmentId), [equipmentId]);
  const units = useLiveQuery(() => db.units.where({ equipmentId }).toArray(), [equipmentId]) || [];
  const [picked, setPicked] = useState<Set<string> | null>(unitIds ? new Set(unitIds) : null);
  const [copies, setCopies] = useState(1);
  if (!eq) return null;

  const serial = !!eq.trackSerials;
  const sorted = [...units].sort((a, b) => (a.barcode || a.serial).localeCompare(b.barcode || b.serial));
  // par défaut : toutes les unités en service
  const sel = picked || new Set(sorted.filter((u) => u.status === 'ok').map((u) => u.id));
  const total = serial ? sorted.filter((u) => sel.has(u.id)).length * copies : copies;
  const linkFor = settings.qrLink ? (code: string) => `${appBaseUrl(settings)}#/q/${encodeURIComponent(code)}` : undefined;

  const collect = async (persist: boolean): Promise<LabelData[]> => {
    const out: LabelData[] = [];
    const contents = contentsText(eq) || undefined;
    if (serial) {
      for (const u of sorted.filter((x) => sel.has(x.id))) {
        const code = u.barcode || u.serial;
        if (persist && !u.barcode) await save(db.units, { ...u, barcode: code });
        for (let i = 0; i < copies; i++) out.push({ code, title: eq.name, sub: code, serial: u.serial === code ? undefined : u.serial, contents });
      }
    } else {
      const code = labelCode(eq);
      if (persist && !eq.barcode) await save(db.equipment, { ...eq, barcode: code });
      for (let i = 0; i < copies; i++) out.push({ code, title: eq.name, sub: eq.code || code, contents });
    }
    return out;
  };

  const toggle = (id: string) => { const n = new Set(sel); if (n.has(id)) n.delete(id); else n.add(id); setPicked(n); };

  return (
    <Modal title={`Étiquette — ${eq.name}`} onClose={onClose} wide>
      <div className="card print-label-pick">
        {serial ? (
          sorted.length === 0 ? <p className="muted">Aucune unité : ajoute d'abord les unités de cet article.</p> : (
            <>
              <div className="toolbar">
                <strong>Unités à étiqueter</strong>
                <button type="button" className="ghost small" onClick={() => setPicked(new Set(sorted.map((u) => u.id)))}>Toutes</button>
                <button type="button" className="ghost small" onClick={() => setPicked(new Set())}>Aucune</button>
              </div>
              <div className="unit-picks">
                {sorted.map((u) => (
                  <label key={u.id} className="check-row">
                    <input type="checkbox" checked={sel.has(u.id)} onChange={() => toggle(u.id)} />
                    <code>{u.barcode || u.serial}</code>{u.serial && u.serial !== (u.barcode || u.serial) && <span className="muted">n° {u.serial}</span>}
                    {u.status !== 'ok' && <span className="badge">{u.status === 'hs' ? 'hors service' : 'perdue'}</span>}
                  </label>
                ))}
              </div>
            </>
          )
        ) : <div>Code imprimé : <code>{labelCode(eq)}</code>{!eq.barcode && <span className="muted"> (enregistré sur l'article à l'impression)</span>}</div>}
        <label className="check-row" style={{ marginTop: 8 }}>
          Exemplaires {serial ? 'par unité' : ''} <NumInput className="w-qty" step="1" min={1} value={copies} onChange={(n) => setCopies(Math.max(1, Math.min(99, Math.round(n) || 1)))} aria-label="Nombre d'exemplaires" />
        </label>
      </div>
      <PtouchPanel total={total} sig={[...sel].join(',') + (eq.barcode || '') + (eq.code || '')} collect={collect} linkFor={linkFor} company={settings.company.name} />
      <p className="muted">Planche A4 ou rouleau : <Link to="/etiquettes" onClick={onClose}>page Étiquettes</Link>.</p>
    </Modal>
  );
}
