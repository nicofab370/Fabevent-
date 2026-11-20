import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, StatusBadge } from '../../components/ui';
import { db } from '../../db';
import type { EquipGroup, Equipment, EquipmentLine, Subproject } from '../../types';
import { availableQty, blockPeriod, factorFor, fmtRange, lineBlock, lineDays, lineTotal, money, nowIso, round2, save, sortPeriods, uid, type Reservation, patch } from '../../utils';
import { isPerPiece, type ProjectData } from './shared';

const EQ_MIME = 'application/x-fabevent-equipment';
const LINE_MIME = 'application/x-fabevent-line';

/** Cible du glisser-déposer (ou du bouton « + » du catalogue sur tablette) : un groupe d'un sous-projet. */
export interface DropTarget { subId: string; groupId?: string }

/**
 * Onglet Équipement : le matériel de chaque sous-projet, organisé en groupes rattachés à des créneaux.
 * Le catalogue à droite se glisse-dépose dans un groupe ; une ligne se glisse vers un autre groupe ou sous-projet.
 */
export default function EquipmentTab({ d }: { d: ProjectData }) {
  const [showCat, setShowCat] = useState(() => { try { return localStorage.getItem('fab.catalogue') !== '0'; } catch { return true; } });
  const [qty, setQty] = useState(1);
  const [target, setTarget] = useState<DropTarget | null>(d.subs[0] ? { subId: d.subs[0].id } : null);
  const toggle = () => { setShowCat(!showCat); try { localStorage.setItem('fab.catalogue', showCat ? '0' : '1'); } catch { /* sans stockage */ } };

  /** dépôt d'un article du catalogue ou d'une ligne existante dans un groupe */
  const drop = async (t: DropTarget, e: React.DragEvent) => {
    const sp = d.subs.find((x) => x.id === t.subId);
    if (!sp) return;
    const eqId = e.dataTransfer.getData(EQ_MIME);
    const lineId = e.dataTransfer.getData(LINE_MIME);
    if (eqId) await addEquipmentToSub(sp, d.av.equipment, d.lines.filter((l) => l.subprojectId === sp.id), { [eqId]: qty || 1 }, t.groupId, d.client?.discounts?.equipment || 0);
    else if (lineId) await moveLine(d, lineId, t);
    setTarget(t);
  };
  const addTo = async (eqId: string) => {
    const sp = d.subs.find((x) => x.id === target?.subId) || d.subs[0];
    if (!sp) return;
    await addEquipmentToSub(sp, d.av.equipment, d.lines.filter((l) => l.subprojectId === sp.id), { [eqId]: qty || 1 }, target?.subId === sp.id ? target.groupId : undefined, d.client?.discounts?.equipment || 0);
  };
  const targetLabel = (() => {
    const sp = d.subs.find((x) => x.id === target?.subId);
    if (!sp) return '';
    const g = sp.groups?.find((x) => x.id === target?.groupId);
    return `${sp.name}${g ? ` · ${g.name}` : ''}`;
  })();

  return (
    <>
      <div className="info" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ flex: 1, minWidth: 260 }}>
          Organise le matériel en <strong>groupes</strong> (par type : son, lumière… ; par emplacement : scène, bar… ; ou par jour).
          <strong> Glisse</strong> un article du catalogue vers un groupe, ou une ligne (⠿) vers un autre groupe ou sous-projet.
        </span>
        <button className="secondary small" onClick={toggle}>{showCat ? 'Masquer le catalogue' : 'Afficher le catalogue'}</button>
      </div>
      <div className={'eq-layout' + (showCat ? ' with-cat' : '')}>
        <div className="eq-main">
          {d.subs.map((sp) => <RoomEquipment key={sp.id} d={d} sp={sp} onDrop={drop} target={target} setTarget={setTarget} />)}
        </div>
        {showCat && <Catalogue d={d} qty={qty} setQty={setQty} targetLabel={targetLabel} onAdd={addTo} />}
      </div>
    </>
  );
}

