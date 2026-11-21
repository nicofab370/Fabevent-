import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, NumInput, StatusBadge } from '../../components/ui';
import { CostCell, PersonSelect, type CrewContext } from '../crewAssign';
import { EmailModal } from '../../components/EmailModal';
import { appBaseUrl, db } from '../../db';
import type { CrewAssignment, Person, Subproject, VehicleAssignment } from '../../types';
import { RESERVING } from '../../types';
import { blockPeriod, buildIcs, crewAmount, crewCostRate, crewWindow, functionRate, daysBetween, download, fmtRange, money, overlaps, round2, save, sortPeriods, patch } from '../../utils';
import { personIssue, type ProjectData } from './shared';
import { PostRequests, useCrewDialogs } from '../crewRequests';
import { useLiveQuery } from 'dexie-react-hooks';
import { perKmFor, tripKm, vehiclePrice } from '../../geo';

/** Onglet Équipe & transport : postes et véhicules par salle et par créneau, puis affectation. */
export default function CrewTab({ d }: { d: ProjectData }) {
  const { project, projectCrew, people, settings } = d;
  const [mailPerson, setMailPerson] = useState<Person | null>(null);
  const [mode, setModeState] = useState<CrewMode>(() => { try { return (localStorage.getItem('fab.crewMode') as CrewMode) || 'postes'; } catch { return 'postes'; } });
  const setMode = (m: CrewMode) => { setModeState(m); try { localStorage.setItem('fab.crewMode', m); } catch { /* sans stockage */ } };
  const requests = useLiveQuery(() => db.crewRequests.where({ projectId: project.id }).toArray(), [project.id]) || [];
  const ctx: CrewContext = { people, allCrew: d.crew, subs: d.av.subs, unav: d.unav, catalogue: settings.crewFunctions || [], requests };
  const cd = useCrewDialogs();
  const pMap = new Map(people.map((p) => [p.id, p]));
  const subMap = new Map(d.subs.map((s) => [s.id, s]));
  const assigned = people.filter((p) => projectCrew.some((c) => c.personId === p.id));
  const open = projectCrew.filter((c) => !c.personId && subMap.get(c.subprojectId)?.status !== 'annule');
  const provisional = projectCrew.filter((c) => c.final === false).length;

  /** postes d'une personne ; finalOnly = ce qu'elle a le droit de voir (planification finale) */
  const schedule = (p: Person, finalOnly = false) => projectCrew
    .filter((c) => c.personId === p.id && (!finalOnly || c.final !== false))
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((c) => {
      const sp = subMap.get(c.subprojectId);
      const pe = sp?.periods?.find((x) => x.id === c.periodId);
      const [a, b] = crewWindow(c, project.travelMinutes);
      return { c, sp, a, b, label: `${fmtRange(a, b)} — ${c.function} · ${sp?.name}${pe ? ` (${pe.name})` : ''}${a !== c.start ? ' (trajet inclus)' : ''}` };
    });

  const planningMail = (p: Person) => {
    const items = schedule(p, true);
    const body = `Bonjour ${p.name.split(' ')[0]},\n\nVoici ton planning pour « ${project.name} »${project.venue ? ` (${project.venue})` : ''} :\n\n${items.map((i) => '- ' + i.label).join('\n')}\n\nLe fichier agenda joint (.ics) ajoute ces horaires à ton calendrier.\n\n${project.notes ? project.notes + '\n\n' : ''}Merci de me confirmer ta disponibilité.\n${settings.company.name}`;
    return { to: p.email || '', subject: `Planning — ${project.name}`, body };
  };
  const sendPlanning = (p: Person) => {
    if (!schedule(p, true).length) return alert(`Aucun poste final pour ${p.name} : passe ses postes en « final » avant d'envoyer le planning.`);
    setMailPerson(p);
  };
  const icsText = (p: Person) => {
    const base = appBaseUrl(settings);
    return buildIcs(`${project.name} — ${p.name}`, schedule(p, true).map(({ c, sp, a, b }) => ({
      uid: c.id, title: `${c.function} — ${project.name}`, start: a, end: b, location: sp?.venue || project.venue, description: sp?.name, url: `${base}#/projets/${project.id}`,
    })));
  };
  const icsName = (p: Person) => `${project.number}-${p.name.replace(/\s+/g, '-')}.ics`;
  const icsFor = (p: Person) => download(icsName(p), icsText(p), 'text/calendar;charset=utf-8');

  return (
    <>
      <div className="tabs crew-modes" role="tablist">
        <button role="tab" className={mode === 'postes' ? 'on' : ''} onClick={() => setMode('postes')}>1. Postes à prévoir ({projectCrew.length})</button>
        <button role="tab" className={mode === 'attribution' ? 'on' : ''} onClick={() => setMode('attribution')}>2. Attribution des techniciens{open.length ? ` (${open.length} à pourvoir)` : ''}</button>
      </div>
      {mode === 'postes' ? (
        <div className="info">
          Prévois d'abord les <strong>postes</strong> dont le projet a besoin (fonction, nombre, créneau, tarif client) et le transport.
          Les techniciens s'attribuent ensuite dans l'onglet « 2. Attribution », ou pour tous les projets dans le menu <Link to="/attribution">Attribution</Link>.
        </div>
      ) : (
      <div className="card">
        <h2>Planification du personnel</h2>
        <div className="stats" style={{ marginBottom: 8 }}>
          <div className="stat"><b>{projectCrew.length}</b><span>postes</span></div>
          <div className="stat"><b style={{ color: open.length ? 'var(--danger)' : 'var(--ok)' }}>{open.length}</b><span>à pourvoir</span></div>
          <div className="stat"><b>{assigned.length}</b><span>personnes affectées</span></div>
          <div className="stat"><b style={{ color: provisional ? 'var(--accent)' : undefined }}>{provisional}</b><span>postes provisoires</span></div>
        </div>
        {provisional > 0 && <button className="secondary small" style={{ marginBottom: 8 }} onClick={async () => { for (const c of projectCrew.filter((x) => x.final === false)) await save(db.crew, { ...c, final: true }); }}>Rendre toute la planification finale</button>}
        {assigned.length === 0 ? <Empty>Personne n'est encore affecté. Crée des postes dans les sous-projets ci-dessous, puis choisis qui les occupe.</Empty> : (
          <table className="list">
            <tbody>
              {assigned.map((p) => (
                <tr key={p.id}>
                  <td style={{ width: 200 }}><strong>{p.name}</strong><div className="muted">{p.role}{p.external ? ' · externe' : ''}</div></td>
                  <td>{schedule(p).map((i) => <div key={i.c.id} style={{ fontSize: 12 }}>{i.label}{i.c.final === false && <span className="badge st-option" style={{ marginLeft: 4 }}>provisoire</span>}</div>)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="secondary small" onClick={() => sendPlanning(p)}>Envoyer le planning</button>{' '}
                    <button className="secondary small" onClick={() => icsFor(p)}>.ics</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      )}
      {mode === 'attribution' && open.length > 0 && (
        <div className="toolbar"><button onClick={() => cd.askProject(project.id, open.map((c) => c.id))}>📨 Demander les dispos pour les {open.length} poste(s) à pourvoir</button></div>
      )}
      {d.subs.map((sp) => <RoomCrew key={sp.id} d={d} sp={sp} pMap={pMap} mode={mode} ctx={ctx} actionsFor={cd.forPost} />)}
      {cd.dialogs}
      {mailPerson && (
        <EmailModal initial={planningMail(mailPerson)} onClose={() => setMailPerson(null)} kind="planning"
          vars={{ prenom: mailPerson.name.split(' ')[0], projet: project.name, lieu: project.venue, societe: settings.company.name, postes: schedule(mailPerson, true).map((i) => '- ' + i.label).join('\n'), dates: fmtRange(project.start, project.end) }}
          prepare={async () => [{ name: icsName(mailPerson), type: 'text/calendar', blob: new Blob([icsText(mailPerson)], { type: 'text/calendar;charset=utf-8' }) }]} />
      )}
    </>
  );
}

type CrewMode = 'postes' | 'attribution';

function RoomCrew({ d, sp, pMap, mode, ctx, actionsFor }: { d: ProjectData; sp: Subproject; pMap: Map<string, Person>; mode: CrewMode; ctx: CrewContext; actionsFor: (c: CrewAssignment) => { onAsk: () => void; onReplace: () => void; onDetails: () => void } }) {
  const [addQty, setAddQty] = useState(1);
  const [addFn, setAddFn] = useState('');
  const [addPeriod, setAddPeriod] = useState('');
  const periods = sortPeriods(sp.periods || []);
  const [bStart, bEnd] = blockPeriod(sp);
  const crew = d.projectCrew.filter((c) => c.subprojectId === sp.id).sort((a, b) => a.start.localeCompare(b.start));
  const vas = d.projectVas.filter((v) => v.subprojectId === sp.id);
  const subMap = new Map(d.av.subs.map((s) => [s.id, s]));
  const updCrew = (c: CrewAssignment, changes: Partial<CrewAssignment>) => patch(db.crew, c.id, changes);
  const catalogue = d.settings.crewFunctions || [];
  const defaultFn = catalogue[0]?.name || 'Technicien';
  const updVa = (v: VehicleAssignment, patch: Partial<VehicleAssignment>) => save(db.vehicleAssignments, { ...v, ...patch });
  const vMap = new Map(d.vehicles.map((x) => [x.id, x]));
  /** modification qui change le prix : on le recalcule (forfait × jours + km × €/km) */
  const updVaPriced = (v: VehicleAssignment, patch: Partial<VehicleAssignment>) => {
    const next = { ...v, ...patch };
    return save(db.vehicleAssignments, { ...next, price: vehiclePrice(next, vMap.get(next.vehicleId), d.settings) });
  };
  const vehicleBusy = (v: VehicleAssignment) => d.vas.some((o) => o.id !== v.id && o.vehicleId === v.vehicleId &&
    RESERVING.includes(subMap.get(o.subprojectId)?.status || 'annule') && overlaps(o.start, o.end, v.start, v.end));
  const slot = (periodId: string | undefined) => {
    const pe = periods.find((x) => x.id === periodId);
    return pe ? { periodId: pe.id, start: pe.start, end: pe.end } : { periodId: undefined, start: bStart, end: bEnd };
  };
  const PeriodSelect = ({ value, onChange }: { value?: string; onChange: (v?: string) => void }) => (
    <select value={value || ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">Tout le sous-projet</option>
      {periods.map((pe) => <option key={pe.id} value={pe.id}>{pe.name}</option>)}
    </select>
  );

  return (
    <div className="sub">
      <div className="sub-head">
        <h3>{sp.name} <StatusBadge status={sp.status} /></h3>
        <span className="muted">{fmtRange(bStart, bEnd)}</span>
      </div>
      <div className="sub-body">
        <h3 style={{ marginBottom: 6 }}>{mode === 'postes' ? 'Postes à prévoir' : 'Attribution des techniciens'}</h3>
        {crew.length === 0 && mode === 'attribution' && <Empty>Aucun poste prévu : ajoute-les d'abord dans « 1. Postes à prévoir ».</Empty>}
        {crew.length > 0 && mode === 'postes' && (
          <div className="table-wrap">
            <table className="list crew-posts">
              <thead><tr><th>Fonction</th>{periods.length > 0 && <th>Créneau</th>}<th>Début</th><th>Fin</th><th>Unité</th><th title="Prix facturé au client pour la fonction">Tarif client</th><th title="Ajouter le temps de trajet du projet avant et après">Trajet</th><th>Facturé</th><th className="n">Total client</th><th>Technicien</th><th /></tr></thead>
              <tbody>
                {crew.map((c) => {
                  const person = c.personId ? pMap.get(c.personId) : undefined;
                  const a = crewAmount(c, d.settings, d.project.travelMinutes, crewCostRate(c, person));
                  return (
                    <tr key={c.id}>
                      <td>
                        <input value={c.function} list="fonctions" aria-label="Fonction" onChange={(e) => {
                          const fn = e.target.value;
                          const rate = functionRate(fn, c.rateUnit, catalogue);
                          updCrew(c, { function: fn, ...(rate != null && catalogue.some((f) => f.name.toLowerCase() === fn.trim().toLowerCase()) ? { rate } : {}) });
                        }} />
                      </td>
                      {periods.length > 0 && <td><PeriodSelect value={c.periodId} onChange={(v) => updCrew(c, slot(v))} /></td>}
                      <td><input type="datetime-local" value={c.start} onChange={(e) => updCrew(c, { start: e.target.value, periodId: undefined })} /></td>
                      <td><input type="datetime-local" value={c.end} onChange={(e) => updCrew(c, { end: e.target.value, periodId: undefined })} /></td>
                      <td>
                        <select value={c.rateUnit || 'jour'} onChange={(e) => {
                          const unit = e.target.value as 'jour' | 'heure';
                          updCrew(c, { rateUnit: unit, rate: functionRate(c.function, unit, catalogue, person) ?? c.rate, cost: undefined });
                        }}>
                          <option value="jour">/ jour</option><option value="heure">/ heure</option>
                        </select>
                      </td>
                      <td><NumInput className="w-price" value={c.rate} onChange={(n) => updCrew(c, { rate: n })} aria-label="Tarif client" /></td>
                      <td><input type="checkbox" checked={!!c.travel} disabled={!d.project.travelMinutes} title={d.project.travelMinutes ? `${d.project.travelMinutes} min avant et après` : 'Calcule d\'abord la distance du projet (onglet Général)'} onChange={(e) => updCrew(c, { travel: e.target.checked })} /></td>
                      <td><input type="checkbox" checked={c.billable} onChange={(e) => updCrew(c, { billable: e.target.checked })} /></td>
                      <td className="n">{money(a.billed)}{a.unit === 'heure' && <div className="muted" style={{ fontSize: 11 }}>{a.hours} h{a.overtime ? ` dont ${a.overtime} h sup.` : ''}</div>}</td>
                      <td>{person ? <span>{person.name}{c.final === false && <span className="badge st-option" style={{ marginLeft: 4 }}>provisoire</span>}</span> : <span className="avail ko">à pourvoir</span>}</td>
                      <td className="nowrap">
                        <button className="ghost small" title="Dupliquer le poste" aria-label="Dupliquer le poste" onClick={() => save(db.crew, { ...c, id: '', createdAt: '', personId: undefined, cost: undefined })}>⧉</button>
                        <button className="ghost" onClick={() => db.crew.delete(c.id)} aria-label="Retirer">✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {crew.length > 0 && mode === 'attribution' && (
          <div className="table-wrap">
            <table className="list crew-assign">
              <thead><tr><th>Poste</th><th>Horaires</th><th>Technicien</th><th title="Ce que te coûte la personne affectée">Coût</th><th title="Final : visible du technicien (agenda, planning envoyé). Provisoire : pas encore communiqué.">Final</th><th className="n">Total client</th><th className="n">Marge</th></tr></thead>
              <tbody>
                {crew.map((c) => {
                  const person = c.personId ? pMap.get(c.personId) : undefined;
                  const a = crewAmount(c, d.settings, d.project.travelMinutes, crewCostRate(c, person));
                  const margin = (c.billable ? a.billed : 0) - a.cost;
                  const pe = periods.find((x) => x.id === c.periodId);
                  return (
                    <tr key={c.id}>
                      <td><strong>{c.function}</strong>{pe && <div className="muted">{pe.name}</div>}</td>
                      <td className="nowrap">{fmtRange(c.start, c.end)}</td>
                      <td><PersonSelect c={c} ctx={ctx} /><PostRequests c={c} people={ctx.people} requests={ctx.requests || []} {...actionsFor(c)} /></td>
                      <td className="nowrap"><CostCell c={c} person={person} /></td>
                      <td><input type="checkbox" aria-label="Planification finale" checked={c.final !== false} onChange={(e) => updCrew(c, { final: e.target.checked })} /></td>
                      <td className="n">{c.billable ? money(a.billed) : <span className="muted">non facturé</span>}</td>
                      <td className="n">{!c.personId && c.cost == null ? <span className="muted">à pourvoir</span> : <><span className={'avail ' + (margin < 0 ? 'ko' : 'ok')}>{money(round2(margin))}</span><div className="muted" style={{ fontSize: 11 }}>coût {money(a.cost)}</div></>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {mode === 'postes' && (
          <form className="toolbar add-posts" style={{ marginTop: 8 }} onSubmit={async (e) => {
            e.preventDefault();
            const fn = addFn.trim() || defaultFn;
            const n = Math.max(1, Math.min(50, Math.round(addQty || 1)));
            for (let i = 0; i < n; i++) {
              await save(db.crew, { projectId: sp.projectId, subprojectId: sp.id, function: fn, ...slot(addPeriod || undefined), rate: functionRate(fn, 'jour', catalogue) || 0, billable: true, final: !!d.settings.crewFinalByDefault });
            }
          }}>
            <datalist id="fonctions">{catalogue.map((f) => <option key={f.name} value={f.name} />)}</datalist>
            <NumInput className="w-qty" value={addQty} onChange={setAddQty} aria-label="Nombre de postes" />
            <span>×</span>
            <input list="fonctions" value={addFn} onChange={(e) => setAddFn(e.target.value)} placeholder={defaultFn} aria-label="Fonction à ajouter" style={{ maxWidth: 200 }} />
            {periods.length > 0 && (
              <select value={addPeriod} onChange={(e) => setAddPeriod(e.target.value)} aria-label="Créneau des postes" style={{ width: 'auto' }}>
                <option value="">Tout le sous-projet</option>
                {periods.map((pe) => <option key={pe.id} value={pe.id}>{pe.name}</option>)}
              </select>
            )}
            <button type="submit" className="small">+ Ajouter les postes</button>
          </form>
        )}

        {mode === 'postes' && <h3 style={{ margin: '16px 0 6px' }}>Transport</h3>}
        {mode !== 'postes' ? null : d.vehicles.length === 0 ? <Empty>Ajoute d'abord tes véhicules dans le menu Véhicules.</Empty> : (
          <>
            {vas.length > 0 && (
              <div className="table-wrap">
                <table className="list">
                  <thead><tr><th>Véhicule</th>{periods.length > 0 && <th>Créneau</th>}<th>Chauffeur</th><th>Début</th><th>Fin</th><th title="Allers-retours">A/R</th><th>Km</th><th>€/km</th><th>Prix HT</th><th>Facturé</th><th /></tr></thead>
                  <tbody>
                    {vas.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <select value={v.vehicleId} onChange={(e) => updVaPriced(v, { vehicleId: e.target.value, perKm: undefined })}>
                            {d.vehicles.map((x) => <option key={x.id} value={x.id}>{x.name}{x.plate ? ` (${x.plate})` : ''}</option>)}
                          </select>
                          {vehicleBusy(v) && <div className="avail ko">Déjà réservé ailleurs</div>}
                        </td>
                        {periods.length > 0 && <td><PeriodSelect value={v.periodId} onChange={(p) => updVaPriced(v, slot(p))} /></td>}
                        <td>
                          <select value={v.driverId || ''} onChange={(e) => updVa(v, { driverId: e.target.value || undefined })}>
                            <option value="">—</option>
                            {d.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </td>
                        <td><input type="datetime-local" value={v.start} onChange={(e) => updVaPriced(v, { start: e.target.value, periodId: undefined })} /></td>
                        <td><input type="datetime-local" value={v.end} onChange={(e) => updVaPriced(v, { end: e.target.value, periodId: undefined })} /></td>
                        <td><NumInput className="w-qty" step="1" min={0} value={v.trips ?? d.settings.defaultTrips ?? 2} onChange={(n) => updVaPriced(v, { trips: n, ...(v.kmManual ? {} : { km: tripKm(d.project.distanceKm, n) }) })} /></td>
                        <td>
                          <NumInput className="w-qty" min={0} value={v.km ?? 0} onChange={(n) => updVaPriced(v, { km: n, kmManual: true })} />
                          {v.kmManual && <button className="ghost small" title="Recalculer depuis la distance du projet" onClick={() => updVaPriced(v, { kmManual: false, km: tripKm(d.project.distanceKm, v.trips ?? d.settings.defaultTrips ?? 2) })}>↺</button>}
                        </td>
                        <td><NumInput className="w-qty" min={0} value={perKmFor(v, vMap.get(v.vehicleId), d.settings)} onChange={(n) => updVaPriced(v, { perKm: n })} /></td>
                        <td><NumInput className="w-price" value={v.price} onChange={(n) => updVa(v, { price: n })} /></td>
                        <td><input type="checkbox" checked={v.billable} onChange={(e) => updVa(v, { billable: e.target.checked })} /></td>
                        <td><button className="ghost" onClick={() => db.vehicleAssignments.delete(v.id)} aria-label="Retirer">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button className="small" style={{ marginTop: 8 }} onClick={() => {
              const veh = d.vehicles[0];
              const trips = d.settings.defaultTrips ?? 2;
              const va = { projectId: sp.projectId, subprojectId: sp.id, vehicleId: veh.id, ...slot(undefined), trips, km: tripKm(d.project.distanceKm, trips), billable: true };
              save(db.vehicleAssignments, { ...va, price: vehiclePrice(va, veh, d.settings) });
            }}>+ Véhicule</button>
          </>
        )}
      </div>
    </div>
  );
}
