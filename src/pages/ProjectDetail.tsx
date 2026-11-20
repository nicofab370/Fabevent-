import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { PageHead } from '../components/ui';
import { appBaseUrl } from '../db';
import type { ProjectStatus, Subproject } from '../types';
import { STATUS_LABELS } from '../types';
import { buildIcs, deleteProject, download, fmtDate, fmtRange, money } from '../utils';
import { copyProject, recurrenceStarts, shiftBetween } from '../projectOps';
import { Field, Modal } from '../components/ui';
import type { Project } from '../types';
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
  const [repeat, setRepeat] = useState(false);
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

  const duplicate = async () => nav('/projets/' + (await copyProject(project.id)).id);
  const saveAsTemplate = async () => {
    const name = prompt('Nom du modèle :', project.name);
    if (!name) return;
    const t = await copyProject(project.id, { name, isTemplate: true, status: 'demande' });
    nav('/projets/' + t.id);
  };

  return (
    <>
      <PageHead title={`${project.number} · ${project.name}`}>
        {project.typeName && <span className="badge" style={{ background: project.color || undefined, color: project.color ? '#fff' : undefined }}>{project.typeName}</span>}
        <select value={project.status} onChange={(e) => setProjectStatus(d, e.target.value as ProjectStatus)} style={{ width: 'auto' }}>
          {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button className="secondary" onClick={duplicate}>Dupliquer</button>
        {!project.isTemplate && <button className="secondary" onClick={() => setRepeat(true)}>Répéter…</button>}
        {!project.isTemplate && <button className="secondary" onClick={saveAsTemplate}>Enregistrer comme modèle</button>}
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
          {conflicts.length > 0 && <div><strong>Manque de matériel :</strong> {Array.from(conflicts.reduce((m, c) => m.set(c.equipment.name, Math.max(m.get(c.equipment.name) || 0, c.shortage)), new Map<string, number>())).map(([n, q]) => `${n} (−${q})`).join(', ')} — <a href="#" onClick={(e) => { e.preventDefault(); goTab('souslocation'); }}>sous-louer</a></div>}
          {open > 0 && <div><strong>{open} poste(s) à pourvoir</strong> — <a href="#" onClick={(e) => { e.preventDefault(); goTab('equipe'); }}>planifier l'équipe</a></div>}
        </div>
      )}
      {project.isTemplate && (
        <div className="info" style={{ borderLeft: '4px solid #7c3aed' }}>
          <strong>Modèle de projet</strong> — il n'apparaît pas dans le planning et ne réserve rien. Utilise-le depuis « Projets → + Nouveau projet → À partir d'un modèle ».
        </div>
      )}
      {project.status === 'demande' && !project.isTemplate && <div className="info">Statut « Demande » : le matériel n'est pas encore bloqué. Passe en « Option » ou « Confirmé » pour le réserver.</div>}

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

      {repeat && <RepeatModal project={project} onClose={() => setRepeat(false)} />}
      {editSub && <SubprojectModal sp={editSub} project={project} onClose={() => setEditSub(null)} />}
    </>
  );
}

/** Crée des copies du projet à intervalle régulier (projets récurrents). */
function RepeatModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const nav = useNavigate();
  const [freq, setFreq] = useState<'semaine' | '2semaines' | 'mois'>('semaine');
  const [count, setCount] = useState(4);
  const [keepPeople, setKeepPeople] = useState(true);
  const [busy, setBusy] = useState(false);
  const starts = recurrenceStarts(project.start, freq, Math.max(1, Math.min(52, count)));
  return (
    <Modal title="Répéter le projet" onClose={onClose}>
      <form className="form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        for (const st of starts) await copyProject(project.id, { name: project.name, status: project.status === 'annule' ? 'demande' : project.status, shift: shiftBetween(project.start, st), keepPeople });
        setBusy(false);
        onClose();
        nav('/projets');
      }}>
        <Field label="Fréquence">
          <select value={freq} onChange={(e) => setFreq(e.target.value as typeof freq)}>
            <option value="semaine">Chaque semaine</option><option value="2semaines">Toutes les deux semaines</option><option value="mois">Chaque mois</option>
          </select>
        </Field>
        <Field label="Nombre de répétitions"><input type="number" min={1} max={52} value={count} onChange={(e) => setCount(parseInt(e.target.value) || 1)} /></Field>
        <Field label=" " full><label className="check-row"><input type="checkbox" checked={keepPeople} onChange={(e) => setKeepPeople(e.target.checked)} /> Garder les mêmes personnes sur les postes</label></Field>
        <div className="field full">
          <span>Nouvelles dates de début ({starts.length})</span>
          <div className="muted">{starts.map((s) => fmtDate(s)).join(' · ')}</div>
        </div>
        <div className="form-actions">
          <button type="button" className="secondary" onClick={onClose}>Annuler</button>
          <button type="submit" disabled={busy}>{busy ? 'Création…' : `Créer ${starts.length} projet(s)`}</button>
        </div>
      </form>
    </Modal>
  );
}
