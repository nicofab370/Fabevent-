import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, StatusBadge } from '../../components/ui';
import { db } from '../../db';
import type { EquipGroup, Equipment, EquipmentLine, Subproject } from '../../types';
import { availableQty, factorFor, fmtRange, lineBlock, lineDays, lineTotal, money, nowIso, round2, save, sortPeriods, uid, type Reservation } from '../../utils';
import { isPerPiece, type ProjectData } from './shared';

/** Onglet Équipement : le matériel de chaque salle, organisé en groupes rattachés à des créneaux. */
export default function EquipmentTab({ d }: { d: ProjectData }) {
  return (
    <>
      <div className="info">
        Organise le matériel en <strong>groupes</strong> (par type : son, lumière… ; par emplacement : scène, bar… ; ou par jour).
        Un groupe rattaché à certains créneaux ne bloque et ne facture le matériel que sur ces créneaux.
      </div>
      {d.subs.map((sp) => <RoomEquipment key={sp.id} d={d} sp={sp} />)}
    </>
  );
}

function RoomEquipment({ d, sp }: { d: ProjectData; sp: Subproject }) {
  const nav = useNavigate();
  const { settings, av, eqMap } = d;
  const [picking, setPicking] = useState<string | null | undefined>(undefined);
  const [editGroup, setEditGroup] = useState<Partial<EquipGroup> | null>(null);
  const lines = d.lines.filter((l) => l.subprojectId === sp.id).sort((a, b) => a.order - b.order);
  const groups = sp.groups || [];
  const periods = sortPeriods(sp.periods || []);
  const weight = lines.reduce((a, l) => a + (l.equipmentId && !l.optional ? (eqMap.get(l.equipmentId)?.weight || 0) * l.qty : 0), 0);
  const total = round2(lines.filter((l) => !l.optional).reduce((a, l) => a + lineTotal(l, lineDays(l, sp), settings, isPerPiece(l, eqMap)), 0));

  const updLine = async (l: EquipmentLine, patch: Partial<EquipmentLine>) => {
    await save(db.lines, { ...l, ...patch });
    const children = lines.filter((c) => c.parentLineId === l.id);
    // les accessoires suivent la quantité et le groupe de leur ligne
    if (patch.qty !== undefined && l.equipmentId) {
      const acc = eqMap.get(l.equipmentId)?.accessories || [];
      for (const c of children) {
        const a = acc.find((x) => x.equipmentId === c.equipmentId);
        if (a) await save(db.lines, { ...c, qty: a.qty * patch.qty });
      }
    }
    if ('groupId' in patch) for (const c of children) await save(db.lines, { ...c, groupId: patch.groupId });
  };
  const removeLine = (l: EquipmentLine) => db.lines.bulkDelete([l.id, ...lines.filter((c) => c.parentLineId === l.id).map((c) => c.id)]);

  const sections: { group?: EquipGroup; lines: EquipmentLine[] }[] = [
    ...groups.map((g) => ({ group: g, lines: lines.filter((l) => l.groupId === g.id) })),
    { group: undefined, lines: lines.filter((l) => !l.groupId || !groups.some((g) => g.id === l.groupId)) },
  ];

  return (
    <div className="sub">
      <div className="sub-head">
        <div>
          <h3>{sp.name} <StatusBadge status={sp.status} /></h3>
          <div className="muted">{lines.length} ligne(s){weight > 0 && ` · ${round2(weight)} kg`}</div>
        </div>
        <div className="actions">
          <strong>{money(total)} HT</strong>
          <button className="secondary small" onClick={() => setEditGroup({ name: '', periodIds: [] })}>+ Groupe</button>
          <button className="secondary small" onClick={() => nav('/entrepot/' + sp.id)}>Préparer / scanner</button>
        </div>
      </div>
      <div className="sub-body">
        {sections.map(({ group, lines: gl }) => {
          if (!group && !gl.length && groups.length) return null;
          const ordered = gl.filter((l) => !l.parentLineId || !gl.some((x) => x.id === l.parentLineId)).flatMap((l) => [l, ...gl.filter((c) => c.parentLineId === l.id)]);
          const gp = group?.periodIds.length ? periods.filter((p) => group.periodIds.includes(p.id)) : [];
          return (
            <div key={group?.id || 'none'} className="eq-group">
              <div className="eq-group-head">
                <strong>{group ? group.name : groups.length ? 'Sans groupe' : 'Matériel'}</strong>
                <span className="muted">{gp.length ? gp.map((p) => p.name).join(', ') : 'toute la salle'}{gl[0] && ` · ${lineDays(gl[0], sp)} j facturé(s)`}</span>
                {group && <button className="ghost small" onClick={() => setEditGroup(group)}>Modifier</button>}
                <span style={{ flex: 1 }} />
                <button className="small" onClick={() => setPicking(group?.id ?? null)}>+ Matériel</button>
                <button className="secondary small" onClick={() => save(db.lines, { projectId: sp.projectId, subprojectId: sp.id, groupId: group?.id, name: 'Prestation', qty: 1, unitPrice: 0, discount: 0, order: lines.length })}>+ Ligne libre</button>
              </div>
              {ordered.length > 0 && (
                <div className="table-wrap">
                  <table className="list">
                    <thead><tr><th>Qté</th><th>Désignation</th><th className="n">Dispo</th><th>P.U.</th><th>Remise %</th><th title="Ligne facultative proposée en option sur le devis">Option</th>{groups.length > 0 && <th>Groupe</th>}<th className="n">Total HT</th><th /></tr></thead>
                    <tbody>
                      {ordered.map((l) => {
                        const eq = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
                        const [b0, b1] = lineBlock(l, sp);
                        const avail = eq ? availableQty(eq, av.equipment, av.res, b0, b1, l.id, d.depot) : null;
                        const perPiece = isPerPiece(l, eqMap);
                        return (
                          <tr key={l.id} style={l.optional ? { opacity: 0.6 } : undefined}>
                            <td><NumInput className="w-qty" step="1" min={0} value={l.qty} onChange={(n) => updLine(l, { qty: n })} /></td>
                            <td style={l.parentLineId ? { paddingLeft: 24 } : undefined}>
                              {l.parentLineId && <span className="muted">↳ </span>}
                              {eq ? <Link to={'/materiel/' + eq.id}>{l.name}</Link> : <input value={l.name} onChange={(e) => updLine(l, { name: e.target.value })} />}
                              {perPiece && <span className="badge" style={{ marginLeft: 6 }}>vente</span>}
                            </td>
                            <td className="n">{avail === null ? '—' : <span className={'avail ' + (avail >= l.qty || l.optional ? 'ok' : 'ko')}>{avail}</span>}</td>
                            <td><NumInput className="w-price" value={l.unitPrice} onChange={(n) => updLine(l, { unitPrice: n })} /></td>
                            <td><NumInput className="w-qty" value={l.discount} onChange={(n) => updLine(l, { discount: n })} /></td>
                            <td><input type="checkbox" checked={!!l.optional} onChange={(e) => updLine(l, { optional: e.target.checked })} /></td>
                            {groups.length > 0 && (
                              <td>{!l.parentLineId && (
                                <select value={l.groupId || ''} onChange={(e) => updLine(l, { groupId: e.target.value || undefined })}>
                                  <option value="">—</option>
                                  {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                                </select>
                              )}</td>
                            )}
                            <td className="n">{money(lineTotal(l, lineDays(l, sp), settings, perPiece))}</td>
                            <td><button className="ghost" onClick={() => removeLine(l)} aria-label="Retirer">✕</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
        <p className="muted" style={{ marginBottom: 0 }}>Coefficient de durée : {lineDays({}, sp)} j → ×{factorFor(lineDays({}, sp), settings)} (hors groupes rattachés à des créneaux).</p>
      </div>
      {picking !== undefined && (
        <EquipmentPicker sp={sp} groupId={picking || undefined} depot={d.depot} equipment={av.equipment} res={av.res} existing={lines} onClose={() => setPicking(undefined)} />
      )}
      {editGroup && <GroupModal sp={sp} group={editGroup} onClose={() => setEditGroup(null)} />}
    </div>
  );
}

function GroupModal({ sp, group, onClose }: { sp: Subproject; group: Partial<EquipGroup>; onClose: () => void }) {
  const [g, setG] = useState(group);
  const periods = sortPeriods(sp.periods || []);
  const groups = sp.groups || [];
  return (
    <Modal title={g.id ? 'Modifier le groupe' : 'Nouveau groupe d\'équipement'} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const ng: EquipGroup = { id: g.id || uid(), name: g.name || 'Groupe', periodIds: g.periodIds || [] };
        await save(db.subprojects, { ...sp, groups: g.id ? groups.map((x) => (x.id === g.id ? ng : x)) : [...groups, ng] });
        onClose();
      }}>
        <Field label="Nom du groupe *" full><input required autoFocus value={g.name || ''} onChange={(e) => setG({ ...g, name: e.target.value })} placeholder="ex. Son, Lumière, Scène, Jour 1" /></Field>
        <div className="field full">
          <span>Créneaux couverts</span>
          {periods.length === 0 ? <p className="muted" style={{ margin: 0 }}>Cette salle n'a pas de créneaux détaillés : le groupe couvre toute la salle.</p> : (
            <>
              {periods.map((p) => (
                <label key={p.id} className="check-row">
                  <input type="checkbox" checked={(g.periodIds || []).includes(p.id)}
                    onChange={(e) => setG({ ...g, periodIds: e.target.checked ? [...(g.periodIds || []), p.id] : (g.periodIds || []).filter((x) => x !== p.id) })} />
                  {p.name} <span className="muted">{fmtRange(p.start, p.end)}</span>
                </label>
              ))}
              <p className="muted" style={{ margin: '4px 0 0' }}>Aucun coché = toute la salle (du premier au dernier créneau).</p>
            </>
          )}
        </div>
        <div className="form-actions">
          {g.id && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={async () => {
            if (!confirm('Supprimer le groupe ? Son matériel passe « sans groupe ».')) return;
            await save(db.subprojects, { ...sp, groups: groups.filter((x) => x.id !== g.id) });
            await db.lines.where({ subprojectId: sp.id }).modify((l) => { if (l.groupId === g.id) delete l.groupId; });
            onClose();
          }}>Supprimer</button>}
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}

/** Ajoute des articles (et leurs accessoires automatiques) à une salle, dans un groupe éventuel. */
export async function addEquipmentToSub(sp: Subproject, equipment: Equipment[], existing: EquipmentLine[], items: Record<string, number>, groupId?: string) {
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  let order = existing.length;
  const t = nowIso();
  for (const [eqId, n] of Object.entries(items)) {
    if (!n) continue;
    const eq = eqMap.get(eqId);
    if (!eq) continue;
    const same = existing.find((l) => l.equipmentId === eqId && !l.parentLineId && !l.optional && (l.groupId || undefined) === groupId);
    let lineId: string;
    let total: number;
    if (same) {
      total = same.qty + n;
      lineId = same.id;
      await save(db.lines, { ...same, qty: total });
    } else {
      total = n;
      lineId = uid();
      await db.lines.put({ id: lineId, createdAt: t, updatedAt: t, projectId: sp.projectId, subprojectId: sp.id, groupId, equipmentId: eqId, name: eq.name, qty: n, unitPrice: eq.dailyPrice, discount: 0, order: order++ });
    }
    for (const a of eq.accessories || []) {
      const acc = eqMap.get(a.equipmentId);
      if (!acc) continue;
      const child = existing.find((l) => l.parentLineId === lineId && l.equipmentId === a.equipmentId);
      if (child) await save(db.lines, { ...child, qty: a.qty * total });
      else await db.lines.put({ id: uid(), createdAt: t, updatedAt: t, projectId: sp.projectId, subprojectId: sp.id, groupId, equipmentId: acc.id, name: acc.name, qty: a.qty * total, unitPrice: a.free ? 0 : acc.dailyPrice, discount: 0, order: order++, parentLineId: lineId });
    }
  }
}

function EquipmentPicker({ sp, groupId, depot, equipment, res, existing, onClose }: { sp: Subproject; groupId?: string; depot?: string; equipment: Equipment[]; res: Reservation[]; existing: EquipmentLine[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const units = useLiveQuery(() => db.units.toArray(), []) || [];
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const [bStart, bEnd] = lineBlock({ groupId }, sp);
  const groupName = sp.groups?.find((g) => g.id === groupId)?.name;
  const list = equipment.filter((e) => [e.name, e.code, e.barcode, e.categoryId && catName.get(e.categoryId)].join(' ').toLowerCase().includes(q.toLowerCase()));
  const count = Object.values(qty).reduce((a, b) => a + (b || 0), 0);

  return (
    <Modal title={`Ajouter du matériel — ${sp.name}${groupName ? ` · ${groupName}` : ''}`} onClose={onClose} wide>
      <p className="muted" style={{ marginTop: 0 }}>Disponibilités du {fmtRange(bStart, bEnd)}</p>
      <div className="toolbar">
        <input autoFocus placeholder="Rechercher ou scanner un code-barres…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const code = q.trim();
            const hit = equipment.find((x) => x.barcode && x.barcode === code) || equipment.find((x) => x.id === units.find((u) => u.barcode === code || u.serial === code)?.equipmentId);
            if (hit) { setQty({ ...qty, [hit.id]: (qty[hit.id] || 0) + 1 }); setQ(''); }
          }} />
      </div>
      <div className="pick-list">
        {list.length === 0 ? <Empty>Aucun article.</Empty> : (
          <table className="list">
            <thead><tr><th>Article</th><th className="n">Dispo</th><th className="n">Prix</th><th>Qté</th></tr></thead>
            <tbody>
              {list.map((e) => {
                const avail = availableQty(e, equipment, res, bStart, bEnd, undefined, depot);
                return (
                  <tr key={e.id}>
                    <td>{e.name} {e.isKit && <span className="badge">Kit</span>} {e.kind === 'vente' && <span className="badge">vente</span>} <span className="muted">{e.code}</span>
                      {e.accessories?.length ? <div className="muted" style={{ fontSize: 11 }}>+ accessoires automatiques</div> : null}</td>
                    <td className="n"><span className={'avail ' + (avail - (qty[e.id] || 0) >= 0 ? 'ok' : 'ko')}>{avail}</span></td>
                    <td className="n">{money(e.dailyPrice)}{e.kind === 'vente' ? '' : '/j'}</td>
                    <td><NumInput className="w-qty" step="1" min={0} value={qty[e.id] || 0} onChange={(n) => setQty({ ...qty, [e.id]: n })} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="form-actions" style={{ marginTop: 12, display: 'flex' }}>
        <button className="secondary" onClick={onClose}>Annuler</button>
        <button disabled={!count} onClick={async () => { await addEquipmentToSub(sp, equipment, existing, qty, groupId); onClose(); }}>Ajouter {count > 0 ? `(${count})` : ''}</button>
      </div>
    </Modal>
  );
}
