import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, StatusBadge } from '../../components/ui';
import { db } from '../../db';
import type { EquipGroup, Equipment, EquipmentLine, Subproject } from '../../types';
import { availableQty, blockPeriod, inDepot, stockAt, confirmDeleteSubproject, factorFor, fmtRange, lineBlock, lineDays, lineTotal, money, nowIso, round2, save, sortPeriods, uid, type Reservation, patch } from '../../utils';
import { isPerPiece, type ProjectData } from './shared';
import { codeFromScan, findByCode } from '../../codes';
import { Icon } from '../../components/Icon';
import { CategoryOptions } from '../../components/CategoryOptions';
import { UsageBreakdown, UseChips, projectUses, type OtherUse } from '../../components/Reservations';
import { NO_CATEGORY, categoryLabel, inCategory, mainCategories, subCategories, topCategory } from '../../categories';

const EQ_MIME = 'application/x-fabevent-equipment';
const LINE_MIME = 'application/x-fabevent-line';

/** Cible du glisser-déposer (ou du bouton « + » du catalogue sur tablette) : un groupe d'un sous-projet. */
export interface DropTarget { subId: string; groupId?: string }

/**
 * Onglet Équipement : le matériel de chaque sous-projet, organisé en groupes rattachés à des créneaux.
 * Le catalogue à droite se glisse-dépose dans un groupe ; une ligne se glisse vers un autre groupe ou sous-projet.
 */