/** Déplace une ligne (et ses accessoires) vers un autre groupe, éventuellement d'un autre sous-projet. */
async function moveLine(d: ProjectData, lineId: string, t: DropTarget) {
  const line = d.lines.find((l) => l.id === lineId);
  if (!line || line.parentLineId) return;
  const changes: Partial<EquipmentLine> = { subprojectId: t.subId, groupId: t.groupId };
  // un horaire propre ne vaut que dans son sous-projet
  if (t.subId !== line.subprojectId) Object.assign(changes, { periodIds: undefined, order: d.lines.filter((l) => l.subprojectId === t.subId).length });
  await patch(db.lines, line.id, changes);
  for (const c of d.lines.filter((x) => x.parentLineId === line.id)) await patch(db.lines, c.id, changes);
}

/** Catalogue latéral : recherche, catégories, disponibilité, articles à glisser. */
function Catalogue({ d, qty, setQty, targetLabel, onAdd }: { d: ProjectData; qty: number; setQty: (n: number) => void; targetLabel: string; onAdd: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const [b0, b1] = d.subs.length ? [d.subs.map((x) => blockPeriod(x)[0]).sort()[0], d.subs.map((x) => blockPeriod(x)[1]).sort().slice(-1)[0]] : [d.project.start, d.project.end];
  const list = d.av.equipment
    .filter((e) => !e.archived && (!cat || e.categoryId === cat) && [e.name, e.code, e.barcode, ...(e.tags || [])].join(' ').toLowerCase().includes(q.toLowerCase()))
    .slice(0, 200);
  return (
    <aside className="eq-catalogue card">
      <h3 style={{ marginTop: 0 }}>Catalogue</h3>
      <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher dans le catalogue" />
      <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ marginTop: 6 }}>
        <option value="">Toutes catégories</option>
        {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <label className="check-row" style={{ marginTop: 6 }}>Quantité déposée <NumInput className="w-qty" value={qty} onChange={setQty} aria-label="Quantité déposée" /></label>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>Glisse vers un groupe, ou « + » pour ajouter à : <strong>{targetLabel || '—'}</strong>. Dispo sur la durée du projet.</p>
      <div className="eq-cat-list">
        {list.map((e) => {
          const avail = availableQty(e, d.av.equipment, d.av.res, b0, b1, undefined, d.depot);
          return (
            <div key={e.id} className="eq-cat-item" draggable
              onDragStart={(ev) => { ev.dataTransfer.setData(EQ_MIME, e.id); ev.dataTransfer.effectAllowed = 'copy'; }}>
              {e.photo ? <img src={e.photo} alt="" className="thumb" /> : <span className="drag-handle" aria-hidden>⠿</span>}
              <span style={{ flex: 1, minWidth: 0 }}>{e.name}{e.isKit && <span className="badge" style={{ marginLeft: 4 }}>Kit</span>}<span className="muted" style={{ display: 'block', fontSize: 11 }}>{e.code} · {money(e.dailyPrice)}{e.kind === 'vente' ? '' : '/j'}</span></span>
              <span className={'avail ' + (avail > 0 ? 'ok' : 'ko')} title="Disponible">{avail}</span>
              <button className="ghost small" aria-label={`Ajouter ${e.name}`} onClick={() => onAdd(e.id)}>+</button>
            </div>
          );
        })}
        {list.length === 0 && <p className="muted">Aucun article.</p>}
      </div>
    </aside>
  );
}

