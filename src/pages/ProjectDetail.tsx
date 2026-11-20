import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/ui';
import { appBaseUrl, db, nextNumber } from '../db';
import type { ProjectStatus, Subproject } from '../types';
import { STATUS_LABELS } from '../types';
import { buildIcs, deleteProject, download, fmtRange, money, nowIso, save, uid } from '../utils';
import CostsTab from './project/CostsTab';
import CrewTab from './project/CrewTab';
import EquipmentTab from './project/EquipmentTab';
import FinanceTab from './project/FinanceTab';
import GeneralTab from './project/GeneralTab';
import LogTab from './project/LogTab';
import PlanningTab, { SubprojectModal } from './project/PlanningTab';
import { useProjectData, type ProjectData } from './project/shared';
import { setProjectStatus } from './project/status';
import SubrentTab from './project/SubrentTab';

const TABS = [
  ['general', 'Général'],
  ['planning', 'Planning'],
  ['equipement', 'Équipement'],
  ['equipe', 'Équipe & transport'],
  ['couts', 'Coûts supplémentaires'],
  ['finances', 'Finances & documents'],
  ['souslocation', 'Sous-locations & commandes'],
  ['registre', 'Registre'],
] as const;

export default function ProjectDetail() {
  const { id } = useParams();
  const raw = useProjectData(id!);
  if (!raw.project || !raw.finance) return <p>Chargement…</p>;
  return <ProjectPage d={raw as ProjectData} />;
}