export default function EquipmentTab({ d }: { d: ProjectData }) {
  // sur téléphone, le catalogue est replié par défaut : la saisie rapide le remplace
  const [showCat, setShowCat] = useState(() => { try { const v = localStorage.getItem('fab.catalogue'); return v === null ? window.innerWidth > 900 : v !== '0'; } catch { return true; } });
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
    .filter((e) => !e.archived && !e.accessoryOnly && inCategory(cats, e.categoryId, cat) && [e.name, e.code, e.barcode, ...(e.tags || [])].join(' ').toLowerCase().includes(q.toLowerCase()))
    .slice(0, 200);
  return (
    <aside className="eq-catalogue card">
      <h3 style={{ marginTop: 0 }}>Catalogue</h3>
      <input placeholder="Rechercher…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Rechercher dans le catalogue" />
      <select value={cat} onChange={(e) => setCat(e.target.value)} style={{ marginTop: 6 }}>
        <option value="">Toutes catégories</option>
        <CategoryOptions cats={cats} filter />
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
  const [pickQ, setPickQ] = useState('');
  const [editGroup, setEditGroup] = useState<Partial<EquipGroup> | null>(null);
  const [editLine, setEditLine] = useState<EquipmentLine | null>(null);
  const [usesOf, setUsesOf] = useState<{ eq: Equipment; uses: OtherUse[]; name: string; range: string; stock: number; here?: number; avail: number } | null>(null);
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
          <button className="ghost small" title="Supprimer ce sous-projet" aria-label={`Supprimer le sous-projet ${sp.name}`} onClick={() => confirmDeleteSubproject(sp)}><Icon name="trash" /></button>
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
                <button className="small" onClick={() => { setPickQ(''); setPicking(group?.id ?? null); }}>+ Matériel</button>
                <button className="secondary small" onClick={() => save(db.lines, { projectId: sp.projectId, subprojectId: sp.id, groupId: group?.id, name: 'Prestation', qty: 1, unitPrice: 0, discount: 0, order: lines.length })}>+ Ligne libre</button>
              </div>
              {ordered.length === 0 && <div className="drop-hint">Glisse du matériel ici, ou tape-le ci-dessous</div>}
              {ordered.length > 0 && (
                <div className="table-wrap">
                  <table className="list eq-table">
                    <thead><tr><th aria-label="Déplacer" /><th>Qté</th><th>Désignation</th><th className="n" title="Stock disponible restant sur la période, après cette ligne">Reste</th><th className="hide-sm">P.U.</th><th className="hide-sm">Rem. %</th><th className="n">Total HT</th><th /></tr></thead>
                    <tbody>
                      {ordered.map((l) => {
                        const eq = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
                        const [b0, b1] = lineBlock(l, sp);
                        const avail = eq && !eq.accessoryOnly ? availableQty(eq, av.equipment, av.res, b0, b1, l.id, d.depot) : null;
                        const perPiece = isPerPiece(l, eqMap);
                        return (
                          <tr key={l.id} style={l.optional ? { opacity: 0.6 } : undefined} draggable={!l.parentLineId}
                            onDragStart={(e) => { e.dataTransfer.setData(LINE_MIME, l.id); e.dataTransfer.effectAllowed = 'move'; }}>
                            <td className="drag-handle" title={l.parentLineId ? 'Accessoire : suit son article' : 'Glisser vers un autre groupe ou sous-projet'}>{l.parentLineId ? '' : '⠿'}</td>
                            <td><NumInput className="w-qty" step="1" min={0} value={l.qty} onChange={(n) => updLine(l, { qty: n })} /></td>
                            <td style={l.parentLineId ? { paddingLeft: 24 } : undefined}>
                              {l.parentLineId && <Icon name="corner" className="muted" />}
                              {eq ? <Link to={'/materiel/' + eq.id}>{l.name}</Link> : <input value={l.name} onChange={(e) => updLine(l, { name: e.target.value })} />}
                              {eq?.code && <span className="muted eq-code"> {eq.code}</span>}
                              {perPiece && <span className="badge" style={{ marginLeft: 6 }}>vente</span>}
                              {l.optional && <span className="badge st-option" style={{ marginLeft: 6 }}>option</span>}
                              {l.periodIds?.length ? <div className="muted eq-sub" style={{ fontSize: 11 }}><Icon name="clock" />{periods.filter((p) => l.periodIds!.includes(p.id)).map((p) => p.name).join(', ')} · {fmtRange(b0, b1)}</div> : null}
                              {l.remark && <div className="muted eq-sub" style={{ fontSize: 11 }}>Devis : {l.remark}</div>}
                              {l.internalRemark && <div className="muted eq-sub" style={{ fontSize: 11 }}>Entrepôt : {l.internalRemark}</div>}
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
                                  }}><Icon name="swap" />Remplacer {n} par {alt.name}</button>
                                </div>
                              ) : null;
                            })}
                            </td>
                            <td className="n eq-avail">{avail === null || !eq ? '—' : (() => {
                              const left = l.optional ? avail : avail - l.qty;
                              const uses = projectUses(eq, av.equipment, av.res, b0, b1, { projectId: sp.projectId, subprojectId: sp.id, lineId: l.id, depot: d.depot });
                              return (
                                <>
                                  <span className={'avail ' + (left >= 0 ? 'ok' : 'ko')} title={`Disponible ${avail} sur la période ; ${l.optional ? 'option : non décomptée' : `reste ${left} après cette ligne`}`}>
                                    <span className="show-sm">reste </span>{left >= 0 ? left : `manque ${-left}`}
                                  </span>
                                  <UseChips uses={uses} label={l.name} onOpen={() => setUsesOf({ eq, uses, name: l.name, range: fmtRange(b0, b1), stock: stockAt(eq, d.depot, av.res), here: l.optional ? undefined : l.qty, avail: left })} />
                                </>
                              );
                            })()}</td>
                            <td className="hide-sm"><NumInput className="w-price" value={l.unitPrice} onChange={(n) => updLine(l, { unitPrice: n })} aria-label="Prix unitaire" /></td>
                            <td className="hide-sm"><NumInput className="w-qty" value={l.discount} onChange={(n) => updLine(l, { discount: n })} aria-label="Remise" /></td>
                            <td className="n">{money(lineTotal(l, lineDays(l, sp), settings, perPiece))}</td>
                            <td className="nowrap">
                              <button className="ghost" onClick={() => setEditLine(l)} title="Prix, option, groupe, horaire propre et remarques" aria-label="Détails de la ligne"><Icon name="more" /></button>
                              <button className="ghost" onClick={() => removeLine(l)} aria-label="Retirer"><Icon name="x" /></button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <QuickAdd onBrowse={(q) => { setPickQ(q); setPicking(group?.id ?? null); }} equipment={av.equipment} units={av.units} availOf={(e) => { const [b0, b1] = lineBlock({ groupId: group?.id }, sp); return availableQty(e, av.equipment, av.res, b0, b1, undefined, d.depot); }}
                onAdd={(eqId, n) => addEquipmentToSub(sp, av.equipment, lines, { [eqId]: n }, group?.id, d.client?.discounts?.equipment || 0)} />
            </div>
          );
        })}
        <p className="muted" style={{ marginBottom: 0 }}>Coefficient de durée : {lineDays({}, sp)} j → ×{factorFor(lineDays({}, sp), settings)} (hors groupes rattachés à des créneaux).</p>
      </div>
      {picking !== undefined && (
        <EquipmentPicker sp={sp} groupId={picking || undefined} initialQ={pickQ} depot={d.depot} depots={av.depots} discount={d.client?.discounts?.equipment || 0} equipment={av.equipment} res={av.res} existing={lines} onClose={() => setPicking(undefined)} />
      )}
      {editGroup && <GroupModal sp={sp} group={editGroup} onClose={() => setEditGroup(null)} />}
      {usesOf && (
        <Modal title={`${usesOf.name} : où est le matériel ?`} onClose={() => setUsesOf(null)}>
          <p className="muted" style={{ marginTop: 0 }}>Du {usesOf.range} : dans ce projet, en option ou réservé dans d'autres projets, en réparation ou en transfert.</p>
          <UsageBreakdown eq={usesOf.eq} uses={usesOf.uses} stock={usesOf.stock} here={usesOf.here} avail={usesOf.avail} />
        </Modal>
      )}
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
    <Modal title={`Ligne — ${line.name}`} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        const periodIds = l.periodIds?.length ? l.periodIds : undefined;
        await patch(db.lines, line.id, { periodIds, remark: l.remark?.trim() || undefined, internalRemark: l.internalRemark?.trim() || undefined, unitPrice: l.unitPrice, discount: l.discount, optional: l.optional || undefined, groupId: l.groupId || undefined });
        if (l.groupId !== line.groupId) for (const c of accessories) await patch(db.lines, c.id, { groupId: l.groupId || undefined });
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
        <Field label="Prix unitaire HT"><NumInput value={l.unitPrice} onChange={(n) => setL({ ...l, unitPrice: n })} /></Field>
        <Field label="Remise %"><NumInput value={l.discount} onChange={(n) => setL({ ...l, discount: n })} /></Field>
        {(sp.groups || []).length > 0 && !line.parentLineId && (
          <Field label="Groupe">
            <select value={l.groupId || ''} onChange={(e) => setL({ ...l, groupId: e.target.value || undefined })}>
              <option value="">Sans groupe</option>
              {(sp.groups || []).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </Field>
        )}
        <Field label=" "><label className="check-row"><input type="checkbox" checked={!!l.optional} onChange={(e) => setL({ ...l, optional: e.target.checked })} /> En option sur le devis (hors total)</label></Field>
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

/**
 * Fenêtre « + Matériel » : chercher, filtrer (catégorie, disponible, étiquette), mettre des quantités
 * avec − / + (ou un clic sur la ligne = +1), voir la sélection, puis ajouter (et continuer si besoin).
 */
function EquipmentPicker({ sp, groupId, initialQ = '', depot, depots = [], discount, equipment, res, existing, onClose }: { sp: Subproject; groupId?: string; initialQ?: string; depot?: string; depots?: { id: string; name: string }[]; discount: number; equipment: Equipment[]; res: Reservation[]; existing: EquipmentLine[]; onClose: () => void }) {
  const [q, setQ] = useState(initialQ);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [cat, setCat] = useState('');
  const [onlyAvail, setOnlyAvail] = useState(false);
  const [tag, setTag] = useState('');
  const [sort, setSort] = useState<'nom' | 'dispo' | 'prix'>('nom');
  const [target, setTarget] = useState(groupId || '');
  const [added, setAdded] = useState('');
  const [openUses, setOpenUses] = useState('');
  /** dépôt filtré : seulement le matériel qui s'y trouve, dispo calculée dans ce dépôt */
  const [where, setWhere] = useState('');
  const cats = useLiveQuery(() => db.categories.orderBy('name').toArray(), []) || [];
  const units = useLiveQuery(() => db.units.toArray(), []) || [];
  const catName = new Map(cats.map((c) => [c.id, categoryLabel(cats, c.id)]));
  const [bStart, bEnd] = lineBlock({ groupId: target || undefined }, sp);
  const groups = sp.groups || [];
  const avail = new Map(equipment.map((e) => [e.id, availableQty(e, equipment, res, bStart, bEnd, undefined, where || depot)]));
  const inProject = new Map<string, number>();
  for (const l of existing) if (l.equipmentId && !l.parentLineId) inProject.set(l.equipmentId, (inProject.get(l.equipmentId) || 0) + l.qty);
  const tags = Array.from(new Set(equipment.flatMap((e) => e.tags || []))).sort();
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const base = equipment.filter((e) => !e.archived && !e.accessoryOnly && inDepot(e, where, depots, res) && words.every((w) => [e.name, e.code, e.barcode, ...(e.extraCodes || []), e.categoryId && catName.get(e.categoryId), ...(e.tags || [])].join(' ').toLowerCase().includes(w)));
  const list = base
    .filter((e) => inCategory(cats, e.categoryId, cat) && (!tag || e.tags?.includes(tag)) && (!onlyAvail || (avail.get(e.id) || 0) > 0))
    .sort((a, b) => sort === 'dispo' ? (avail.get(b.id) || 0) - (avail.get(a.id) || 0) : sort === 'prix' ? a.dailyPrice - b.dailyPrice : a.name.localeCompare(b.name));
  const selected = equipment.filter((e) => (qty[e.id] || 0) > 0);
  const count = selected.reduce((a, e) => a + (qty[e.id] || 0), 0);
  const bump = (id: string, d: number) => setQty((x) => ({ ...x, [id]: Math.max(0, (x[id] || 0) + d) }));
  const commit = async (close: boolean) => {
    await addEquipmentToSub(sp, equipment, existing, qty, target || undefined, discount);
    if (close) return onClose();
    setAdded(`${count} article(s) ajouté(s)`);
    setQty({});
  };

  return (
    <Modal title={`Ajouter du matériel — ${sp.name}`} onClose={onClose} wide>
      <div className="picker">
        <div className="picker-filters">
          <input autoFocus placeholder="Rechercher (nom, code, étiquette) ou scanner…" value={q} aria-label="Rechercher du matériel"
            onChange={(e) => { setQ(e.target.value); setAdded(''); }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              const hit = findByCode(q, equipment, units)?.equipment || (list.length === 1 ? list[0] : undefined);
              if (hit) { bump(hit.id, 1); setQ(''); }
            }} />
          <div className="chips">
            <button type="button" className={'chip' + (!cat ? ' on' : '')} onClick={() => setCat('')}>Tout ({base.length})</button>
            {mainCategories(cats, true).map((c) => {
              const n = base.filter((e) => inCategory(cats, e.categoryId, c.id)).length;
              const on = !!cat && inCategory(cats, cat, c.id);
              return n ? <button type="button" key={c.id} className={'chip' + (on ? ' on' : '')} onClick={() => setCat(cat === c.id ? '' : c.id)}>{c.name} ({n})</button> : null;
            })}
            {(() => { const n = base.filter((e) => inCategory(cats, e.categoryId, NO_CATEGORY)).length; return n ? <button type="button" className={'chip' + (cat === NO_CATEGORY ? ' on' : '')} onClick={() => setCat(cat === NO_CATEGORY ? '' : NO_CATEGORY)}>Sans catégorie ({n})</button> : null; })()}
          </div>
          {(() => {
            // sous-catégories de la catégorie choisie
            const parentId = cat === NO_CATEGORY ? undefined : topCategory(cats, cat)?.id;
            const subs = parentId ? subCategories(cats, parentId, true) : [];
            if (!subs.length) return null;
            return (
              <div className="chips sub-chips" aria-label="Sous-catégories">
                {subs.map((c) => {
                  const n = base.filter((e) => inCategory(cats, e.categoryId, c.id)).length;
                  return n ? <button type="button" key={c.id} className={'chip' + (cat === c.id ? ' on' : '')} onClick={() => setCat(cat === c.id ? parentId! : c.id)}>{c.name} ({n})</button> : null;
                })}
              </div>
            );
          })()}
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <label className="check-row"><input type="checkbox" checked={onlyAvail} onChange={(e) => setOnlyAvail(e.target.checked)} /> Disponibles seulement</label>
            {tags.length > 0 && (
              <select value={tag} onChange={(e) => setTag(e.target.value)} style={{ width: 'auto' }} aria-label="Étiquette">
                <option value="">Toutes étiquettes</option>
                {tags.map((t) => <option key={t}>{t}</option>)}
              </select>
            )}
            {depots.length > 1 && (
              <select value={where} onChange={(e) => setWhere(e.target.value)} style={{ width: 'auto' }} aria-label="Filtrer par dépôt">
                <option value="">Tous les dépôts</option>
                {depots.map((dp) => <option key={dp.id} value={dp.id}>{dp.id === depot ? `${dp.name} (dépôt du projet)` : dp.name}</option>)}
              </select>
            )}
            <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} style={{ width: 'auto' }} aria-label="Trier">
              <option value="nom">Trier par nom</option><option value="dispo">Plus disponibles d'abord</option><option value="prix">Prix croissant</option>
            </select>
            {groups.length > 0 && (
              <select value={target} onChange={(e) => setTarget(e.target.value)} style={{ width: 'auto' }} aria-label="Groupe de destination">
                <option value="">→ Sans groupe</option>
                {groups.map((g) => <option key={g.id} value={g.id}>→ {g.name}</option>)}
              </select>
            )}
            <span className="muted" style={{ fontSize: 12 }}>Dispo du {fmtRange(bStart, bEnd)}</span>
          </div>
        </div>
        <div className="pick-list">
          {list.length === 0 ? <Empty>Aucun article.</Empty> : list.map((e) => {
            const a = avail.get(e.id) || 0, n = qty[e.id] || 0;
            const uses = projectUses(e, equipment, res, bStart, bEnd, { projectId: sp.projectId, subprojectId: sp.id, depot: where || depot });
            return (
              <div key={e.id} className="pick-item">
              <div className={'pick-row' + (n ? ' on' : '')} onClick={(ev) => { if (!(ev.target as HTMLElement).closest('input,button,a')) bump(e.id, 1); }} title="Clic : +1">
                {e.photo ? <img src={e.photo} alt="" className="thumb" /> : <span className="thumb" />}
                <div className="pick-name">
                  <div><strong>{e.name}</strong> {e.isKit && <span className="badge">Kit</span>} {e.kind === 'vente' && <span className="badge">vente</span>}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{[e.code, e.categoryId && catName.get(e.categoryId), inProject.get(e.id) ? `déjà ${inProject.get(e.id)} dans le projet` : '', e.contents?.length ? `avec ${e.contents.map((c) => c.name).join(', ')}` : ''].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="pick-stock">
                  <span className={'avail ' + (a - n >= 0 ? 'ok' : 'ko')} title={n ? `Disponible ${a}, reste ${a - n} après cet ajout` : 'Disponible sur la période'}>
                    {n ? (a - n >= 0 ? `reste ${a - n}` : `manque ${n - a}`) : `${a} dispo`}
                  </span>
                  <UseChips uses={uses} label={e.name} onOpen={() => setOpenUses(openUses === e.id ? '' : e.id)} />
                </div>
                <span className="muted pick-price">{money(e.dailyPrice)}{e.kind === 'vente' ? '' : '/j'}</span>
                <div className="stepper">
                  <button type="button" className="ghost" aria-label={`Moins ${e.name}`} disabled={!n} onClick={() => bump(e.id, -1)}>−</button>
                  <NumInput className="w-qty" value={n} placeholder="0" onChange={(v) => setQty((x) => ({ ...x, [e.id]: v }))} aria-label={`Quantité ${e.name}`} />
                  <button type="button" className="ghost" aria-label={`Plus ${e.name}`} onClick={() => bump(e.id, 1)}>+</button>
                </div>
              </div>
              {openUses === e.id && <div className="pick-uses"><UsageBreakdown eq={e} uses={uses} stock={stockAt(e, where || depot, res)} here={n || undefined} avail={a - n} hereLabel="cet ajout" /></div>}
              </div>
            );
          })}
        </div>
        {selected.length > 0 && (
          <div className="picker-selection">
            <strong>Sélection :</strong> {selected.map((e) => (
              <span key={e.id} className="tag small">{qty[e.id]} × {e.name} <button className="ghost small" aria-label={`Retirer ${e.name}`} onClick={() => setQty((x) => ({ ...x, [e.id]: 0 }))}><Icon name="x" /></button></span>
            ))}
          </div>
        )}
        {added && <div className="flash ok">{added}</div>}
      </div>
      <div className="form-actions" style={{ marginTop: 12, display: 'flex' }}>
        <button className="secondary" onClick={onClose}>Fermer</button>
        <button className="secondary" disabled={!count} onClick={() => commit(false)}>Ajouter et continuer</button>
        <button disabled={!count} onClick={() => commit(true)}>Ajouter {count > 0 ? `(${count})` : ''}</button>
      </div>
    </Modal>
  );
}

