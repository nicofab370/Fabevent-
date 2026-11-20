import { Empty, NumInput, StatusBadge } from '../../components/ui';
import { appBaseUrl, db } from '../../db';
import type { CrewAssignment, Person, Subproject, VehicleAssignment } from '../../types';
import { RESERVING } from '../../types';
import { blockPeriod, buildIcs, daysBetween, download, fmtRange, money, overlaps, round2, save, sortPeriods } from '../../utils';
import { personIssue, type ProjectData } from './shared';

/** Onglet Équipe & transport : postes et véhicules par salle et par créneau, puis affectation. */
export default function CrewTab({ d }: { d: ProjectData }) {
  const { project, projectCrew, people, settings } = d;
  const pMap = new Map(people.map((p) => [p.id, p]));
  const subMap = new Map(d.subs.map((s) => [s.id, s]));
  const assigned = people.filter((p) => projectCrew.some((c) => c.personId === p.id));
  const open = projectCrew.filter((c) => !c.personId && subMap.get(c.subprojectId)?.status !== 'annule');

  const schedule = (p: Person) => projectCrew
    .filter((c) => c.personId === p.id)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((c) => {
      const sp = subMap.get(c.subprojectId);
      const pe = sp?.periods?.find((x) => x.id === c.periodId);
      return { c, sp, label: `${fmtRange(c.start, c.end)} — ${c.function} · ${sp?.name}${pe ? ` (${pe.name})` : ''}` };
    });

  const sendPlanning = (p: Person) => {
    const items = schedule(p);
    const body = `Bonjour ${p.name.split(' ')[0]},\n\nVoici ton planning pour « ${project.name} »${project.venue ? ` (${project.venue})` : ''} :\n\n${items.map((i) => '- ' + i.label).join('\n')}\n\n${project.notes ? project.notes + '\n\n' : ''}Merci de me confirmer ta disponibilité.\n${settings.company.name}`;
    location.href = `mailto:${p.email || ''}?subject=${encodeURIComponent(`Planning — ${project.name}`)}&body=${encodeURIComponent(body)}`;
  };
  const icsFor = (p: Person) => {
    const base = appBaseUrl(settings);
    download(`${project.number}-${p.name.replace(/\s+/g, '-')}.ics`, buildIcs(`${project.name} — ${p.name}`, schedule(p).map(({ c, sp }) => ({
      uid: c.id, title: `${c.function} — ${project.name}`, start: c.start, end: c.end, location: sp?.venue || project.venue, description: sp?.name, url: `${base}#/projets/${project.id}`,
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
        </div>
        {assigned.length === 0 ? <Empty>Personne n'est encore affecté. Crée des postes dans les salles ci-dessous, puis choisis qui les occupe.</Empty> : (
          <table className="list">
            <tbody>
              {assigned.map((p) => (
                <tr key={p.id}>
                  <td style={{ width: 200 }}><strong>{p.name}</strong><div className="muted">{p.role}{p.external ? ' · externe' : ''}</div></td>
                  <td>{schedule(p).map((i) => <div key={i.c.id} style={{ fontSize: 12 }}>{i.label}</div>)}</td>
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
  const updCrew = (c: CrewAssignment, patch: Partial<CrewAssignment>) => save(db.crew, { ...c, ...patch });
  const updVa = (v: VehicleAssignment, patch: Partial<VehicleAssignment>) => save(db.vehicleAssignments, { ...v, ...patch });
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
              <thead><tr><th>Fonction</th>{periods.length > 0 && <th>Créneau</th>}<th>Personne</th><th>Début</th><th>Fin</th><th>Facturé/j</th><th>Coût/j</th><th>Facturé</th><th className="n">Total</th><th /></tr></thead>
              <tbody>
                {crew.map((c) => {
                  const issue = personIssue(c.personId, c.start, c.end, c.id, d.crew, d.av.subs, d.unav);
                  return (
                    <tr key={c.id}>
                      <td><input value={c.function} onChange={(e) => updCrew(c, { function: e.target.value })} /></td>
                      {periods.length > 0 && <td><PeriodSelect value={c.periodId} onChange={(v) => updCrew(c, slot(v))} /></td>}
                      <td>
                        <select value={c.personId || ''} onChange={(e) => {
                          const person = pMap.get(e.target.value);
                          updCrew(c, { personId: e.target.value || undefined, rate: c.rate || person?.dailyRate || 0, cost: c.cost ?? person?.costRate });
                        }}>
                          <option value="">— à pourvoir —</option>
                          {d.people.map((x) => {
                            const why = personIssue(x.id, c.start, c.end, c.id, d.crew, d.av.subs, d.unav);
                            return <option key={x.id} value={x.id}>{x.name}{x.external ? ' (ext.)' : ''}{why ? ` — ${why}` : ''}</option>;
                          })}
                        </select>
                        {issue && <div className="avail ko">{issue === 'indisponible' ? 'Indisponible' : 'Déjà planifié ailleurs'}</div>}
                      </td>
                      <td><input type="datetime-local" value={c.start} onChange={(e) => updCrew(c, { start: e.target.value, periodId: undefined })} /></td>
                      <td><input type="datetime-local" value={c.end} onChange={(e) => updCrew(c, { end: e.target.value, periodId: undefined })} /></td>
                      <td><NumInput className="w-price" value={c.rate} onChange={(n) => updCrew(c, { rate: n })} /></td>
                      <td><NumInput className="w-price" value={c.cost ?? 0} onChange={(n) => updCrew(c, { cost: n })} /></td>
                      <td><input type="checkbox" checked={c.billable} onChange={(e) => updCrew(c, { billable: e.target.checked })} /></td>
                      <td className="n">{money(round2(daysBetween(c.start, c.end) * c.rate))}</td>
                      <td><button className="ghost" onClick={() => db.crew.delete(c.id)} aria-label="Retirer">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="toolbar" style={{ marginTop: 8 }}>
          <button className="small" onClick={() => save(db.crew, { projectId: sp.projectId, subprojectId: sp.id, function: 'Technicien', ...slot(undefined), rate: 0, billable: true })}>+ Poste</button>
          {periods.map((pe) => (
            <button key={pe.id} className="secondary small" onClick={() => save(db.crew, { projectId: sp.projectId, subprojectId: sp.id, function: 'Technicien', ...slot(pe.id), rate: 0, billable: true })}>+ Poste {pe.name}</button>
          ))}
        </div>

        <h3 style={{ margin: '16px 0 6px' }}>Transport</h3>
        {d.vehicles.length === 0 ? <Empty>Ajoute d'abord tes véhicules dans le menu Véhicules.</Empty> : (
          <>
            {vas.length > 0 && (
              <div className="table-wrap">
                <table className="list">
                  <thead><tr><th>Véhicule</th>{periods.length > 0 && <th>Créneau</th>}<th>Chauffeur</th><th>Début</th><th>Fin</th><th>Prix HT</th><th>Facturé</th><th /></tr></thead>
                  <tbody>
                    {vas.map((v) => (
                      <tr key={v.id}>
                        <td>
                          <select value={v.vehicleId} onChange={(e) => updVa(v, { vehicleId: e.target.value })}>
                            {d.vehicles.map((x) => <option key={x.id} value={x.id}>{x.name}{x.plate ? ` (${x.plate})` : ''}</option>)}
                          </select>
                          {vehicleBusy(v) && <div className="avail ko">Déjà réservé ailleurs</div>}
                        </td>
                        {periods.length > 0 && <td><PeriodSelect value={v.periodId} onChange={(p) => updVa(v, slot(p))} /></td>}
                        <td>
                          <select value={v.driverId || ''} onChange={(e) => updVa(v, { driverId: e.target.value || undefined })}>
                            <option value="">—</option>
                            {d.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                          </select>
                        </td>
                        <td><input type="datetime-local" value={v.start} onChange={(e) => updVa(v, { start: e.target.value, periodId: undefined })} /></td>
                        <td><input type="datetime-local" value={v.end} onChange={(e) => updVa(v, { end: e.target.value, periodId: undefined })} /></td>
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
              save(db.vehicleAssignments, { projectId: sp.projectId, subprojectId: sp.id, vehicleId: veh.id, ...slot(undefined), price: round2(veh.dailyPrice * daysBetween(bStart, bEnd)), billable: true });
            }}>+ Véhicule</button>
          </>
        )}
      </div>
    </div>
  );
}
