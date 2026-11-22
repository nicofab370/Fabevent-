import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead, StatusBadge } from '../components/ui';
import { nextNumber, unitNo } from '../unitNumbers';
import { useAvailability } from '../data';
import { nextUnitCode } from '../codegen';
import { db } from '../db';
import type { SerialUnit } from '../types';
import { availableQty, stockAt, fmtDate, fmtRange, inspectionsDue, money, save, toLocalInput } from '../utils';
import { EquipmentForm } from './EquipmentList';
import { InspectionModal, RepairModal } from './Maintenance';
import PrintLabelModal from '../components/PrintLabelModal';
import { Icon } from '../components/Icon';

const UNIT_STATUS: Record<SerialUnit['status'], string> = { ok: 'En service', hs: 'Hors service', perdu: 'Perdu / vendu' };

export default function EquipmentDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const raw = useLiveQuery(() => db.equipment.get(id!), [id]);
  const av = useAvailability();
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const inspections = useLiveQuery(() => db.inspections.where({ equipmentId: id! }).reverse().sortBy('date'), [id]) || [];
  const [editing, setEditing] = useState(false);
  const [unitEdit, setUnitEdit] = useState<Partial<SerialUnit> | null>(null);
  const [repair, setRepair] = useState<{ unitId?: string } | null>(null);
  const [inspect, setInspect] = useState<{ unitId?: string } | null>(null);
  const [weekOffset, setWeekOffset] = useState(0);
  /** impression d'étiquette : toutes les unités, ou celles indiquées */
  const [printing, setPrinting] = useState<{ unitIds?: string[] } | null>(null);
  const eq = av.equipment.find((e) => e.id === id);
  if (!raw || !eq) return <p>Chargement…</p>;

  const units = av.units.filter((u) => u.equipmentId === eq.id).sort((a, b) => (a.number || 1e9) - (b.number || 1e9) || a.serial.localeCompare(b.serial));
  const repairs = av.repairs.filter((r) => r.equipmentId === eq.id).sort((a, b) => b.start.localeCompare(a.start));
  const subMap = new Map(av.subs.map((s) => [s.id, s]));
  const projMap = new Map(projects.map((p) => [p.id, p]));
  const allMap = new Map(av.equipment.map((e) => [e.id, e]));
  const usage = av.res.filter((r) => r.equipmentId === eq.id && r.source === 'projet').sort((a, b) => b.start.localeCompare(a.start));
  const usedIn = av.equipment.filter((k) => k.isKit && k.kitItems.some((i) => i.equipmentId === eq.id));
  const due = inspectionsDue([eq], units, inspections);

  // Frise : disponibilité jour par jour sur 28 jours
  const first = new Date();
  first.setHours(0, 0, 0, 0);
  first.setDate(first.getDate() + weekOffset * 7);
  const days = Array.from({ length: 28 }, (_, i) => { const d = new Date(first); d.setDate(first.getDate() + i); return d; });
  const dayAvail = days.map((d) => {
    const s = toLocalInput(d);
    const e = new Date(d); e.setHours(23, 59);
    return availableQty(eq, av.equipment, av.res, s, toLocalInput(e));
  });
  const max = Math.max(1, eq.quantity, ...dayAvail);

  return (
    <>
      <PageHead title={eq.name}>
        <button className="secondary" onClick={() => nav('/materiel')}><Icon name="arrow-left" />Retour</button>
        <button className="secondary" onClick={() => setRepair({})}>Déclarer une réparation</button>
        {eq.inspectionMonths ? <button className="secondary" onClick={() => setInspect({})}>Enregistrer un contrôle</button> : null}
        {!eq.isKit && !eq.accessoryOnly && <button className="secondary" onClick={() => setPrinting({})}><Icon name="tag" />Imprimer l'étiquette</button>}
        <button onClick={() => setEditing(true)}>Modifier</button>
        <button className="danger" onClick={async () => {
          if (confirm('Supprimer cet article ? Les lignes de projet existantes garderont leur désignation.')) {
            await db.units.where({ equipmentId: eq.id }).delete();
            await db.equipment.delete(eq.id); nav('/materiel');
          }
        }}>Supprimer</button>
      </PageHead>
      {eq.archived && <div className="alert">Article archivé : il n'est plus proposé dans les projets.</div>}
      {eq.photo && <img src={eq.photo} alt="" style={{ maxHeight: 160, borderRadius: 10, marginBottom: 12 }} />}
      <div className="stats">
        <div className="stat"><b>{eq.isKit ? 'Kit' : eq.accessoryOnly ? '—' : eq.quantity}</b><span>{eq.isKit ? 'composé' : eq.accessoryOnly ? 'hors inventaire' : eq.trackSerials ? 'unités en service' : 'en stock'}</span></div>
        <div className="stat"><b>{money(eq.dailyPrice)}</b><span>{eq.kind === 'vente' ? 'prix de vente / pièce' : 'prix / jour HT'}</span></div>
        <div className="stat"><b>{money(eq.replacementValue || 0)}</b><span>valeur de remplacement</span></div>
        <div className="stat"><b>{eq.code || '—'}</b><span>référence{eq.location ? ` · ${eq.location}` : ''}</span></div>
      </div>
      {eq._stock && av.depots.length > 1 && !eq.isKit && (
        <div className="info">Stock par dépôt : {av.depots.map((dp) => `${dp.name} ${stockAt(eq, dp.id, av.res)}`).join(' · ')}
          {av.transfers.some((t) => t.status !== 'annule' && t.lines.some((l) => l.equipmentId === eq.id)) && <> — <a href="#/transferts">voir les transferts</a></>}</div>
      )}

      {eq.accessoryOnly && (
        <div className="info">
          <strong>Élément hors inventaire</strong> : ni stock, ni disponibilité, il n'apparaît pas dans le catalogue. Il est ajouté automatiquement
          avec {(() => { const parents = av.equipment.filter((x) => x.accessories?.some((a) => a.equipmentId === eq.id)); return parents.length ? parents.map((x) => <Link key={x.id} to={'/materiel/' + x.id} style={{ marginRight: 8 }}>{x.name}</Link>) : 'aucun article pour l\'instant'; })()}
          et se coche à la sortie et au retour.
        </div>
      )}
      {!eq.isKit && !eq.accessoryOnly && (
        <div className="card">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Disponibilité sur 4 semaines</h2>
            <div className="actions">
              <button className="secondary small" onClick={() => setWeekOffset(weekOffset - 4)} aria-label="Précédent"><Icon name="chevron-left" /></button>
              <button className="secondary small" onClick={() => setWeekOffset(0)}>Aujourd'hui</button>
              <button className="secondary small" onClick={() => setWeekOffset(weekOffset + 4)} aria-label="Suivant"><Icon name="chevron-right" /></button>
            </div>
          </div>
          <div className="timeline">
            {days.map((d, i) => (
              <div key={i} className="tl-day" title={`${d.toLocaleDateString('fr-FR')} : ${dayAvail[i]} dispo`}>
                <div className="tl-bar-wrap">
                  <div className={'tl-bar ' + (dayAvail[i] <= 0 ? 'ko' : dayAvail[i] < eq.quantity ? 'mid' : 'ok')} style={{ height: `${Math.max(4, (Math.max(0, dayAvail[i]) / max) * 100)}%` }} />
                </div>
                <div className="tl-num">{dayAvail[i]}</div>
                <div className="tl-date">{d.getDate()}/{d.getMonth() + 1}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {eq.trackSerials && (
        <div className="card">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Unités ({units.length})</h2>
            <button className="small" onClick={() => setUnitEdit({ equipmentId: eq.id, serial: '', barcode: nextUnitCode(eq, av.units.filter((u) => u.equipmentId === eq.id)), status: 'ok' })}>+ Unité</button>
          </div>
          {units.length === 0 ? <Empty>Ajoute chaque unité avec son numéro de série et son code-barres.</Empty> : (
            <table className="list">
              <thead><tr><th className="n">#</th><th>N° de série</th><th>Code-barres</th>{av.depots.length > 1 && <th>Dépôt</th>}<th>État</th><th>Prochain contrôle</th><th /></tr></thead>
              <tbody>
                {units.map((u) => {
                  const d = due.find((x) => x.unit?.id === u.id);
                  return (
                    <tr key={u.id}>
                      <td className="n"><strong className="unit-no">{unitNo(u) || '—'}</strong></td>
                      <td><a href="#" onClick={(e) => { e.preventDefault(); setUnitEdit(u); }}><strong>{u.serial}</strong></a></td>
                      <td>{u.barcode}</td>
                      {av.depots.length > 1 && <td>{av.depots.find((dp) => dp.id === (u.depotId || av.mainDepot))?.name}</td>}
                      <td><span className="badge">{UNIT_STATUS[u.status]}</span>{repairs.some((r) => r.unitId === u.id && r.status === 'ouvert') && <span className="badge st-annule" style={{ marginLeft: 4 }}>en réparation</span>}</td>
                      <td>{d ? <span className={d.due <= new Date().toISOString().slice(0, 10) ? 'avail ko' : ''}>{fmtDate(d.due, false)}</span> : '—'}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="secondary small" onClick={() => setPrinting({ unitIds: [u.id] })} title="Imprimer l'étiquette de cette unité"><Icon name="tag" />Étiquette</button>{' '}
                        <button className="secondary small" onClick={() => setRepair({ unitId: u.id })}>Réparation</button>{' '}
                        {eq.inspectionMonths ? <button className="secondary small" onClick={() => setInspect({ unitId: u.id })}>Contrôle</button> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {eq.isKit && (
        <div className="card">
          <h2>Contenu du kit</h2>
          <ul>{eq.kitItems.map((k, i) => <li key={i}>{k.qty} × <Link to={'/materiel/' + k.equipmentId}>{allMap.get(k.equipmentId)?.name || '?'}</Link></li>)}</ul>
        </div>
      )}
      {(eq.accessories || []).length > 0 && (
        <div className="card">
          <h2>Accessoires automatiques</h2>
          <ul>{eq.accessories!.map((a, i) => <li key={i}>{a.qty} × <Link to={'/materiel/' + a.equipmentId}>{allMap.get(a.equipmentId)?.name || '?'}</Link> {a.free ? '(gratuit)' : '(facturé)'}</li>)}</ul>
        </div>
      )}
      {(eq.alternatives || []).length > 0 && (
        <div className="card"><h2>Articles de remplacement</h2>{eq.alternatives!.map((id) => <Link key={id} to={'/materiel/' + id} style={{ marginRight: 12 }}>{allMap.get(id)?.name || '?'}</Link>)}</div>
      )}
      {usedIn.length > 0 && (
        <div className="card"><h2>Inclus dans les kits</h2>{usedIn.map((k) => <Link key={k.id} to={'/materiel/' + k.id} style={{ marginRight: 12 }}>{k.name}</Link>)}</div>
      )}

      <div className="card">
        <h2>Réservations (option, confirmé, en cours)</h2>
        {usage.length === 0 ? <Empty>Aucune réservation active.</Empty> : (
          <table className="list">
            <thead><tr><th>Projet</th><th>Sous-projet</th><th>Période bloquée</th><th>Statut</th><th className="n">Qté</th></tr></thead>
            <tbody>
              {usage.map((r, i) => {
                const sp = subMap.get(r.subprojectId)!;
                const p = projMap.get(r.projectId);
                return (
                  <tr key={i} className="click" onClick={() => nav('/projets/' + r.projectId)}>
                    <td>{p?.number} {p?.name}</td><td>{sp?.name}</td><td>{fmtRange(r.start, sp?.returnEnd || sp?.end)}</td>
                    <td>{sp && <StatusBadge status={sp.status} />}</td><td className="n">{r.qty}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {(repairs.length > 0 || inspections.length > 0) && (
        <div className="card">
          <h2>Historique maintenance</h2>
          <table className="list">
            <tbody>
              {repairs.map((r) => (
                <tr key={r.id}><td>Réparation</td><td>{fmtDate(r.start, false)}{r.end && ` → ${fmtDate(r.end, false)}`}</td><td>{r.description}</td><td className="n">{money(r.cost)}</td><td><span className="badge">{r.status === 'ouvert' ? 'En cours' : 'Terminée'}</span></td></tr>
              ))}
              {inspections.map((i) => (
                <tr key={i.id}><td>Contrôle</td><td>{fmtDate(i.date, false)}</td><td>{i.unitId ? units.find((u) => u.id === i.unitId)?.serial : ''} {i.notes}</td><td>{i.by}</td><td><span className={'badge ' + (i.result === 'ok' ? 'st-confirme' : 'st-annule')}>{i.result === 'ok' ? 'Conforme' : 'Non conforme'}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {eq.contents?.length ? <div className="card"><h2>Contenu fourni</h2><ul style={{ margin: 0 }}>{eq.contents.map((c, i) => <li key={i}>{c.qty > 1 ? `${c.qty} × ` : ''}{c.name}</li>)}</ul></div> : null}
      {eq.notes && <div className="card"><h2>Notes</h2><p style={{ whiteSpace: 'pre-wrap' }}>{eq.notes}</p></div>}

      {editing && <Modal title="Modifier l'article" onClose={() => setEditing(false)} wide><EquipmentForm initial={raw} onDone={() => setEditing(false)} onPrint={() => setPrinting({})} /></Modal>}
      {printing && <PrintLabelModal equipmentId={eq.id} unitIds={printing.unitIds} onClose={() => setPrinting(null)} />}
      {repair && <RepairModal equipmentId={eq.id} unitId={repair.unitId} onClose={() => setRepair(null)} />}
      {inspect && <InspectionModal equipmentId={eq.id} unitId={inspect.unitId} onClose={() => setInspect(null)} />}
      {unitEdit && (
        <Modal title={unitEdit.id ? 'Modifier l\'unité' : 'Nouvelle unité'} onClose={() => setUnitEdit(null)}>
          <form className="form" onSubmit={async (e) => {
            e.preventDefault();
            // sans n° du fabricant, l'unité est désignée par son code (F-S-0010-03)
            const code = unitEdit.barcode?.trim() || nextUnitCode(eq, av.units.filter((u) => u.equipmentId === eq.id));
            const saved = await save(db.units, { ...unitEdit, number: unitEdit.number ?? nextNumber(units), barcode: code, serial: unitEdit.serial?.trim() || code } as SerialUnit);
            setUnitEdit(null);
            if ((e.nativeEvent as SubmitEvent).submitter?.getAttribute('data-print') === '1') setPrinting({ unitIds: [saved.id] });
          }}>
            <Field label="Numéro de l'unité (#)">
              <NumInput value={unitEdit.number ?? nextNumber(units)} step="1" min={1} onChange={(n) => setUnitEdit({ ...unitEdit, number: Math.max(1, Math.round(n)) || undefined })} aria-label="Numéro de l'unité" />
              {(() => { const n = unitEdit.number ?? nextNumber(units); const twin = units.find((u) => u.id !== unitEdit.id && u.number === n); return twin ? <small className="avail ko">#{n} est déjà pris par {twin.barcode || twin.serial}</small> : <small className="muted">Fixe : il ne change pas si une autre unité est supprimée.</small>; })()}
            </Field>
            <Field label="Code de l'unité (étiquette)"><input value={unitEdit.barcode || ''} onChange={(e) => setUnitEdit({ ...unitEdit, barcode: e.target.value })} aria-label="Code de l'unité" /></Field>
            <Field label="N° de série du fabricant"><input autoFocus value={unitEdit.serial || ''} onChange={(e) => setUnitEdit({ ...unitEdit, serial: e.target.value })} placeholder="facultatif" /></Field>
            <Field label="État">
              <select value={unitEdit.status} onChange={(e) => setUnitEdit({ ...unitEdit, status: e.target.value as SerialUnit['status'] })}>
                {Object.entries(UNIT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            {av.depots.length > 1 && (
              <Field label="Dépôt">
                <select value={unitEdit.depotId || av.mainDepot} onChange={(e) => setUnitEdit({ ...unitEdit, depotId: e.target.value })}>
                  {av.depots.map((dp) => <option key={dp.id} value={dp.id}>{dp.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Dernier contrôle"><input type="date" value={unitEdit.lastInspection || ''} onChange={(e) => setUnitEdit({ ...unitEdit, lastInspection: e.target.value })} /></Field>
            <Field label="Notes" full><textarea value={unitEdit.notes || ''} onChange={(e) => setUnitEdit({ ...unitEdit, notes: e.target.value })} /></Field>
            <div className="form-actions">
              {unitEdit.id && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={async () => { if (confirm('Supprimer cette unité ?')) { await db.units.delete(unitEdit.id!); setUnitEdit(null); } }}>Supprimer</button>}
              <button type="button" className="secondary" onClick={() => setUnitEdit(null)}>Annuler</button>
              <button type="submit">Enregistrer</button>
              <button type="submit" className="secondary" data-print="1" style={{ order: 2 }} title="Enregistre l'unité puis imprime son étiquette"><Icon name="tag" />Enregistrer et imprimer</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