/**
 * Saisie rapide (comme dans Rentman) : taper un nom ou un code, Entrée ajoute le premier résultat.
 * « 12 sm58 » + Entrée ajoute directement 12 micros ; un code-barres scanné ajoute l'article.
 * Les flèches choisissent un autre résultat ; la quantité peut aussi se mettre dans la petite case.
 */
export function QuickAdd({ equipment, units, availOf, onAdd, onBrowse }: {
  /** ouvre la fenêtre de choix avec filtres (avec le texte déjà tapé) */
  onBrowse?: (q: string) => void;
  equipment: Equipment[]; units: { equipmentId: string; barcode?: string; serial: string; extraCodes?: string[] }[];
  availOf: (e: Equipment) => number; onAdd: (equipmentId: string, n: number) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState(1);
  const [hi, setHi] = useState(0);
  const [msg, setMsg] = useState('');
  const m = q.match(/^\s*(\d+)\s*[x×*]?\s+(.+)$/i);
  const n = m ? parseInt(m[1], 10) : qty || 1;
  const term = (m ? m[2] : q).trim().toLowerCase();
  const words = term.split(/\s+/).filter(Boolean);
  const results = term.length < 1 ? [] : equipment
    .filter((e) => !e.archived && !e.accessoryOnly && words.every((w) => [e.name, e.code, e.barcode, ...(e.extraCodes || [])].join(' ').toLowerCase().includes(w)))
    .sort((a, b) => Number(!(a.code || '').toLowerCase().startsWith(term)) - Number(!(b.code || '').toLowerCase().startsWith(term)) || a.name.localeCompare(b.name))
    .slice(0, 8);
  const add = async (e: Equipment) => {
    await onAdd(e.id, n);
    setMsg(`+${n} × ${e.name}`);
    setQ(''); setQty(1); setHi(0);
  };
  return (
    <div className="quick-add">
      <NumInput className="w-qty" value={qty} onChange={setQty} aria-label="Quantité à ajouter" />
      <div className="quick-add-box">
        <input value={q} placeholder="+ Ajouter… (ex. « 12 sm58 » + Entrée)" aria-label="Ajouter un article"
          onChange={(e) => { setQ(e.target.value); setHi(0); setMsg(''); }}
          onKeyDown={async (e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, results.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Escape') { setQ(''); }
            else if (e.key === 'Enter') {
              e.preventDefault();
              // code-barres scanné : correspondance exacte
              const code = codeFromScan(q).toLowerCase();
              const u = units.find((x) => [x.barcode, x.serial, ...(x.extraCodes || [])].some((c) => c?.toLowerCase() === code));
              const exact = equipment.find((x) => x.id === u?.equipmentId) || equipment.find((x) => [x.barcode, x.code, ...(x.extraCodes || [])].some((c) => c?.toLowerCase() === code));
              const pick = exact || results[hi];
              if (pick) await add(pick);
            }
          }} />
        {results.length > 0 && (
          <ul className="quick-add-list" role="listbox">
            {results.map((e, i) => {
              const a = availOf(e);
              return (
                <li key={e.id} role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''} onMouseDown={(ev) => { ev.preventDefault(); add(e); }}>
                  <span>{e.name} <span className="muted">{e.code}</span></span>
                  <span className={'avail ' + (a >= n ? 'ok' : 'ko')} title="Disponible">{a}</span>
                </li>
              );
            })}
            {onBrowse && <li className="qa-browse" onMouseDown={(ev) => { ev.preventDefault(); onBrowse(term); setQ(''); }}>Voir tous les résultats avec filtres…</li>}
          </ul>
        )}
      </div>
      {onBrowse && <button type="button" className="secondary small" title="Choisir dans une fenêtre avec filtres (catégories, disponibilité, étiquettes)" onClick={() => { onBrowse(term); setQ(''); }}>Filtres…</button>}
      {msg && <span className="avail ok">{msg}</span>}
    </div>
  );
}
