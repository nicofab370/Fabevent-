import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Empty, Field, Modal, NumInput, PageHead, StatusBadge, useSettings } from '../components/ui';
import { useAvailability } from '../data';
import { appBaseUrl, db, nextNumber } from '../db';
import { createDocument } from '../documents';
import type {
  CrewAssignment, DocType, Equipment, EquipmentLine, Person, Project, ProjectStatus, Settings, Subproject, Unavailability, Vehicle,
  VehicleAssignment,
} from '../types';
import { DOC_LABELS, DOC_STATUS_LABELS, INVOICE_TYPES, RESERVING, STATUS_LABELS, SUBRENT_LABELS } from '../types';
import {
  availableQty, blockPeriod, buildIcs, daysBetween, deleteProject, deleteSubproject, download, factorFor, fmtDate, fmtRange,
  lineTotal, money, nowIso, overlaps, round2, save, uid, type Reservation,
} from '../utils';
import { ProjectForm } from './Projects';

export default function ProjectDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const settings = useSettings();
  const av = useAvailability();
  const project = useLiveQuery(() => db.projects.get(id!), [id]);
  const client = useLiveQuery(() => (project?.clientId ? db.contacts.get(project.clientId) : undefined), [project?.clientId]);
  const subs = useLiveQuery(() => db.subprojects.where({ projectId: id! }).sortBy('order'), [id]) || [];
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const people = useLiveQuery(() => db.people.orderBy('name').toArray(), []) || [];
  const unav = useLiveQuery(() => db.unavailability.toArray(), []) || [];
  const vehicles = useLiveQuery(() => db.vehicles.orderBy('name').toArray(), []) || [];
  const vas = useLiveQuery(() => db.vehicleAssignments.toArray(), []) || [];
  const docs = useLiveQuery(() => db.docs.where({ projectId: id! }).reverse().sortBy('createdAt'), [id]) || [];
  const costs = useLiveQuery(() => db.costs.where({ projectId: id! }).toArray(), [id]) || [];
  const [tab, setTab] = useState<'subs' | 'docs' | 'finance'>('subs');
  const [editing, setEditing] = useState(false);
  const [editSub, setEditSub] = useState<Partial<Subproject> | null>(null);
  const [busy, setBusy] = useState(false);

  if (!project) return <p>Chargement…</p>;

  const { equipment, res, lines, subs: allSubs } = av;
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const projectLines = lines.filter((l) => l.projectId === project.id);
  const conflicts = av.conflicts().filter((c) => c.projectId === project.id);
  const subrentals = av.subrentals.filter((s) => s.projectId === project.id);
  const subTotals = subs.map((sp) => subTotal(sp, projectLines, crew, vas, settings, eqMap));
  const gross = round2(subTotals.reduce((a, b) => a + b, 0));
  const totalHT = round2(gross * (1 - project.discount / 100));

  const setStatus = async (status: ProjectStatus) => {
    await db.transaction('rw', [db.projects, db.subprojects, db.lines, db.equipment], async () => {
      await save(db.projects, { ...project, status });
      for (const sp of subs) if (sp.status !== 'annule' || status === 'annule') await save(db.subprojects, { ...sp, status });
      // Projet terminé : les consommables sortent définitivement du stock
      if (status === 'termine') {
        for (const l of projectLines) {
          const e = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
          if (e?.kind === 'vente' && !l.consumed && !l.optional) {
            const fresh = await db.equipment.get(e.id);
            if (fresh) await save(db.equipment, { ...fresh, quantity: Math.max(0, fresh.quantity - (l.outQty ?? l.qty) + (l.inQty ?? 0)) });
            await save(db.lines, { ...l, consumed: true });
          }
        }
      }
    });
  };

  const generate = async (type: DocType) => {
    let percent: number | undefined;
    if (type === 'acompte') {
      const a = prompt("Pourcentage de l'acompte (calculé sur le dernier devis) :", '30');
      if (a === null) return;
      percent = parseFloat(a.replace(',', '.')) || 30;
    }
    setBusy(true);
    try {
      const d = await createDocument(project.id, type, { percent });
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
      const idMap = new Map<string, string>();
      for (const l of projectLines.filter((x) => x.subprojectId === sp.id)) idMap.set(l.id, uid());
      for (const l of projectLines.filter((x) => x.subprojectId === sp.id)) {
        await db.lines.put({
          ...l, id: idMap.get(l.id)!, createdAt: nowIso(), updatedAt: nowIso(), projectId: np.id, subprojectId: ns.id,
          parentLineId: l.parentLineId ? idMap.get(l.parentLineId) : undefined, outQty: undefined, inQty: undefined, outSerials: undefined, inSerials: undefined, consumed: undefined,
        });
      }
      for (const c of crew.filter((x) => x.subprojectId === sp.id)) await save(db.crew, { ...c, id: undefined, createdAt: undefined, projectId: np.id, subprojectId: ns.id, personId: undefined });
    }
    nav('/projets/' + np.id);
  };

  /** Crée une demande de sous-location pour couvrir les manques d'un sous-projet. */
  const subrentShortages = async (subprojectId: string) => {
    const sp = subs.find((s) => s.id === subprojectId)!;
    const items = conflicts.filter((c) => c.subprojectId === subprojectId);
    const [start, end] = blockPeriod(sp);
    const sr = await save(db.subrentals, {
      number: await nextNumber('SL'), projectId: project.id, subprojectId, status: 'demande', start, end,
      lines: items.map((c) => ({ equipmentId: c.equipment.id, name: c.equipment.name, qty: c.shortage, cost: 0 })),
    });
    nav('/souslocations/' + sr.id);
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
        <div className="stat"><b style={{ fontSize: 15 }}>{client?.company || '—'}</b><span>client{project.contactPerson && ` · ${project.contactPerson}`}</span></div>
        <div className="stat"><b style={{ fontSize: 15 }}>{fmtRange(project.start, project.end)}</b><span>{project.venue || 'lieu non défini'}</span></div>
        <div className="stat"><b>{money(totalHT)}</b><span>total HT estimé{project.discount ? ` (remise ${project.discount} %)` : ''}</span></div>
        <div className="stat"><b>{docs.length}</b><span>documents générés</span></div>
      </div>

      {conflicts.length > 0 && (
        <div className="alert">
          <strong>Manque de matériel :</strong>{' '}
          {conflicts.map((c, i) => <span key={i}>{c.equipment.name} (−{c.shortage}){i < conflicts.length - 1 ? ', ' : ''}</span>)}
          <div style={{ marginTop: 6 }}>
            {Array.from(new Set(conflicts.map((c) => c.subprojectId))).map((sid) => (
              <button key={sid} className="small" style={{ marginRight: 6 }} onClick={() => subrentShortages(sid)}>
                Sous-louer le manque — {subs.find((s) => s.id === sid)?.name}
              </button>
            ))}
          </div>
        </div>
      )}
      {subrentals.length > 0 && (
        <div className="info">
          Sous-locations : {subrentals.map((s) => (
            <Link key={s.id} to={'/souslocations/' + s.id} style={{ marginRight: 10 }}>{s.number} ({SUBRENT_LABELS[s.status]})</Link>
          ))}
        </div>
      )}
      {project.status === 'demande' && (
        <div className="info">Statut « Demande » : le matériel n'est pas encore bloqué. Passe en « Option » ou « Confirmé » pour le réserver.</div>
      )}

      <div className="tabs">
        <button className={tab === 'subs' ? 'on' : ''} onClick={() => setTab('subs')}>Sous-projets ({subs.length})</button>
        <button className={tab === 'docs' ? 'on' : ''} onClick={() => setTab('docs')}>Documents ({docs.length})</button>
        <button className={tab === 'finance' ? 'on' : ''} onClick={() => setTab('finance')}>Finances</button>
      </div>

      {tab === 'subs' && (
        <>
          {subs.map((sp, i) => (
            <SubprojectCard key={sp.id} sp={sp} total={subTotals[i]} settings={settings} equipment={equipment} res={res}
              lines={projectLines.filter((l) => l.subprojectId === sp.id).sort((a, b) => a.order - b.order)}
              crew={crew.filter((c) => c.subprojectId === sp.id)} allCrew={crew} allSubs={allSubs} people={people} unav={unav}
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
            {(['devis', 'acompte', 'facture', 'bon_sortie', 'feuille_route'] as DocType[]).map((t) => (
              <button key={t} disabled={busy} className={t === 'devis' ? '' : 'secondary'} onClick={() => generate(t)}>+ {DOC_LABELS[t]}</button>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            Chaque génération crée un nouveau document figé : rien n'est jamais écrasé. La facture finale déduit automatiquement les acomptes.
            Les avoirs se créent depuis la facture concernée. La feuille de route (sans prix) est destinée aux sous-traitants et techniciens.
          </p>
          {docs.length === 0 ? <Empty>Aucun document pour l'instant.</Empty> : (
            <table className="list">
              <thead><tr><th>Type</th><th>Numéro</th><th>Version</th><th>Date</th><th className="n">Total HT</th><th>Statut</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="click" onClick={() => nav('/documents/' + d.id)}>
                    <td>{DOC_LABELS[d.type]}</td><td><strong>{d.number}</strong></td><td>{INVOICE_TYPES.includes(d.type) ? '' : `v${d.version}`}</td>
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

      {tab === 'finance' && (
        <Finance project={project} totalHT={totalHT} subs={subs} lines={projectLines} eqMap={eqMap}
          crew={crew.filter((c) => c.projectId === project.id)} people={people} costs={costs}
          subrentCost={subrentals.filter((s) => s.status !== 'annule').reduce((a, s) => a + s.lines.reduce((b, l) => b + l.cost, 0), 0)} />
      )}

      {editing && <Modal title="Modifier le projet" onClose={() => setEditing(false)}><ProjectForm initial={project} onDone={() => setEditing(false)} /></Modal>}
      {editSub && <SubprojectModal sp={editSub} project={project} onClose={() => setEditSub(null)} />}
    </>
  );
}

function isPerPiece(l: EquipmentLine, eqMap: Map<string, Equipment>) {
  return !!l.equipmentId && eqMap.get(l.equipmentId)?.kind === 'vente';
}

function subTotal(sp: Subproject, lines: EquipmentLine[], crew: CrewAssignment[], vas: VehicleAssignment[], s: Settings, eqMap: Map<string, Equipment>) {
  if (sp.status === 'annule') return 0;
  const days = daysBetween(sp.start, sp.end);
  return round2(
    lines.filter((l) => l.subprojectId === sp.id && !l.optional).reduce((a, l) => a + lineTotal(l, days, s, isPerPiece(l, eqMap)), 0) +
    crew.filter((c) => c.subprojectId === sp.id && c.billable).reduce((a, c) => a + daysBetween(c.start, c.end) * c.rate, 0) +
    vas.filter((v) => v.subprojectId === sp.id && v.billable).reduce((a, v) => a + v.price, 0),
  );
}

function Finance({ project, totalHT, subs, lines, eqMap, crew, people, costs, subrentCost }: {
  project: Project; totalHT: number; subs: Subproject[]; lines: EquipmentLine[]; eqMap: Map<string, Equipment>; crew: CrewAssignment[];
  people: Person[]; costs: { id: string; label: string; amount: number }[]; subrentCost: number;
}) {
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState(0);
  const active = new Set(subs.filter((s) => s.status !== 'annule').map((s) => s.id));
  const pMap = new Map(people.map((p) => [p.id, p]));
  const crewCost = round2(crew.filter((c) => active.has(c.subprojectId)).reduce((a, c) => {
    const rate = c.cost ?? (c.personId ? pMap.get(c.personId)?.costRate : undefined) ?? 0;
    return a + daysBetween(c.start, c.end) * rate;
  }, 0));
  const consumables = round2(lines.filter((l) => active.has(l.subprojectId) && !l.optional && l.equipmentId && eqMap.get(l.equipmentId)?.kind === 'vente')
    .reduce((a, l) => a + l.qty * (eqMap.get(l.equipmentId!)?.costPrice || 0), 0));
  const other = round2(costs.reduce((a, c) => a + c.amount, 0));
  const total = round2(crewCost + consumables + subrentCost + other);
  const margin = round2(totalHT - total);
  return (
    <div className="card">
      <div className="stats">
        <div className="stat"><b>{money(totalHT)}</b><span>chiffre d'affaires HT</span></div>
        <div className="stat"><b>{money(total)}</b><span>coûts</span></div>
        <div className="stat"><b style={{ color: margin < 0 ? 'var(--danger)' : 'var(--ok)' }}>{money(margin)}</b><span>marge {totalHT ? `(${Math.round(margin / totalHT * 100)} %)` : ''}</span></div>
      </div>
      <table className="list">
        <tbody>
          <tr><td>Personnel (coût journalier des personnes ou du poste)</td><td className="n">{money(crewCost)}</td><td /></tr>
          <tr><td>Sous-locations</td><td className="n">{money(subrentCost)}</td><td /></tr>
          <tr><td>Consommables (prix d'achat)</td><td className="n">{money(consumables)}</td><td /></tr>
          {costs.map((c) => (
            <tr key={c.id}><td>{c.label}</td><td className="n">{money(c.amount)}</td><td><button className="ghost" onClick={() => db.costs.delete(c.id)} aria-label="Retirer">✕</button></td></tr>
          ))}
        </tbody>
      </table>
      <form className="toolbar" style={{ marginTop: 10 }} onSubmit={async (e) => {
        e.preventDefault();
        if (!label.trim()) return;
        await save(db.costs, { projectId: project.id, label: label.trim(), amount });
        setLabel(''); setAmount(0);
      }}>
        <input placeholder="Autre coût (carburant, hôtel, péage…)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <NumInput value={amount} onChange={setAmount} className="w-price" />
        <button className="small" type="submit">+ Ajouter</button>
      </form>
    </div>
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
        await save(db.subprojects, { ...d, prepStart: d.prepStart || undefined, returnEnd: d.returnEnd || undefined } as Subproject);
        onClose();
      }}>
        <Field label="Nom *" full><input required autoFocus value={d.name || ''} onChange={(e) => set('name', e.target.value)} placeholder="ex. Montage, Concert, Démontage, Salle B" /></Field>
        <Field label="Préparation dès (facultatif)"><input type="datetime-local" value={d.prepStart || ''} onChange={(e) => set('prepStart', e.target.value)} /></Field>
        <Field label="Retour au dépôt jusqu'à (facultatif)"><input type="datetime-local" value={d.returnEnd || ''} onChange={(e) => set('returnEnd', e.target.value)} /></Field>
        <Field label="Début d'utilisation (facturé)"><input type="datetime-local" required value={d.start || ''} onChange={(e) => set('start', e.target.value)} /></Field>
        <Field label="Fin d'utilisation (facturé)"><input type="datetime-local" required value={d.end || ''} onChange={(e) => set('end', e.target.value)} /></Field>
        <Field label="Lieu"><input value={d.venue || ''} onChange={(e) => set('venue', e.target.value)} placeholder={project.venue} /></Field>
        <Field label="Statut">
          <select value={d.status} onChange={(e) => set('status', e.target.value as ProjectStatus)}>
            {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <p className="muted field full" style={{ margin: 0 }}>Le matériel est bloqué de la préparation au retour ; seule la période d'utilisation est facturée.</p>
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
  crew: CrewAssignment[]; allCrew: CrewAssignment[]; allSubs: Subproject[]; people: Person[]; unav: Unavailability[]; vehicles: Vehicle[];
  vas: VehicleAssignment[]; allVas: VehicleAssignment[]; onEdit: () => void;
}

function SubprojectCard(p: CardProps) {
  const { sp, settings, equipment, res } = p;
  const nav = useNavigate();
  const [tab, setTab] = useState<'eq' | 'crew' | 'veh'>('eq');
  const [picking, setPicking] = useState(false);
  const days = daysBetween(sp.start, sp.end);
  const [bStart, bEnd] = blockPeriod(sp);
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  const subMap = new Map(p.allSubs.map((s) => [s.id, s]));
  const weight = p.lines.reduce((a, l) => a + (l.equipmentId && !l.optional ? (eqMap.get(l.equipmentId)?.weight || 0) * l.qty : 0), 0);
  // accessoires juste sous leur ligne parente
  const ordered = [
    ...p.lines.filter((l) => !l.parentLineId || !p.lines.some((x) => x.id === l.parentLineId)).flatMap((l) => [l, ...p.lines.filter((c) => c.parentLineId === l.id)]),
  ];

  const updLine = async (l: EquipmentLine, patch: Partial<EquipmentLine>) => {
    await save(db.lines, { ...l, ...patch });
    // la quantité des accessoires suit celle de la ligne parente
    if (patch.qty !== undefined && l.equipmentId) {
      const acc = eqMap.get(l.equipmentId)?.accessories || [];
      for (const child of p.lines.filter((c) => c.parentLineId === l.id)) {
        const a = acc.find((x) => x.equipmentId === child.equipmentId);
        if (a) await save(db.lines, { ...child, qty: a.qty * patch.qty });
      }
    }
  };
  const removeLine = async (l: EquipmentLine) => {
    await db.lines.bulkDelete([l.id, ...p.lines.filter((c) => c.parentLineId === l.id).map((c) => c.id)]);
  };
  const updCrew = (c: CrewAssignment, patch: Partial<CrewAssignment>) => save(db.crew, { ...c, ...patch });
  const updVa = (v: VehicleAssignment, patch: Partial<VehicleAssignment>) => save(db.vehicleAssignments, { ...v, ...patch });

  /** Personne déjà prise ailleurs ou indisponible sur la période ? */
  const personIssue = (c: CrewAssignment) => {
    if (!c.personId) return '';
    if (p.unav.some((u) => u.personId === c.personId && overlaps(u.start, u.end, c.start, c.end))) return 'Indisponible';
    if (p.allCrew.some((o) => o.id !== c.id && o.personId === c.personId &&
      RESERVING.includes(subMap.get(o.subprojectId)?.status || 'annule') && overlaps(o.start, o.end, c.start, c.end))) return 'Déjà planifié ailleurs';
    return '';
  };
  const vehicleBusy = (v: VehicleAssignment) => p.allVas.some((o) => o.id !== v.id && o.vehicleId === v.vehicleId &&
    RESERVING.includes(subMap.get(o.subprojectId)?.status || 'annule') && overlaps(o.start, o.end, v.start, v.end));

  return (
    <div className="sub">
      <div className="sub-head">
        <div>
          <h3>{sp.name} <StatusBadge status={sp.status} /></h3>
          <div className="muted">
            {fmtRange(sp.start, sp.end)} · {days} j (coef. {factorFor(days, settings)}){sp.venue && ` · ${sp.venue}`}
            {(bStart !== sp.start || bEnd !== sp.end) && <div>Matériel bloqué : {fmtRange(bStart, bEnd)}</div>}
          </div>
        </div>
        <div className="actions">
          <strong>{money(p.total)} HT</strong>
          <button className="secondary small" onClick={() => nav('/entrepot/' + sp.id)}>Préparer / scanner</button>
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
            {ordered.length > 0 && (
              <div className="table-wrap">
                <table className="list">
                  <thead><tr><th>Qté</th><th>Désignation</th><th className="n">Dispo</th><th>P.U.</th><th>Remise %</th><th title="Ligne facultative proposée en option sur le devis">Option</th><th className="n">Total HT</th><th /></tr></thead>
                  <tbody>
                    {ordered.map((l) => {
                      const eq = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
                      const avail = eq ? availableQty(eq, equipment, res, bStart, bEnd, l.id) : null;
                      const perPiece = eq?.kind === 'vente';
                      return (
                        <tr key={l.id} style={l.optional ? { opacity: 0.6 } : undefined}>
                          <td><NumInput className="w-qty" step="1" min={0} value={l.qty} onChange={(n) => updLine(l, { qty: n })} /></td>
                          <td style={l.parentLineId ? { paddingLeft: 24 } : undefined}>
                            {l.parentLineId && <span className="muted">↳ </span>}
                            {eq ? <Link to={'/materiel/' + eq.id}>{l.name}</Link> : <input value={l.name} onChange={(e) => updLine(l, { name: e.target.value })} />}
                            {!eq && <span className="muted"> ligne libre</span>}
                            {perPiece && <span className="badge" style={{ marginLeft: 6 }}>vente</span>}
                          </td>
                          <td className="n">{avail === null ? '—' : <span className={'avail ' + (avail >= l.qty || l.optional ? 'ok' : 'ko')}>{avail}</span>}</td>
                          <td><NumInput className="w-price" value={l.unitPrice} onChange={(n) => updLine(l, { unitPrice: n })} /></td>
                          <td><NumInput className="w-qty" value={l.discount} onChange={(n) => updLine(l, { discount: n })} /></td>
                          <td><input type="checkbox" checked={!!l.optional} onChange={(e) => updLine(l, { optional: e.target.checked })} /></td>
                          <td className="n">{money(lineTotal(l, days, settings, perPiece))}</td>
                          <td><button className="ghost" onClick={() => removeLine(l)} aria-label="Retirer">✕</button></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="toolbar" style={{ marginTop: 8 }}>
              <button className="small" onClick={() => setPicking(true)}>+ Ajouter du matériel</button>
              <button className="secondary small" onClick={() => save(db.lines, { projectId: sp.projectId, subprojectId: sp.id, name: 'Prestation', qty: 1, unitPrice: 0, discount: 0, order: p.lines.length })}>+ Ligne libre</button>
              {weight > 0 && <span className="muted" style={{ alignSelf: 'center' }}>Poids total : {round2(weight)} kg</span>}
            </div>
          </>
        )}

        {tab === 'crew' && (
          <>
            {p.crew.length > 0 && (
              <div className="table-wrap">
                <table className="list">
                  <thead><tr><th>Fonction</th><th>Personne</th><th>Début</th><th>Fin</th><th>Facturé/j</th><th>Coût/j</th><th>Facturé</th><th className="n">Total</th><th /></tr></thead>
                  <tbody>
                    {p.crew.map((c) => {
                      const issue = personIssue(c);
                      return (
                        <tr key={c.id}>
                          <td><input value={c.function} onChange={(e) => updCrew(c, { function: e.target.value })} /></td>
                          <td>
                            <select value={c.personId || ''} onChange={(e) => {
                              const person = p.people.find((x) => x.id === e.target.value);
                              updCrew(c, { personId: e.target.value || undefined, rate: c.rate || person?.dailyRate || 0, cost: c.cost ?? person?.costRate });
                            }}>
                              <option value="">— à pourvoir —</option>
                              {p.people.map((x) => <option key={x.id} value={x.id}>{x.name}{x.external ? ' (ext.)' : ''}</option>)}
                            </select>
                            {issue && <div className="avail ko">{issue}</div>}
                          </td>
                          <td><input type="datetime-local" value={c.start} onChange={(e) => updCrew(c, { start: e.target.value })} /></td>
                          <td><input type="datetime-local" value={c.end} onChange={(e) => updCrew(c, { end: e.target.value })} /></td>
                          <td><NumInput className="w-price" value={c.rate} onChange={(n) => updCrew(c, { rate: n })} /></td>
                          <td><NumInput className="w-price" value={c.cost ?? 0} onChange={(n) => updCrew(c, { cost: n })} /></td>
                          <td><input type="checkbox" checked={c.billable} onChange={(e) => updCrew(c, { billable: e.target.checked })} /></td>
                          <td className="n">{money(daysBetween(c.start, c.end) * c.rate)}</td>
                          <td><button className="ghost" onClick={() => db.crew.delete(c.id)} aria-label="Retirer">✕</button></td>
                        </tr>
                      );
                    })}
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
                  save(db.vehicleAssignments, { projectId: sp.projectId, subprojectId: sp.id, vehicleId: veh.id, start: bStart, end: bEnd, price: round2(veh.dailyPrice * days), billable: true });
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

/** Ajoute des articles (et leurs accessoires automatiques) à un sous-projet. */
export async function addEquipmentToSub(sp: Subproject, equipment: Equipment[], existing: EquipmentLine[], items: Record<string, number>) {
  const eqMap = new Map(equipment.map((e) => [e.id, e]));
  let order = existing.length;
  const t = nowIso();
  for (const [eqId, n] of Object.entries(items)) {
    if (!n) continue;
    const eq = eqMap.get(eqId);
    if (!eq) continue;
    const same = existing.find((l) => l.equipmentId === eqId && !l.parentLineId && !l.optional);
    let lineId: string;
    let total: number;
    if (same) {
      total = same.qty + n;
      lineId = same.id;
      await save(db.lines, { ...same, qty: total });
    } else {
      total = n;
      lineId = uid();
      await db.lines.put({ id: lineId, createdAt: t, updatedAt: t, projectId: sp.projectId, subprojectId: sp.id, equipmentId: eqId, name: eq.name, qty: n, unitPrice: eq.dailyPrice, discount: 0, order: order++ });
    }
    for (const a of eq.accessories || []) {
      const acc = eqMap.get(a.equipmentId);
      if (!acc) continue;
      const child = existing.find((l) => l.parentLineId === lineId && l.equipmentId === a.equipmentId);
      if (child) await save(db.lines, { ...child, qty: a.qty * total });
      else await db.lines.put({ id: uid(), createdAt: t, updatedAt: t, projectId: sp.projectId, subprojectId: sp.id, equipmentId: acc.id, name: acc.name, qty: a.qty * total, unitPrice: a.free ? 0 : acc.dailyPrice, discount: 0, order: order++, parentLineId: lineId });
    }
  }
}

function EquipmentPicker({ sp, equipment, res, existing, onClose }: { sp: Subproject; equipment: Equipment[]; res: Reservation[]; existing: EquipmentLine[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const units = useLiveQuery(() => db.units.toArray(), []) || [];
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const [bStart, bEnd] = blockPeriod(sp);
  const list = equipment.filter((e) => [e.name, e.code, e.barcode, e.categoryId && catName.get(e.categoryId)].join(' ').toLowerCase().includes(q.toLowerCase()));

  const add = async () => {
    await addEquipmentToSub(sp, equipment, existing, qty);
    onClose();
  };
  const count = Object.values(qty).reduce((a, b) => a + (b || 0), 0);

  return (
    <Modal title={`Ajouter du matériel — ${sp.name}`} onClose={onClose} wide>
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
                const avail = availableQty(e, equipment, res, bStart, bEnd);
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
        <button disabled={!count} onClick={add}>Ajouter {count > 0 ? `(${count})` : ''}</button>
      </div>
    </Modal>
  );
}
