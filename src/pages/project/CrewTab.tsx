import { Empty, NumInput, StatusBadge } from '../../components/ui';
import { appBaseUrl, db } from '../../db';
import type { CrewAssignment, Person, Subproject, VehicleAssignment } from '../../types';
import { RESERVING } from '../../types';
import { blockPeriod, buildIcs, crewAmount, crewCostRate, crewWindow, functionRate, daysBetween, download, fmtRange, money, overlaps, round2, save, sortPeriods, patch } from '../../utils';
import { personIssue, type ProjectData } from './shared';
import { perKmFor, tripKm, vehiclePrice } from '../../geo';

/** Onglet Équipe & transport : postes et véhicules par salle et par créneau, puis affectation. */
export default function CrewTab({ d }: { d: ProjectData }) {
  const { project, projectCrew, people, settings } = d;
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

  const sendPlanning = (p: Person) => {
    const items = schedule(p, true);
    if (!items.length) return alert(`Aucun poste final pour ${p.name} : passe ses postes en « final » avant d'envoyer le planning.`);
    const body = `Bonjour ${p.name.split(' ')[0]},\n\nVoici ton planning pour « ${project.name} »${project.venue ? ` (${project.venue})` : ''} :\n\n${items.map((i) => '- ' + i.label).join('\n')}\n\n${project.notes ? project.notes + '\n\n' : ''}Merci de me confirmer ta disponibilité.\n${settings.company.name}`;
    location.href = `mailto:${p.email || ''}?subject=${encodeURIComponent(`Planning — ${project.name}`)}&body=${encodeURIComponent(body)}`;
  };
  const icsFor = (p: Person) => {
    const base = appBaseUrl(settings);
    download(`${project.number}-${p.name.replace(/\s+/g, '-')}.ics`, buildIcs(`${project.name} — ${p.name}`, schedule(p, true).map(({ c, sp, a, b }) => ({
      uid: c.id, title: `${c.function} — ${project.name}`, start: a, end: b, location: sp?.venue || project.venue, description: sp?.name, url: `${base}#/projets/${project.id}`,
    }))), 'text/calendar;charset=utf-8');
  };

  return (
    <>
      <div className="card">
        <h2>Planification du personnel</h2>
        <div className="stats" style={{ marginBottom: 8 }}>
          <div className="stat"><b>{projectCrew.length}</b><span>postes</span></div>
          <div className="stat"><b style={{ color: open.length ? 'var(--danger)' : 'var(--ok)' }}>{open.length}</b><span>à pourvoir</span></div>
          <div className="stat"><b>{assigned.length}</b><span>personnes affectées</span></div>
          <div className="stat"><b style={{ color: provisional ? 'var(--accent)' : undefined }}>{provisional}</b><span>postes provisoires</span></div>
        </div>
        {provisional > 0 && <button className="secondary small" style={{ marginBottom: 8 }} onClick={async () => { for (const c of projectCrew.filter((x) => x.final === false)) await save(db.crew, { ...c, final: true }); }}>Rendre toute la planification finale</button>}
        {assigned.length === 0 ? <Empty>Personne n'est encore affecté. Crée des postes dans les salles ci-dessous, puis choisis qui les occupe.</Empty> : (
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
      {d.subs.map((sp) => <RoomCrew key={sp.id} d={d} sp={sp} pMap={pMap} />)}
    </>
  );
}

function RoomCrew({ d, sp, pMap }: { d: ProjectData; sp: Subproject; pMap: Map<string, Person> }) {
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
      <option value="">Toute la salle</option>
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
        <h3 style={{ marginBottom: 6 }}>Équipe</h3>
        {crew.length > 0 && (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Fonction</th>{periods.length > 0 && <th>Créneau</th>}<th>Personne</th><th>Début</th><th>Fin</th><th>Unité</th><th title="Prix facturé au client (fonction)">Tarif client</th><th title="Ce que te coûte la personne affectée">Coût</th><th title="Final : visible du technicien (agenda, planning envoyé). Provisoire : pas encore communiqué.">Final</th><th title="Ajouter le temps de trajet du projet avant et après">Trajet</th><th>Facturé</th><th className="n">Total client</th><th className="n">Marge</th><th /></tr></thead>
              <tbody>
                {crew.map((c) => {
                  const issue = personIssue(c.personId, c.start, c.end, c.id, d.crew, d.av.subs, d.unav);
                  const person = c.personId ? pMap.get(c.personId) : undefined;
                  const personCost = crewCostRate({ rateUnit: c.rateUnit }, person);
                  const a = crewAmount(c, d.settings, d.project.travelMinutes, crewCostRate(c, person));
                  const margin = (c.billable ? a.billed : 0) - a.cost;
                  const unitLabel = c.rateUnit === 'heure' ? '/h' : '/j';
                  return (
                    <tr key={c.id}>
                      <td>
                        <input value={c.function} list="fonctions" onChange={(e) => {
                          const fn = e.target.value;
                          const rate = functionRate(fn, c.rateUnit, catalogue);
                          updCrew(c, { function: fn, ...(rate != null && catalogue.some((f) => f.name.toLowerCase() === fn.trim().toLowerCase()) ? { rate } : {}) });
                        }} />
                      </td>
                      {periods.length > 0 && <td><PeriodSelect value={c.periodId} onChange={(v) => updCrew(c, slot(v))} /></td>}
                      <td>
                        <select value={c.personId || ''} onChange={(e) => {
                          const p = pMap.get(e.target.value);
                          // le tarif client ne bouge pas ; le coût suit la personne choisie
                          updCrew(c, { personId: e.target.value || undefined, cost: undefined, rate: c.rate || functionRate(c.function, c.rateUnit, catalogue, p) || 0 });
                        }}>
                          <option value="">— à pourvoir —</option>
                          {[...d.people].sort((x, y) => crewCostRate({ rateUnit: c.rateUnit }, x) - crewCostRate({ rateUnit: c.rateUnit }, y)).map((x) => {
                            const why = personIssue(x.id, c.start, c.end, c.id, d.crew, d.av.subs, d.unav);
                            const cost = crewCostRate({ rateUnit: c.rateUnit }, x);
                            return <option key={x.id} value={x.id}>{x.name}{x.external ? ' (ext.)' : ''} — {cost ? `${money(cost)}${unitLabel}` : 'coût ?'}{why ? ` — ${why}` : ''}</option>;
                          })}
                        </select>
                        {issue && <div className="avail ko">{issue === 'indisponible' ? 'Indisponible' : 'Déjà planifié ailleurs'}</div>}
                      </td>
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
                      <td><NumInput className="w-price" value={c.rate} onChange={(n) => updCrew(c, { rate: n })} /></td>
                      <td>
                        <NumInput className="w-price" value={c.cost ?? personCost} onChange={(n) => updCrew(c, { cost: n })} />
                        {c.cost != null && c.cost !== personCost && (
                          <button className="ghost small" title={`Revenir au coût de la personne (${money(personCost)}${unitLabel})`} onClick={() => updCrew(c, { cost: undefined })}>↺</button>
                        )}
                      </td>
                      <td><input type="checkbox" aria-label="Planification finale" checked={c.final !== false} onChange={(e) => updCrew(c, { final: e.target.checked })} /></td>
                      <td><input type="checkbox" checked={!!c.travel} disabled={!d.project.travelMinutes} title={d.project.travelMinutes ? `${d.project.travelMinutes} min avant et après` : 'Calcule d\'abord la distance du projet (onglet Général)'} onChange={(e) => updCrew(c, { travel: e.target.checked })} /></td>
                      <td><input type="checkbox" checked={c.billable} onChange={(e) => updCrew(c, { billable: e.target.checked })} /></td>
                      <td className="n">{money(a.billed)}{a.unit === 'heure' && <div className="muted" style={{ fontSize: 11 }}>{a.hours} h{a.overtime ? ` dont ${a.overtime} h sup.` : ''}</div>}</td>
                      <td className="n"><span className={'avail ' + (margin < 0 ? 'ko' : 'ok')}>{money(round2(margin))}</span><div className="muted" style={{ fontSize: 11 }}>coût {money(a.cost)}</div></td>
                      <td><button className="ghost" onClick={() => db.crew.delete(c.id)} aria-label="Retirer">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="toolbar" style={{ marginTop: 8 }}>
          <datalist id="fonctions">{catalogue.map((f) => <option key={f.name} value={f.name} />)}</datalist>
          <button className="small" onClick={() => save(db.crew, { projectId: sp.projectId, subprojectId: sp.id, function: defaultFn, ...slot(undefined), rate: functionRate(defaultFn, 'jour', catalogue) || 0, billable: true, final: !!d.settings.crewFinalByDefault })}>+ Poste</button>
          {periods.map((pe) => (
            <button key={pe.id} className="secondary small" onClick={() => save(db.crew, { projectId: sp.projectId, subprojectId: sp.id, function: defaultFn, ...slot(pe.id), rate: functionRate(defaultFn, 'jour', catalogue) || 0, billable: true, final: !!d.settings.crewFinalByDefault })}>+ Poste {pe.name}</button>
          ))}
        </div>

        <h3 style={{ margin: '16px 0 6px' }}>Transport</h3>
        {d.vehicles.length === 0 ? <Empty>Ajoute d'abord tes véhicules dans le menu Véhicules.</Empty> : (
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
