import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Empty, Field, Modal, NumInput, StatusBadge } from '../../components/ui';
import { db } from '../../db';
import type { Period, PeriodKind, Project, ProjectStatus, Subproject } from '../../types';
import { FIRM, PERIOD_LABELS, STATUS_LABELS } from '../../types';
import { shiftBetween, shiftDate, shiftProject, type Shift } from '../../projectOps';
import { blockPeriod, deleteSubproject, fmtDate, fmtRange, nowIso, patch, save, sortPeriods, syncPeriods, toLocalInput, uid, usageDays } from '../../utils';
import type { ProjectData } from './shared';
import { ownAddress, placeAddress, placeName, spotOf } from '../../places';

/** Onglet Planning : toutes les salles et tous leurs créneaux. */
export default function PlanningTab({ d, onEditSub }: { d: ProjectData; onEditSub: (sp: Partial<Subproject>) => void }) {
  const { project, subs } = d;
  const [shifting, setShifting] = useState(false);
  return (
    <>
      <div className="toolbar">
        <button className="secondary" onClick={() => setShifting(true)}>Décaler le projet…</button>
      </div>
      {shifting && <ShiftModal d={d} onClose={() => setShifting(false)} />}
      <div className="info">
        Découpe le projet en sous-projets (salle, scène, zone, jour…), puis donne à chacun ses créneaux : montage, jours de prestation, démontage.
        Le matériel est bloqué du premier au dernier créneau ; seuls les jours de prestation sont facturés.
      </div>
      {subs.length === 0 && <Empty>Aucun sous-projet.</Empty>}
      {subs.map((sp) => {
        const [b0, b1] = blockPeriod(sp);
        const ps = sortPeriods(sp.periods || []);
        return (
          <div key={sp.id} className="card">
            <div className="page-head" style={{ marginBottom: 8 }}>
              <div>
                <h2 style={{ margin: 0 }}>{sp.name} <StatusBadge status={sp.status} /></h2>
                <div className="muted">{sp.venue || project.venue} · matériel bloqué {fmtRange(b0, b1)} · {usageDays(sp)} j facturé(s)</div>
              </div>
              <div className="actions">
                <label className="check-row" title="L'entrepôt voit ce sous-projet et peut commencer à préparer le matériel">
                  <input type="checkbox" checked={!!sp.readyToPack} onChange={(e) => patch(db.subprojects, sp.id, { readyToPack: e.target.checked })} /> Prête pour la préparation
                </label>
                {!FIRM.includes(sp.status) && sp.status !== 'annule' && (
                  <label className="check-row" title="Le matériel de ce sous-projet passe en réservation ferme, prioritaire sur les autres options">
                    <input type="checkbox" checked={!!sp.reserve} onChange={(e) => patch(db.subprojects, sp.id, { reserve: e.target.checked })} /> Réserver le matériel
                  </label>
                )}
                <button className="secondary small" onClick={() => duplicateSub(d, sp, onEditSub)}>Dupliquer</button>
                <button className="small" onClick={() => onEditSub(sp)}>Modifier les horaires</button>
              </div>
            </div>
            {ps.length === 0 ? <p className="muted">Pas de créneaux détaillés : {fmtRange(sp.start, sp.end)}</p> : (
              <table className="list">
                <thead><tr><th>Créneau</th><th>Type</th><th>Début</th><th>Fin</th><th className="n">Durée</th></tr></thead>
                <tbody>
                  {ps.map((p) => (
                    <tr key={p.id}>
                      <td><span className={'period k-' + p.kind} style={{ background: 'transparent' }}><strong>{p.name}</strong></span></td>
                      <td>{PERIOD_LABELS[p.kind]}</td><td>{fmtDate(p.start)}</td><td>{fmtDate(p.end)}</td>
                      <td className="n">{Math.round((Date.parse(p.end) - Date.parse(p.start)) / 360000) / 10} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })}
      <button className="secondary" onClick={() => onEditSub(newSubDraft(d))}>+ Ajouter un sous-projet</button>
    </>
  );
}

export function newSubDraft(d: ProjectData): Partial<Subproject> {
  const { project, subs } = d;
  return {
    projectId: project.id, name: `Sous-projet ${subs.length + 1}`, status: project.status, start: project.start, end: project.end, venue: project.venue, order: subs.length,
    // mêmes horaires que la première salle, modifiables
    periods: subs[0]?.periods?.map((p) => ({ ...p, id: uid() })),
  };
}

/** Copie une salle avec ses horaires, groupes, matériel, postes et véhicules. */
export async function duplicateSub(d: ProjectData, sp: Subproject, onEdit: (sp: Subproject) => void) {
  const idMap = new Map<string, string>();
  const periods = sp.periods?.map((p) => { const id = uid(); idMap.set(p.id, id); return { ...p, id }; });
  const groups = sp.groups?.map((g) => { const id = uid(); idMap.set(g.id, id); return { ...g, id, periodIds: g.periodIds.map((x) => idMap.get(x) || x) }; });
  const ns = await save(db.subprojects, { ...sp, id: undefined, createdAt: undefined, name: `${sp.name} (copie)`, order: d.subs.length, periods, groups });
  const own = d.lines.filter((x) => x.subprojectId === sp.id);
  for (const l of own) idMap.set(l.id, uid());
  for (const l of own) {
    await db.lines.put({
      ...l, id: idMap.get(l.id)!, createdAt: nowIso(), updatedAt: nowIso(), subprojectId: ns.id, groupId: l.groupId ? idMap.get(l.groupId) : undefined,
      parentLineId: l.parentLineId ? idMap.get(l.parentLineId) : undefined, outQty: undefined, inQty: undefined, outSerials: undefined, inSerials: undefined, consumed: undefined,
    });
  }
  for (const c of d.projectCrew.filter((x) => x.subprojectId === sp.id)) await save(db.crew, { ...c, id: undefined, createdAt: undefined, subprojectId: ns.id, personId: undefined, periodId: c.periodId ? idMap.get(c.periodId) : undefined });
  for (const v of d.projectVas.filter((x) => x.subprojectId === sp.id)) await save(db.vehicleAssignments, { ...v, id: undefined, createdAt: undefined, subprojectId: ns.id, periodId: v.periodId ? idMap.get(v.periodId) : undefined });
  const fresh = await db.subprojects.get(ns.id);
  if (fresh) onEdit(fresh);
}

const PERIOD_DEFAULTS: Record<PeriodKind, [number, number]> = { montage: [8, 18], prestation: [10, 23], demontage: [8, 14], autre: [9, 18] };

export function SubprojectModal({ sp, project, onClose }: { sp: Partial<Subproject>; project: Project; onClose: () => void }) {
  const [d, setD] = useState(sp);
  const set = <K extends keyof Subproject>(k: K, v: Subproject[K]) => setD({ ...d, [k]: v });
  const periods = d.periods || [];
  const setPeriods = (ps: Period[]) => setD({ ...d, periods: ps });
  const others = useLiveQuery(() => db.subprojects.where({ projectId: project.id }).toArray(), [project.id]) || [];
  const venueC = useLiveQuery(() => (project.venueId ? db.contacts.get(project.venueId) : undefined), [project.venueId]);
  const sources = others.filter((o) => o.id !== d.id && o.periods?.length);

  /**
   * Ajoute un créneau le lendemain du dernier montage / jour de prestation (ou le jour du début du projet).
   * Un démontage commence à la fin du dernier créneau ; s'il existe déjà, il est décalé après le nouveau jour.
   */
  const addPeriod = (kind: PeriodKind) => {
    const sorted = sortPeriods(periods);
    const ref = kind === 'demontage' ? sorted.at(-1) : sorted.filter((x) => x.kind !== 'demontage').at(-1);
    let s: Date, e: Date;
    if (ref && kind === 'demontage') {
      s = new Date(ref.end);
      e = new Date(s.getTime() + 6 * 3600000);
    } else {
      const day = new Date((ref ? ref.start : project.start).slice(0, 10) + 'T12:00');
      if (ref) day.setDate(day.getDate() + 1);
      const [h1, h2] = PERIOD_DEFAULTS[kind];
      s = new Date(day); s.setHours(h1, 0, 0, 0);
      e = new Date(day); e.setHours(h2, 0, 0, 0);
    }
    const n = periods.filter((x) => x.kind === 'prestation').length + 1;
    const name = kind === 'prestation' ? `Prestation J${n}` : PERIOD_LABELS[kind];
    const added: Period = { id: uid(), name, kind, start: toLocalInput(s), end: toLocalInput(e) };
    const moved = periods.map((x) => {
      if (kind === 'demontage' || x.kind !== 'demontage' || x.start >= added.start && x.start >= added.end || (ref && x.start < ref.end)) return x;
      const shift = new Date(added.end).getTime() - new Date(x.start).getTime();
      return { ...x, start: added.end, end: toLocalInput(new Date(new Date(x.end).getTime() + shift)) };
    });
    setPeriods([...moved, added]);
  };

  return (
    <Modal title={d.id ? `Sous-projet : ${d.name}` : 'Nouveau sous-projet'} onClose={onClose} wide>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        if (periods.some((p) => p.end < p.start)) return alert('Chaque créneau doit finir après son début.');
        if (!periods.length && (d.end || '') < (d.start || '')) return alert('La fin doit être après le début.');
        const synced = syncPeriods({
          ...d, prepStart: d.prepStart || undefined, returnEnd: d.returnEnd || undefined,
          // les groupes ne gardent que les créneaux qui existent encore
          groups: d.groups?.map((g) => ({ ...g, periodIds: g.periodIds.filter((pid) => periods.some((p) => p.id === pid)) })),
        } as Subproject);
        const saved = await save(db.subprojects, synced);
        // les postes rattachés à un créneau suivent ses horaires
        for (const c of await db.crew.where({ subprojectId: saved.id }).toArray()) {
          const pe = c.periodId ? synced.periods?.find((x) => x.id === c.periodId) : undefined;
          if (c.periodId && !pe) await save(db.crew, { ...c, periodId: undefined });
          else if (pe && (pe.start !== c.start || pe.end !== c.end)) await save(db.crew, { ...c, start: pe.start, end: pe.end });
        }
        for (const v of await db.vehicleAssignments.where({ subprojectId: saved.id }).toArray()) {
          const pe = v.periodId ? synced.periods?.find((x) => x.id === v.periodId) : undefined;
          if (v.periodId && !pe) await save(db.vehicleAssignments, { ...v, periodId: undefined });
          else if (pe && (pe.start !== v.start || pe.end !== v.end)) await save(db.vehicleAssignments, { ...v, start: pe.start, end: pe.end });
        }
        onClose();
      }}>
        <Field label="Nom du sous-projet *"><input required autoFocus value={d.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="ex. Salle 1, Plénière, Scène extérieure" /></Field>
        {venueC?.spots?.length ? (
          <Field label={`Endroit dans ${venueC.company}`}>
            <select aria-label="Endroit du sous-projet" value={d.spotId || ''} onChange={(e) => {
              const spot = spotOf(venueC, e.target.value);
              setD({ ...d, spotId: spot?.id, venue: spot ? placeName(venueC, spot) : undefined });
            }}>
              <option value="">Comme le projet</option>
              {venueC.spots.map((x) => <option key={x.id} value={x.id}>{x.name}{ownAddress(x) ? ` — ${placeAddress(venueC, x)}` : ''}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Lieu"><input value={d.venue || ''} onChange={(e) => set('venue', e.target.value)} placeholder={project.venue} /></Field>
        )}
        <Field label="Statut">
          <select value={d.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>

        <div className="field full">
          <span>Horaires</span>
          {periods.length === 0 && <p className="muted" style={{ margin: '2px 0 6px' }}>Pas d'horaires détaillés : utilise les dates ci-dessous, ou ajoute des créneaux (montage, jours de prestation, démontage).</p>}
          {sortPeriods(periods).map((pe) => {
            const upd = (patch: Partial<Period>) => setPeriods(periods.map((x) => (x.id === pe.id ? { ...x, ...patch } : x)));
            return (
              <div key={pe.id} className="period-row">
                <select value={pe.kind} onChange={(e) => upd({ kind: e.target.value as PeriodKind })}>
                  {Object.entries(PERIOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
                <input value={pe.name} onChange={(e) => upd({ name: e.target.value })} />
                <input type="datetime-local" value={pe.start} onChange={(e) => upd({ start: e.target.value, end: pe.end < e.target.value ? e.target.value : pe.end })} />
                <input type="datetime-local" value={pe.end} onChange={(e) => upd({ end: e.target.value })} />
                <button type="button" className="ghost" onClick={() => setPeriods(periods.filter((x) => x.id !== pe.id))} aria-label="Retirer">✕</button>
              </div>
            );
          })}
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <button type="button" className="secondary small" onClick={() => addPeriod('montage')}>+ Montage</button>
            <button type="button" className="secondary small" onClick={() => addPeriod('prestation')}>+ Jour de prestation</button>
            <button type="button" className="secondary small" onClick={() => addPeriod('demontage')}>+ Démontage</button>
            <button type="button" className="secondary small" onClick={() => addPeriod('autre')}>+ Autre</button>
            {sources.length > 0 && (
              <select style={{ width: 'auto' }} value="" onChange={(e) => {
                const src = sources.find((o) => o.id === e.target.value);
                if (src) setPeriods((src.periods || []).map((p) => ({ ...p, id: uid() })));
              }}>
                <option value="">Copier les horaires de…</option>
                {sources.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
          </div>
          {periods.length > 0 && (() => {
            const preview = syncPeriods({ start: '', end: '', periods } as Pick<Subproject, 'start' | 'end' | 'prepStart' | 'returnEnd' | 'periods'>);
            return <p className="muted" style={{ marginBottom: 0 }}>
              Matériel bloqué : {fmtRange(preview.prepStart || preview.start, preview.returnEnd || preview.end)} · facturé : {usageDays({ ...preview, periods })} jour(s) de prestation
            </p>;
          })()}
        </div>

        {periods.length === 0 && (
          <>
            <Field label="Début d'utilisation (facturé)"><input type="datetime-local" required value={d.start || ''} onChange={(e) => set('start', e.target.value)} /></Field>
            <Field label="Fin d'utilisation (facturé)"><input type="datetime-local" required value={d.end || ''} onChange={(e) => set('end', e.target.value)} /></Field>
            <Field label="Préparation dès (facultatif)"><input type="datetime-local" value={d.prepStart || ''} onChange={(e) => set('prepStart', e.target.value)} /></Field>
            <Field label="Retour au dépôt jusqu'à (facultatif)"><input type="datetime-local" value={d.returnEnd || ''} onChange={(e) => set('returnEnd', e.target.value)} /></Field>
          </>
        )}
        <Field label="Notes" full><textarea value={d.notes || ''} onChange={(e) => set('notes', e.target.value)} /></Field>
        <div className="form-actions">
          {d.id && <button type="button" className="danger" style={{ marginRight: 'auto' }} onClick={async () => {
            if (confirm('Supprimer ce sous-projet et son contenu ?')) { await deleteSubproject(d.id!); onClose(); }
          }}>Supprimer</button>}
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit">Enregistrer</button>
        </div>
      </form>
    </Modal>
  );
}


/** Décale tout le projet (ou certaines salles) : d'une durée ou vers une nouvelle date de début. */
function ShiftModal({ d, onClose }: { d: ProjectData; onClose: () => void }) {
  const { project, subs } = d;
  const [mode, setMode] = useState<'duree' | 'date'>('date');
  const [days, setDays] = useState(7);
  const [hours, setHours] = useState(0);
  const [newStart, setNewStart] = useState(project.start);
  const [selected, setSelected] = useState<string[]>(subs.map((s) => s.id));
  const [withOrders, setWithOrders] = useState(true);
  const sh: Shift = mode === 'duree' ? { days, minutes: Math.round(hours * 60) } : shiftBetween(project.start, newStart);
  const label = `${sh.days ? `${sh.days > 0 ? '+' : ''}${sh.days} j` : ''} ${sh.minutes ? `${sh.minutes > 0 ? '+' : ''}${Math.round(sh.minutes / 6) / 10} h` : ''}`.trim() || 'aucun décalage';
  return (
    <Modal title="Décaler le projet" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        await shiftProject(project.id, sh, { subIds: selected, withOrders });
        onClose();
      }}>
        <Field label="Méthode" full>
          <div style={{ display: 'flex', gap: 16 }}>
            <label className="check-row"><input type="radio" checked={mode === 'date'} onChange={() => setMode('date')} /> Nouvelle date de début</label>
            <label className="check-row"><input type="radio" checked={mode === 'duree'} onChange={() => setMode('duree')} /> D'une durée</label>
          </div>
        </Field>
        {mode === 'date' ? (
          <Field label="Le projet commencera le" full><input type="datetime-local" value={newStart} onChange={(e) => setNewStart(e.target.value)} /></Field>
        ) : (
          <>
            <Field label="Jours (négatif = avancer)"><NumInput value={days} onChange={(n) => setDays(n)} /></Field>
            <Field label="Heures"><NumInput step="0.5" value={hours} onChange={(n) => setHours(n)} /></Field>
          </>
        )}
        <div className="field full">
          <span>Sous-projets à décaler</span>
          {subs.map((s) => (
            <label key={s.id} className="check-row">
              <input type="checkbox" checked={selected.includes(s.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, s.id] : selected.filter((x) => x !== s.id))} />
              {s.name} <span className="muted">{fmtRange(s.start, s.end)} → {fmtRange(shiftDate(s.start, sh), shiftDate(s.end, sh))}</span>
            </label>
          ))}
        </div>
        <Field label=" " full><label className="check-row"><input type="checkbox" checked={withOrders} onChange={(e) => setWithOrders(e.target.checked)} /> Décaler aussi les sous-locations et transferts planifiés du projet</label></Field>
        <p className="muted field full" style={{ margin: 0 }}>Décalage : <strong>{label}</strong>. Créneaux, postes et véhicules suivent. Les documents déjà émis ne changent pas : régénère le devis si besoin.</p>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={!selected.length || (!sh.days && !sh.minutes)}>Décaler</button>
        </div>
      </form>
    </Modal>
  );
}
