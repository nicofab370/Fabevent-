import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead, StatusBadge, useSettings } from '../components/ui';
import { appBaseUrl, db, nextNumber } from '../db';
import { createDocument } from '../documents';
import type { CrewAssignment, DocType, Equipment, EquipmentLine, Person, Project, ProjectStatus, Settings, Subproject, Vehicle, VehicleAssignment } from '../types';
import { DOC_LABELS, DOC_STATUS_LABELS, RESERVING, STATUS_LABELS } from '../types';
import {
  availableQty, buildIcs, buildReservations, daysBetween, deleteProject, factorFor, deleteSubproject, download, findConflicts, fmtDate,
  fmtRange, lineTotal, money, overlaps, round2, save, uid, type Reservation,
} from '../utils';
import { ProjectForm } from './Projects';

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const project = useLiveQuery(() => db.projects.get(id!), [id]);
  const client = useLiveQuery(() => (project?.clientId ? db.contacts.get(project.clientId) : undefined), [project?.clientId]);
  const subs = useLiveQuery(() => db.subprojects.where({ projectId: id! }).sortBy('order'), [id]) || [];
  const lines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const allSubs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const equipment = useLiveQuery(() => db.equipment.orderBy('name').toArray(), []) || [];
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const people = useLiveQuery(() => db.people.orderBy('name').toArray(), []) || [];
  const vehicles = useLiveQuery(() => db.vehicles.orderBy('name').toArray(), []) || [];
  const vas = useLiveQuery(() => db.vehicleAssignments.toArray(), []) || [];
  const docs = useLiveQuery(() => db.docs.where({ projectId: id! }).reverse().sortBy('createdAt'), [id]) || [];
  const [tab, setTab] = useState<'subs' | 'docs'>('subs');
  const [editing, setEditing] = useState(false);
  const [editSub, setEditSub] = useState<Partial<Subproject> | null>(null);
  const [busy, setBusy] = useState(false);

  if (!project) return <p>Chargement…</p>;

  const res = buildReservations(lines, allSubs, equipment);
  const conflicts = findConflicts(lines, allSubs, equipment).filter((c) => c.projectId === project.id);
  const subTotals = subs.map((sp) => subTotal(sp, lines, crew, vas, settings));
  const gross = round2(subTotals.reduce((a, b) => a + b, 0));
  const totalHT = round2(gross * (1 - project.discount / 100));

  const setStatus = async (status: ProjectStatus) => {
    await db.transaction('rw', db.projects, db.subprojects, async () => {
      await save(db.projects, { ...project, status });
      for (const sp of subs) if (sp.status !== 'annule' || status === 'annule') await save(db.subprojects, { ...sp, status });
    });
  };

  const generate = async (type: DocType) => {
    setBusy(true);
    try {
      const d = await createDocument(project.id, type);
      nav('/documents/' + d.id);
    } finally { setBusy(false); }
  };

  const exportIcs = () => {
    const base = appBaseUrl(settings);
    const events = subs.map((sp) => ({
      uid: sp.id, title: `${project.number} ${project.name} — ${sp.name}`, start: sp.start, end: sp.end,
      location: sp.venue || project.venue, description: `Statut : ${STATUS_LABELS[sp.status]}`, url: `${base}#/projets/${project.id}`,
    }));
    download(`${project.number}.ics`, buildIcs(project.name, events), 'text/calendar;charset=utf-8');
  };

  const duplicate = async () => {
    const number = await nextNumber('P');
    const np = await save(db.projects, { ...project, id: undefined, createdAt: undefined, number, name: project.name + ' (copie)', status: 'demande' });
    for (const sp of subs) {
      const ns = await save(db.subprojects, { ...sp, id: undefined, createdAt: undefined, projectId: np.id, status: 'demande' });
      for (const l of lines.filter((x) => x.subprojectId === sp.id)) await save(db.lines, { ...l, id: undefined, createdAt: undefined, projectId: np.id, subprojectId: ns.id });
      for (const c of crew.filter((x) => x.subprojectId === sp.id)) await save(db.crew, { ...c, id: undefined, createdAt: undefined, projectId: np.id, subprojectId: ns.id, personId: undefined });
    }
    nav('/projets/' + np.id);
  };

  return (
    <>
      <PageHead title={`${project.number} · ${project.name}`}>
        <select value={project.status} onChange={(e) => setStatus(e.target.value as ProjectStatus)} style={{ width: 'auto' }}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="secondary" onClick={() => setEditing(true)}>Modifier</button>
        <button className="secondary" onClick={duplicate}>Dupliquer</button>
        <button className="secondary" onClick={exportIcs}>Agenda .ics</button>
        <button className="danger" onClick={async () => {
          if (confirm('Supprimer le projet, ses sous-projets et ses documents ?')) { await deleteProject(project.id); nav('/projets'); }
        }}>Supprimer</button>
      </PageHead>

      <div className="stats">
        <div className="stat"><b style={{ fontSize: 15 }}>{client?.company || '—'}</b><span>client</span></div>
        <div className="stat"><b style={{ fontSize: 15 }}>{fmtRange(project.start, project.end)}</b><span>{project.venue || 'lieu non défini'}</span></div>
        <div className="stat"><b>{money(totalHT)}</b><span>total HT estimé{project.discount ? ` (remise ${project.discount} %)` : ''}</span></div>
        <div className="stat"><b>{docs.length}</b><span>documents générés</span></div>
      </div>

      {conflicts.length > 0 && (
        <div className="alert">
          <strong>Manque de matériel :</strong>{' '}
          {conflicts.map((c, i) => <span key={i}>{c.equipment.name} (−{c.shortage}){i < conflicts.length - 1 ? ', ' : ''}</span>)}
          {project.status === 'demande' ? '' : ' — pense à sous-louer ou ajuster les quantités.'}
        </div>
      )}
      {!RESERVING.includes(project.status) && project.status !== 'annule' && project.status !== 'termine' && (
        <div className="info">Statut « {STATUS_LABELS[project.status]} » : le matériel n'est pas encore bloqué. Passe en « Option » ou « Confirmé » pour le réserver.</div>
      )}

      <div className="tabs">
        <button className={tab === 'subs' ? 'on' : ''} onClick={() => setTab('subs')}>Sous-projets ({subs.length})</button>
        <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>Documents ({docs.length})</button>
      </div>

      {tab === 'subs' && (
        <>
          {subs.map((sp, i) => (
            <SubprojectCard key={sp.id} sp={sp} total={subTotals[i]} settings={settings} equipment={equipment} res={res}
              lines={lines.filter((l) => l.subprojectId === sp.id).sort((a, b) => a.order - b.order)}
              crew={crew.filter((c) => c.subprojectId === sp.id)} allCrew={crew} allSubs={allSubs} people={people}
              vehicles={vehicles} vas={vas.filter((v) => v.subprojectId === sp.id)} allVas={vas}
              onEdit={() => setEditSub(sp)} />
          ))}
          <button className="secondary" onClick={() => setEditSub({ projectId: project.id, name: `Sous-projet ${subs.length + 1}`, status: project.status, start: project.start, end: project.end, venue: project.venue, order: subs.length })}>
            + Ajouter un sous-projet
          </button>
        </>
      )}

      {tab === 'docs' && (
        <div className="card">
          <div className="toolbar">
            {(Object.keys(DOC_LABELS) as DocType[]).map((t) => (
              <button key={t} disabled={busy} className={t === 'devis' ? '' : 'secondary'} onClick={() => generate(t)}>+ {DOC_LABELS[t]}</button>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Chaque génération crée un nouveau document figé : les versions précédentes ne sont jamais écrasées.
            La feuille de route (sans prix) est destinée aux sous-traitants et techniciens.
          </p>
          {docs.length === 0 ? <Empty>Aucun document pour l'instant.</Empty> : (
            <table className="list">
              <thead><tr><th>Type</th><th>Numéro</th><th>Version</th><th>Date</th><th className="n">Total HT</th><th>Statut</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="click" onClick={() => nav('/documents/' + d.id)}>
                    <td>{DOC_LABELS[d.type]}</td><td><strong>{d.number}</strong></td><td>v{d.version}</td>
                    <td>{fmtDate(d.createdAt)}</td>
                    <td className="n">{d.snapshot.hidePrices ? '—' : money(d.snapshot.totalHT)}</td>
                    <td><span className="badge">{DOC_STATUS_LABELS[d.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && <Modal title="Modifier le projet" onClose={() => setEditing(false)}><ProjectForm initial={project} onDone={() => setEditing(false)} /></Modal>}
      {editSub && <SubprojectModal sp={editSub} project={project} onClose={() => setEditSub(null)} />}
    </>
  );
}

function subTotal(sp: Subproject, lines: EquipmentLine[], crew: CrewAssignment[], vas: VehicleAssignment[], s: Settings) {
  if (sp.status === 'annule') return 0;
  const days = daysBetween(sp.start, sp.end);
  return round2(
    lines.filter((l) => l.subprojectId === sp.id).reduce((a, l) => a + lineTotal(l, days, s), 0) +
    crew.filter((c) => c.subprojectId === sp.id && c.billable).reduce((a, c) => a + daysBetween(c.start, c.end) * c.rate, 0) +
    vas.filter((v) => v.subprojectId === sp.id && v.billable).reduce((a, v) => a + v.price, 0),
  );
}

function SubprojectModal({ sp, project, onClose }: { sp: Partial<Subproject>; project: Project; onClose: () => void }) {
  const [d, setD] = useState(sp);
  const set = <K extends keyof Subproject>(k: K, v: Subproject[K]) => setD({ ...d, [k]: v });
  return (
    <Modal title={d.id ? 'Modifier le sous-projet' : 'Nouveau sous-projet'} onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        if ((d.end || '') < (d.start || '')) return alert('La fin doit être après le début.');
        await save(db.subprojects, d as Subproject);
        onClose();
      }}>
        <Field label="Nom *" full><input required autoFocus value={d.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="ex. Montage, Concert, Démontage, Salle B" /></Field>
        <Field label="Début"><input type="datetime-local" required value={d.start || ''} onChange={(e) => set('start', e.target.value)} /></Field>
        <Field label="Fin"><input type="datetime-local" required value={d.end || ''} onChange={(e) => set('end', e.target.value)} /></Field>
        <Field label="Lieu"><input value={d.venue || ''} onChange={(e) => set('venue', e.target.value)} placeholder={project.venue} /></Field>
        <Field label="Statut">
          <select value={d.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
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

interface CardProps {
  sp: Subproject; total: number; settings: Settings; equipment: Equipment[]; res: Reservation[]; lines: EquipmentLine[];
  crew: CrewAssignment[]; allCrew: CrewAssignment[]; allSubs: Subproject[]; people: Person[]; vehicles: Vehicle[];
  vas: VehicleAssignment[]; allVas: VehicleAssignment[]; onEdit: () => void;
}

function SubprojectCard(p: CardProps) {
  const { sp, settings, equipment, res } = p;
  const [tab, setTab] = useState<'eq' | 'crew' | 'veh'>('eq');
  const [picking, setPicking] = useState(false);
  const days = daysBetween(sp.start, sp.end);
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const subMap = new Map(p.allSubs.map((s) => [s.id, s]));
  const weight = p.lines.reduce((a, l) => a + (l.equipmentId ? (eqMap.get(l.equipmentId)?.weight || 0) * l.qty : 0), 0);

  const updLine = (l: EquipmentLine, patch: Partial<EquipmentLine>) => save(db.lines, { ...l, ...patch });
  const updCrew = (c: CrewAssignment, patch: Partial<CrewAssignment>) => save(db.crew, { ...c, ...patch });
  const updVa = (v: VehicleAssignment, patch: Partial<VehicleAssignment>) => save(db.vehicleAssignments, { ...v, ...patch });

  /** Personne déjà prise ailleurs sur la même période ? */
  const personBusy = (c: CrewAssignment) => c.personId && p.allCrew.some((o) => o.id !== c.id && o.personId === c.personId &&
    RESERVING.includes(subMap.get(o.subprojectId)?.status || 'annule') && overlaps(o.start, o.end, c.start, c.end));
  const vehicleBusy = (v: VehicleAssignment) => p.allVas.some((o) => o.id !== v.id && o.vehicleId === v.vehicleId &&
    RESERVING.includes(subMap.get(o.subprojectId)?.status || 'annule') && overlaps(o.start, o.end, v.start, v.end));

  return (
    <div className="sub">
      <div className="sub-head">
        <div>
          <h3>{sp.name} <StatusBadge status={sp.status} /></h3>
          <div className="muted">{fmtRange(sp.start, sp.end)} · {days} j (coef. {factorFor(days, settings)}){sp.venue && ` · ${sp.venue}`}</div>
        </div>
        <div className="actions">
          <strong>{money(p.total)} HT</strong>
          <button className="secondary small" onClick={p.onEdit}>Modifier</button>
        </div>
      </div>
      <div className="sub-body">
        <div className="tabs">
          <button className={tab === 'eq' ? 'on' : ''} onClick={() => setTab('eq')}>Matériel ({p.lines.length})</button>
          <button className={tab === 'crew' ? 'on' : ''} onClick={() => setTab('crew')}>Équipe ({p.crew.length})</button>
          <button className={tab === 'veh' ? 'on' : ''} onClick={() => setTab('veh')}>Transport ({p.vas.length})</button>
        </div>

        {tab === 'eq' && (
          <>
            {p.lines.length > 0 && (
              <div className="table-wrap">
                <table className="list">
                  <thead><tr><th>Qté</th><th>Désignation</th><th className="n">Dispo</th><th>P.U./j</th><th>Remise %</th><th className="n">Total HT</th><th /></tr></thead>
                  <tbody>
                    {p.lines.map((l) => {
                      const eq = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
                      const av = eq ? availableQty(eq, equipment, res, sp.start, sp.end, l.id) : null;
                      return (
                        <tr key={l.id}>
                          <td><NumInput className="w-qty" step="1" min={0} value={l.qty} onChange={(n) => updLine(l, { qty: n })} /></td>
                          <td>
                            {eq ? <Link to={'/materiel/' + eq.id}>{l.name}</Link> : <input value={l.name} onChange={(e) => updLine(l, { name: e.target.value })} />}
                            {!eq && <span className="muted"> ligne libre</span>}
                          </td>
                          <td className="n">{av === null ? '—' : <span className={'avail ' + (av >= l.qty ? 'ok' : 'ko')}>{av}</span>}</td>
                          <td><NumInput className="w-price" value={l.unitPrice} onChange={(n) => updLine(l, { unitPrice: n })} /></td>
                          <td><NumInput className="w-qty" value={l.discount} onChange={(n) => updLine(l, { discount: n })} /></td>
                          <td className="n">{money(lineTotal(l, days, settings))}</td>
                          <td><button className="ghost" onClick={() => db.lines.delete(l.id)} aria-label="Retirer">✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="small" onClick={() => setPicking(true)}>+ Ajouter du matériel</button>
              <button className="secondary small" onClick={() => save(db.lines, { projectId: sp.projectId, subprojectId: sp.id, name: 'Prestation / sous-location', qty: 1, unitPrice: 0, discount: 0, order: p.lines.length })}>+ Ligne libre</button>
              {weight > 0 && <span className="muted" style={{ alignSelf: 'center' }}>Poids total : {round2(weight)} kg</span>}
            </div>
          </>
        )}

        {tab === 'crew' && (
          <>
            {p.crew.length > 0 && (
              <div className="table-wrap">
                <table className="list">
                  <thead><tr><th>Fonction</th><th>Personne</th><th>Début</th><th>Fin</th><th>Tarif/j</th><th>Facturé</th><th className="n">Total</th><th /></tr></thead>
                  <tbody>
                    {p.crew.map((c) => (
                      <tr key={c.id}>
                        <td><input value={c.function} onChange={(e) => updCrew(c, { function: e.target.value })} /></td>
                        <td>
                          <select value={c.personId || ''} onChange={(e) => {
                            const person = p.people.find((x) => x.id === e.target.value);
                            updCrew(c, { personId: e.target.value || undefined, rate: c.rate || person?.dailyRate || 0 });
                          }}>
                            <option value="">— à pourvoir —</option>
                            {p.people.map((x) => <option key={x.id} value={x.id}>{x.name}{x.external ? ' (ext.)' : ''}</option>)}
                          </select>
                          {personBusy(c) && <div className="avail ko">Déjà planifié ailleurs</div>}
                        </td>
                        <td><input type="datetime-local" value={c.start} onChange={(e) => updCrew(c, { start: e.target.value })} /></td>
                        <td><input type="datetime-local" value={c.end} onChange={(e) => updCrew(c, { end: e.target.value })} /></td>
                        <td><NumInput className="w-price" value={c.rate} onChange={(n) => updCrew(c, { rate: n })} /></td>
                        <td><input type="checkbox" checked={c.billable} onChange={(e) => updCrew(c, { billable: e.target.checked })} /></td>
                        <td className="n">{money(daysBetween(c.start, c.end) * c.rate)}</td>
                        <td><button className="ghost" onClick={() => db.crew.delete(c.id)} aria-label="Retirer">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button className="small" style={{ marginTop: 8 }} onClick={() => save(db.crew, { projectId: sp.projectId, subprojectId: sp.id, function: 'Technicien', start: sp.start, end: sp.end, rate: 0, billable: true })}>
              + Ajouter un poste
            </button>
          </>
        )}

        {tab === 'veh' && (
          <>
            {p.vehicles.length === 0 ? <Empty>Ajoute d'abord tes véhicules dans le menu Véhicules.</Empty> : (
              <>
                {p.vas.length > 0 && (
                  <div className="table-wrap">
                    <table className="list">
                      <thead><tr><th>Véhicule</th><th>Chauffeur</th><th>Début</th><th>Fin</th><th>Prix HT</th><th>Facturé</th><th /></tr></thead>
                      <tbody>
                        {p.vas.map((v) => (
                          <tr key={v.id}>
                            <td>
                              <select value={v.vehicleId} onChange={(e) => updVa(v, { vehicleId: e.target.value })}>
                                {p.vehicles.map((x) => <option key={x.id} value={x.id}>{x.name}{x.plate ? ` (${x.plate})` : ''}</option>)}
                              </select>
                              {vehicleBusy(v) && <div className="avail ko">Déjà réservé ailleurs</div>}
                            </td>
                            <td>
                              <select value={v.driverId || ''} onChange={(e) => updVa(v, { driverId: e.target.value || undefined })}>
                                <option value="">—</option>
                                {p.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                              </select>
                            </td>
                            <td><input type="datetime-local" value={v.start} onChange={(e) => updVa(v, { start: e.target.value })} /></td>
                            <td><input type="datetime-local" value={v.end} onChange={(e) => updVa(v, { end: e.target.value })} /></td>
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
                  const veh = p.vehicles[0];
                  save(db.vehicleAssignments, { projectId: sp.projectId, subprojectId: sp.id, vehicleId: veh.id, start: sp.start, end: sp.end, price: round2(veh.dailyPrice * days), billable: true });
                }}>+ Ajouter un véhicule</button>
              </>
            )}
          </>
        )}
        {sp.notes && <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>{sp.notes}</p>}
      </div>
      {picking && <EquipmentPicker sp={sp} equipment={equipment} res={res} existing={p.lines} onClose={() => setPicking(false)} />}
    </div>
  );
}

function EquipmentPicker({ sp, equipment, res, existing, onClose }: { sp: Subproject; equipment: Equipment[]; res: Reservation[]; existing: EquipmentLine[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const list = equipment.filter((e) => [e.name, e.code, e.barcode, e.categoryId && catName.get(e.categoryId)].join(' ').toLowerCase().includes(q.toLowerCase()));

  const add = async () => {
    let order = existing.length;
    for (const [eqId, n] of Object.entries(qty)) {
      if (!n) continue;
      const eq = equipment.find((e) => e.id === eqId)!;
      const same = existing.find((l) => l.equipmentId === eqId);
      if (same) await save(db.lines, { ...same, qty: same.qty + n });
      else await db.lines.put({
        id: uid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), projectId: sp.projectId, subprojectId: sp.id,
        equipmentId: eqId, name: eq.name, qty: n, unitPrice: eq.dailyPrice, discount: 0, order: order++,
      });
    }
    onClose();
  };
  const count = Object.values(qty).reduce((a, b) => a + (b || 0), 0);

  return (
    <Modal title={`Ajouter du matériel — ${sp.name}`} onClose={onClose} wide>
      <div className="toolbar">
        <input autoFocus placeholder="Rechercher ou scanner un code-barres…" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return;
            const hit = equipment.find((x) => x.barcode && x.barcode === q.trim());
            if (hit) { setQty({ ...qty, [hit.id]: (qty[hit.id] || 0) + 1 }); setQ(''); }
          }} />
      </div>
      <div className="pick-list">
        {list.length === 0 ? <Empty>Aucun article.</Empty> : (
          <table className="list">
            <thead><tr><th>Article</th><th className="n">Dispo</th><th className="n">Prix/j</th><th>Qté</th></tr></thead>
            <tbody>
              {list.map((e) => {
                const av = availableQty(e, equipment, res, sp.start, sp.end);
                return (
                  <tr key={e.id}>
                    <td>{e.name} {e.isKit && <span className="badge">Kit</span>} <span className="muted">{e.code}</span></td>
                    <td className="n"><span className={'avail ' + (av - (qty[e.id] || 0) >= 0 ? 'ok' : 'ko')}>{av}</span></td>
                    <td className="n">{money(e.dailyPrice)}</td>
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
        <button disabled={!count} onClick={add}>Ajouter {count > 0 ? `(${count})` : ''}</button>
      </div>
    </Modal>
  );
}