function ProjectPage({ d }: { d: ProjectData }) {
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('onglet') || 'general';
  const goTab = (t: string) => setParams(t === 'general' ? {} : { onglet: t }, { replace: true });
  const [editSub, setEditSub] = useState<Partial<Subproject> | null>(null);
  const { project, client, settings, subs, finance, conflicts, projectCrew } = d;
  const open = projectCrew.filter((c) => !c.personId).length;

  const exportIcs = () => {
    const base = appBaseUrl(settings);
    const events = subs.flatMap((sp) => (sp.periods?.length ? sp.periods : [{ id: sp.id, name: '', start: sp.start, end: sp.end }]).map((pe) => ({
      uid: pe.id, title: `${project.name} — ${sp.name}${pe.name ? ` · ${pe.name}` : ''}`, start: pe.start, end: pe.end,
      location: sp.venue || project.venue, description: `${project.number} · Statut : ${STATUS_LABELS[sp.status]}`, url: `${base}#/projets/${project.id}`,
    })));
    download(`${project.number}.ics`, buildIcs(project.name, events), 'text/calendar;charset=utf-8');
  };

  /** Copie complète : salles, horaires, groupes, matériel, postes (sans personnes), véhicules, coûts. */
  const duplicate = async () => {
    const np = await save(db.projects, { ...project, id: undefined, createdAt: undefined, number: await nextNumber('P'), name: project.name + ' (copie)', status: 'demande', tasks: project.tasks?.map((t) => ({ ...t, done: false })) });
    for (const sp of subs) {
      const idMap = new Map<string, string>();
      const periods = sp.periods?.map((p) => { const nid = uid(); idMap.set(p.id, nid); return { ...p, id: nid }; });
      const groups = sp.groups?.map((g) => { const nid = uid(); idMap.set(g.id, nid); return { ...g, id: nid, periodIds: g.periodIds.map((x) => idMap.get(x) || x) }; });
      const ns = await save(db.subprojects, { ...sp, id: undefined, createdAt: undefined, projectId: np.id, status: 'demande', periods, groups });
      const own = d.lines.filter((x) => x.subprojectId === sp.id);
      for (const l of own) idMap.set(l.id, uid());
      for (const l of own) {
        await db.lines.put({
          ...l, id: idMap.get(l.id)!, createdAt: nowIso(), updatedAt: nowIso(), projectId: np.id, subprojectId: ns.id, groupId: l.groupId ? idMap.get(l.groupId) : undefined,
          parentLineId: l.parentLineId ? idMap.get(l.parentLineId) : undefined, outQty: undefined, inQty: undefined, outSerials: undefined, inSerials: undefined, consumed: undefined,
        });
      }
      for (const c of projectCrew.filter((x) => x.subprojectId === sp.id)) await save(db.crew, { ...c, id: undefined, createdAt: undefined, projectId: np.id, subprojectId: ns.id, personId: undefined, periodId: c.periodId ? idMap.get(c.periodId) : undefined });
      for (const v of d.projectVas.filter((x) => x.subprojectId === sp.id)) await save(db.vehicleAssignments, { ...v, id: undefined, createdAt: undefined, projectId: np.id, subprojectId: ns.id, periodId: v.periodId ? idMap.get(v.periodId) : undefined });
    }
    for (const c of d.costs) await save(db.costs, { ...c, id: undefined, createdAt: undefined, projectId: np.id });
    nav('/projets/' + np.id);
  };

  return (
    <>
      <PageHead title={`${project.number} · ${project.name}`}>
        {project.typeName && <span className="badge" style={{ background: project.color || undefined, color: project.color ? '#fff' : undefined }}>{project.typeName}</span>}
        <select value={project.status} onChange={(e) => setProjectStatus(d, e.target.value as ProjectStatus)} style={{ width: 'auto' }}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="secondary" onClick={duplicate}>Dupliquer</button>
        <button className="secondary" onClick={exportIcs}>Agenda .ics</button>
        <button className="danger" onClick={async () => {
          if (confirm('Supprimer le projet, ses salles, ses documents et ses fichiers ?')) { await deleteProject(project.id); nav('/projets'); }
        }}>Supprimer</button>
      </PageHead>

      <div className="stats" style={project.color ? { borderLeft: `4px solid ${project.color}`, paddingLeft: 10 } : undefined}>
        <div className="stat"><b style={{ fontSize: 15 }}>{client?.company || '—'}</b><span>client{project.contactPerson && ` · ${project.contactPerson}`}</span></div>
        <div className="stat"><b style={{ fontSize: 15 }}>{fmtRange(project.start, project.end)}</b><span>{project.venue || 'lieu non défini'} · {subs.length} salle(s)</span></div>
        <div className="stat"><b>{money(finance.totalHT)}</b><span>total HT</span></div>
        <div className="stat"><b style={{ color: finance.margin < 0 ? 'var(--danger)' : undefined }}>{money(finance.margin)}</b><span>marge</span></div>
      </div>

      {(conflicts.length > 0 || open > 0) && (
        <div className="alert">
          {conflicts.length > 0 && <div><strong>Manque de matériel :</strong> {conflicts.map((c) => `${c.equipment.name} (−${c.shortage})`).join(', ')} — <a href="#" onClick={(e) => { e.preventDefault(); goTab('souslocation'); }}>sous-louer</a></div>}
          {open > 0 && <div><strong>{open} poste(s) à pourvoir</strong> — <a href="#" onClick={(e) => { e.preventDefault(); goTab('equipe'); }}>planifier l'équipe</a></div>}
        </div>
      )}
      {project.status === 'demande' && <div className="info">Statut « Demande » : le matériel n'est pas encore bloqué. Passe en « Option » ou « Confirmé » pour le réserver.</div>}

      <div className="tabs project-tabs">
        {TABS.map(([k, label]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => goTab(k)}>{label}</button>)}
      </div>

      {tab === 'general' && <GeneralTab d={d} goTab={goTab} />}
      {tab === 'planning' && <PlanningTab d={d} onEditSub={setEditSub} />}
      {tab === 'equipement' && <EquipmentTab d={d} />}
      {tab === 'equipe' && <CrewTab d={d} />}
      {tab === 'couts' && <CostsTab d={d} />}
      {tab === 'finances' && <FinanceTab d={d} />}
      {tab === 'souslocation' && <SubrentTab d={d} />}
      {tab === 'registre' && <LogTab projectId={project.id} />}

      {editSub && <SubprojectModal sp={editSub} project={project} onClose={() => setEditSub(null)} />}
    </>
  );
}