function RoomEquipment({ d, sp, onDrop, target, setTarget }: { d: ProjectData; sp: Subproject; onDrop: (t: DropTarget, e: React.DragEvent) => void; target: DropTarget | null; setTarget: (t: DropTarget) => void }) {
  const [over, setOver] = useState<string | null>(null);
  const nav = useNavigate();
  const { settings, av, eqMap } = d;
  const [picking, setPicking] = useState<string | null | undefined>(undefined);
  const [editGroup, setEditGroup] = useState<Partial<EquipGroup> | null>(null);
  const [editLine, setEditLine] = useState<EquipmentLine | null>(null);
  const lines = d.lines.filter((l) => l.subprojectId === sp.id).sort((a, b) => a.order - b.order);
  const groups = sp.groups || [];
  const periods = sortPeriods(sp.periods || []);
  const weight = lines.reduce((a, l) => a + (l.equipmentId && !l.optional ? (eqMap.get(l.equipmentId)?.weight || 0) * l.qty : 0), 0);
  const total = round2(lines.filter((l) => !l.optional).reduce((a, l) => a + lineTotal(l, lineDays(l, sp), settings, isPerPiece(l, eqMap)), 0));

  const updLine = async (l: EquipmentLine, changes: Partial<EquipmentLine>) => {
    await patch(db.lines, l.id, changes);
    const children = lines.filter((c) => c.parentLineId === l.id);
    // les accessoires suivent la quantité et le groupe de leur ligne
    if (changes.qty !== undefined && l.equipmentId) {
      const acc = eqMap.get(l.equipmentId)?.accessories || [];
      for (const c of children) {
        const a = acc.find((x) => x.equipmentId === c.equipmentId);
        if (a) await save(db.lines, { ...c, qty: a.qty * changes.qty });
      }
    }
    if ('groupId' in changes) for (const c of children) await save(db.lines, { ...c, groupId: changes.groupId });
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
          // la zone « Sans groupe » reste visible pour pouvoir y déposer
          const ordered = gl.filter((l) => !l.parentLineId || !gl.some((x) => x.id === l.parentLineId)).flatMap((l) => [l, ...gl.filter((c) => c.parentLineId === l.id)]);
          const gp = group?.periodIds.length ? periods.filter((p) => group.periodIds.includes(p.id)) : [];
          return (
            <div key={group?.id || 'none'} data-group={group?.name || 'Sans groupe'}
              className={'eq-group drop-zone' + (over === (group?.id || 'none') ? ' drop-on' : '') + (target?.subId === sp.id && (target.groupId || undefined) === group?.id ? ' drop-target' : '')}
              onClick={() => setTarget({ subId: sp.id, groupId: group?.id })}
              onDragOver={(e) => { if (e.dataTransfer.types.includes(EQ_MIME) || e.dataTransfer.types.includes(LINE_MIME)) { e.preventDefault(); setOver(group?.id || 'none'); } }}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(null); }}
              onDrop={(e) => { e.preventDefault(); setOver(null); onDrop({ subId: sp.id, groupId: group?.id }, e); }}>
              <div className="eq-group-head">
                <strong>{group ? group.name : groups.length ? 'Sans groupe' : 'Matériel'}</strong>
                <span className="muted">{gp.length ? gp.map((p) => p.name).join(', ') : 'tout le sous-projet'}{gl[0] && ` · ${lineDays(gl[0], sp)} j facturé(s)`}</span>
                {group && <button className="ghost small" onClick={() => setEditGroup(group)}>Modifier</button>}
                <span style={{ flex: 1 }} />
                <button className="small" onClick={() => setPicking(group?.id ?? null)}>+ Matériel</button>
                <button className="secondary small" onClick={() => save(db.lines, { projectId: sp.projectId, subprojectId: sp.id, groupId: group?.id, name: 'Prestation', qty: 1, unitPrice: 0, discount: 0, order: lines.length })}>+ Ligne libre</button>
              </div>
              {ordered.length === 0 && <div className="drop-hint">Glisse du matériel ici</div>}
              {ordered.length > 0 && (
                <div className="table-wrap">
                  <table className="list">
                    <thead><tr><th aria-label="Déplacer" /><th>Qté</th><th>Désignation</th><th className="n">Dispo</th><th>P.U.</th><th>Remise %</th><th title="Ligne facultative proposée en option sur le devis">Option</th>{groups.length > 0 && <th>Groupe</th>}<th className="n">Total HT</th><th /></tr></thead>
                    <tbody>
                      {ordered.map((l) => {
                        const eq = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
                        const [b0, b1] = lineBlock(l, sp);
                        const avail = eq ? availableQty(eq, av.equipment, av.res, b0, b1, l.id, d.depot) : null;
                        const perPiece = isPerPiece(l, eqMap);
                        return (
                          <tr key={l.id} style={l.optional ? { opacity: 0.6 } : undefined} draggable={!l.parentLineId}
                            onDragStart={(e) => { e.dataTransfer.setData(LINE_MIME, l.id); e.dataTransfer.effectAllowed = 'move'; }}>
                            <td className="drag-handle" title={l.parentLineId ? 'Accessoire : suit son article' : 'Glisser vers un autre groupe ou sous-projet'}>{l.parentLineId ? '' : '⠿'}</td>
                            <td><NumInput className="w-qty" step="1" min={0} value={l.qty} onChange={(n) => updLine(l, { qty: n })} /></td>
                            <td style={l.parentLineId ? { paddingLeft: 24 } : undefined}>
                              {l.parentLineId && <span className="muted">↳ </span>}
                              {eq ? <Link to={'/materiel/' + eq.id}>{l.name}</Link> : <input value={l.name} onChange={(e) => updLine(l, { name: e.target.value })} />}
                              {perPiece && <span className="badge" style={{ marginLeft: 6 }}>vente</span>}
                              {l.periodIds?.length ? <div className="muted" style={{ fontSize: 11 }}>🕑 {periods.filter((p) => l.periodIds!.includes(p.id)).map((p) => p.name).join(', ')} · {fmtRange(b0, b1)}</div> : null}
                              {l.remark && <div className="muted" style={{ fontSize: 11 }}>Devis : {l.remark}</div>}
                              {l.internalRemark && <div className="muted" style={{ fontSize: 11 }}>Entrepôt : {l.internalRemark}</div>}
                            {eq && avail !== null && avail < l.qty && !l.optional && (eq.alternatives || []).map((altId) => {
                              const alt = eqMap.get(altId);
                              if (!alt || alt.archived) return null;
                              const altAvail = availableQty(alt, av.equipment, av.res, b0, b1, undefined, d.depot);
                              const n = Math.min(l.qty - Math.max(0, avail), altAvail);
                              return n > 0 ? (
                                <div key={altId}>
                                  <button className="secondary small alt-btn" title={`${altAvail} disponible(s)`} onClick={async () => {
                                    await updLine(l, { qty: l.qty - n });
                                    await addEquipmentToSub(sp, av.equipment, lines, { [altId]: n }, l.groupId, l.discount);
                                  }}>↔ Remplacer {n} par {alt.name}</button>
                                </div>
                              ) : null;
                            })}
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
                            <td className="nowrap">
                              <button className="ghost" onClick={() => setEditLine(l)} title="Horaire propre et remarques" aria-label="Détails de la ligne">⋯</button>
                              <button className="ghost" onClick={() => removeLine(l)} aria-label="Retirer">✕</button>
                            </td>
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
        <EquipmentPicker sp={sp} groupId={picking || undefined} depot={d.depot} discount={d.client?.discounts?.equipment || 0} equipment={av.equipment} res={av.res} existing={lines} onClose={() => setPicking(undefined)} />
      )}
      {editGroup && <GroupModal sp={sp} group={editGroup} onClose={() => setEditGroup(null)} />}
      {editLine && <LineModal sp={sp} line={editLine} accessories={lines.filter((c) => c.parentLineId === editLine.id)} onClose={() => setEditLine(null)} />}
    </div>
  );
}

/** Détails d'une ligne : horaire propre (créneaux) et remarques pour le client ou l'entrepôt. */
function LineModal({ sp, line, accessories, onClose }: { sp: Subproject; line: EquipmentLine; accessories: EquipmentLine[]; onClose: () => void }) {
  const periods = sortPeriods(sp.periods || []);
  const [l, setL] = useState(line);
  const groupName = sp.groups?.find((g) => g.id === line.groupId)?.name;
  return (
    <Modal title={`Ligne — ${line.name}`} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const periodIds = l.periodIds?.length ? l.periodIds : undefined;
        await patch(db.lines, line.id, { periodIds, remark: l.remark?.trim() || undefined, internalRemark: l.internalRemark?.trim() || undefined });
        // les accessoires suivent l'horaire de leur article
        for (const c of accessories) await patch(db.lines, c.id, { periodIds });
        onClose();
      }}>
        <div className="field full">
          <span>Horaire propre à la ligne</span>
          {periods.length === 0 ? <p className="muted" style={{ margin: 0 }}>Ajoute des créneaux au sous-projet (onglet Planning) pour donner un horaire propre à cet article.</p> : (
            <>
              {periods.map((p) => (
                <label key={p.id} className="check-row">
                  <input type="checkbox" checked={(l.periodIds || []).includes(p.id)}
                    onChange={(e) => setL({ ...l, periodIds: e.target.checked ? [...(l.periodIds || []), p.id] : (l.periodIds || []).filter((x) => x !== p.id) })} />
                  {p.name} <span className="muted">{fmtRange(p.start, p.end)}</span>
                </label>
              ))}
              <p className="muted" style={{ margin: '4px 0 0' }}>
                Aucun coché = horaire {groupName ? `du groupe « ${groupName} »` : 'du sous-projet'}. L'article n'est bloqué et facturé que sur les créneaux cochés :
                il reste disponible pour un autre projet le reste du temps.
              </p>
            </>
          )}
        </div>
        <Field label="Remarque pour le client (devis, facture)" full><input value={l.remark || ''} onChange={(e) => setL({ ...l, remark: e.target.value })} placeholder="ex. livré monté sur pied" /></Field>
        <Field label="Remarque pour l'entrepôt (bon de sortie)" full><input value={l.internalRemark || ''} onChange={(e) => setL({ ...l, internalRemark: e.target.value })} placeholder="ex. prendre les câbles neufs" /></Field>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </Modal>
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
          {periods.length === 0 ? <p className="muted" style={{ margin: 0 }}>Ce sous-projet n'a pas de créneaux détaillés : le groupe couvre tout le sous-projet.</p> : (
            <>
              {periods.map((p) => (
                <label key={p.id} className="check-row">
                  <input type="checkbox" checked={(g.periodIds || []).includes(p.id)}
                    onChange={(e) => setG({ ...g, periodIds: e.target.checked ? [...(g.periodIds || []), p.id] : (g.periodIds || []).filter((x) => x !== p.id) })} />
                  {p.name} <span className="muted">{fmtRange(p.start, p.end)}</span>
                </label>
              ))}
              <p className="muted" style={{ margin: '4px 0 0' }}>Aucun coché = tout le sous-projet (du premier au dernier créneau).</p>
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
export async function addEquipmentToSub(sp: Subproject, equipment: Equipment[], existing: EquipmentLine[], items: Record<string, number>, groupId?: string, discount = 0) {
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
      await db.lines.put({ id: lineId, createdAt: t, updatedAt: t, projectId: sp.projectId, subprojectId: sp.id, groupId, equipmentId: eqId, name: eq.name, qty: n, unitPrice: eq.dailyPrice, discount, order: order++ });
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

function EquipmentPicker({ sp, groupId, depot, discount, equipment, res, existing, onClose }: { sp: Subproject; groupId?: string; depot?: string; discount: number; equipment: Equipment[]; res: Reservation[]; existing: EquipmentLine[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const units = useLiveQuery(() => db.units.toArray(), []) || [];
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const [bStart, bEnd] = lineBlock({ groupId }, sp);
  const groupName = sp.groups?.find((g) => g.id === groupId)?.name;
  const list = equipment.filter((e) => !e.archived && [e.name, e.code, e.barcode, e.categoryId && catName.get(e.categoryId)].join(' ').toLowerCase().includes(q.toLowerCase()));
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
                    <td>{e.photo && <img src={e.photo} alt="" className="thumb" />}{e.name} {e.isKit && <span className="badge">Kit</span>} {e.kind === 'vente' && <span className="badge">vente</span>} <span className="muted">{e.code}</span>
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
        <button disabled={!count} onClick={async () => { await addEquipmentToSub(sp, equipment, existing, qty, groupId, discount); onClose(); }}>Ajouter {count > 0 ? `(${count})` : ''}</button>
      </div>
    </Modal>
  );
}
