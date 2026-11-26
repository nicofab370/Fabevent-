import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, NumInput, PageHead, StatusBadge, useSettings } from '../components/ui';
import { db } from '../db';
import type { CrewAssignment, CrewFunction, Person, Project, Subproject, Unavailability } from '../types';
import { RESERVING } from '../types';
import { crewAmount, crewCostProfile, crewCostShown, fmtRange, functionRate, money, patch, round2, toLocalInput } from '../utils';
import { personIssue } from './project/shared';
import { PostRequests, closeFilledRequests, requestsFor, useCrewDialogs } from './crewRequests';
import type { CrewRequest } from '../types';
import { Icon } from '../components/Icon';
import { useUser } from '../auth';

/** Tout ce qu'il faut pour proposer des techniciens sur un poste. */
export interface CrewContext {
  people: Person[];
  allCrew: CrewAssignment[];
  subs: Subproject[];
  unav: Unavailability[];
  catalogue: CrewFunction[];
  /** demandes de disponibilité (réponses ✓ ✗ ⏳ affichées dans le choix du technicien) */
  requests?: CrewRequest[];
}

/** Candidats d'un poste : ceux qui ont répondu « dispo », puis les disponibles, du moins cher au plus cher ; les « pas dispo » à la fin. */
function candidates(c: CrewAssignment, ctx: CrewContext) {
  const answers = new Map(requestsFor(c.id, ctx.requests || []).map((x) => [x.r.personId, x.state]));
  const rank = (id: string) => (answers.get(id) === 'oui' ? 0 : answers.get(id) === 'non' ? 2 : 1);
  return ctx.people
    .filter((p) => !p.pending || p.id === c.personId)
    .map((p) => ({ p, issue: personIssue(p.id, c.start, c.end, c.id, ctx.allCrew, ctx.subs, ctx.unav), cost: crewCostShown({ rateUnit: c.rateUnit }, crewCostProfile(c, p)), answer: answers.get(p.id) }))
    .sort((a, b) => rank(a.p.id) - rank(b.p.id) || (a.issue ? 1 : 0) - (b.issue ? 1 : 0) || a.cost.value - b.cost.value || a.p.name.localeCompare(b.p.name));
}

/** Choix du technicien d'un poste. Le tarif client ne bouge pas ; le coût suit la personne. */
export function PersonSelect({ c, ctx }: { c: CrewAssignment; ctx: CrewContext }) {
  const issue = personIssue(c.personId, c.start, c.end, c.id, ctx.allCrew, ctx.subs, ctx.unav);
  return (
    <>
      <select aria-label="Technicien" value={c.personId || ''} onChange={(e) => {
        const p = ctx.people.find((x) => x.id === e.target.value);
        patch(db.crew, c.id, { personId: e.target.value || undefined, cost: undefined, detailsSentAt: undefined, rate: c.rate || functionRate(c.function, c.rateUnit, ctx.catalogue, p) || 0 })
          .then(() => closeFilledRequests(c.projectId));
      }}>
        <option value="">— à pourvoir —</option>
        {candidates(c, ctx).map(({ p, issue: why, cost, answer }) => (
          <option key={p.id} value={p.id}>{p.name}{p.external ? ' (ext.)' : ''} — {cost.value ? `${money(cost.value)}${cost.unit === 'heure' ? '/h' : '/j'}` : 'coût ?'}{why ? ` — ${why}` : ''}{answer === 'oui' ? ' — dispo' : answer === 'non' ? ' — pas dispo' : ''}</option>
        ))}
      </select>
      {issue && <div className="avail ko">{issue === 'indisponible' ? 'Indisponible' : 'Déjà planifié ailleurs'}</div>}
    </>
  );
}

/** Coût du poste (celui de la personne, modifiable), avec retour au coût de la personne. */
export function CostCell({ c, person }: { c: CrewAssignment; person?: Person }) {
  // coût de la personne dans son unité : seulement un prix horaire → à l'heure, seulement un forfait → à la journée
  const own = crewCostShown({ rateUnit: c.rateUnit }, crewCostProfile(c, person));
  const shown = crewCostShown(c, crewCostProfile(c, person));
  const unit = shown.unit === 'heure' ? '/h' : '/j';
  return (
    <>
      <NumInput className="w-price" value={shown.value} onChange={(n) => patch(db.crew, c.id, { cost: n, costUnit: shown.unit })} aria-label="Coût" />
      <span className="muted cost-unit">{unit}</span>
      {c.cost != null && (c.cost !== own.value || shown.unit !== own.unit) && (
        <button className="ghost small" title={`Revenir au coût de la personne (${money(own.value)}${own.unit === 'heure' ? '/h' : '/j'})`} onClick={() => patch(db.crew, c.id, { cost: undefined, costUnit: undefined })} aria-label="Revenir au coût de la personne"><Icon name="reset" /></button>
      )}
    </>
  );
}

/** Indisponibilités + rendez-vous hors projet (qui rendent leurs participants indisponibles). */
function useCrewContext(): CrewContext {
  const settings = useSettings();
  const people = useLiveQuery(() => db.people.orderBy('name').toArray(), []) || [];
  const allCrew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const unavailability = useLiveQuery(() => db.unavailability.toArray(), []) || [];
  const appointments = useLiveQuery(() => db.appointments.toArray(), []) || [];
  const requests = useLiveQuery(() => db.crewRequests.toArray(), []) || [];
  const unav = [...unavailability, ...appointments.flatMap((a) => (a.personIds || []).map((personId) => ({ ...a, personId, reason: a.title })))];
  return { people, allCrew, subs, unav, catalogue: settings.crewFunctions || [], requests };
}

/**
 * Attribution des techniciens, tous projets confondus : les postes prévus des semaines à venir,
 * jour par jour, avec les candidats disponibles et leur coût.
 */
export default function CrewAssignmentPage() {
  const settings = useSettings();
  const ctx = useCrewContext();
  // sous-traitant : uniquement ses propres postes
  const me = useUser();
  const myPersonId = me?.role === 'subcontractor' ? me.personId : undefined;
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const [weeks, setWeeks] = useState(6);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [fn, setFn] = useState('');
  const cd = useCrewDialogs();
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const sMap = new Map(ctx.subs.map((s) => [s.id, s]));
  const people = new Map(ctx.people.map((p) => [p.id, p]));
  const now = toLocalInput(new Date());
  const until = toLocalInput(new Date(Date.now() + weeks * 7 * 86400000));
  const posts = ctx.allCrew
    .filter((c) => {
      const sp = sMap.get(c.subprojectId);
      const p = pMap.get(c.projectId);
      return sp && p && !p.isTemplate && RESERVING.includes(sp.status) && c.end >= now && c.start <= until && (!onlyOpen || !c.personId || !!myPersonId) && (!fn || c.function === fn) && (!myPersonId || c.personId === myPersonId);
    })
    .sort((a, b) => a.start.localeCompare(b.start));
  const days = new Map<string, CrewAssignment[]>();
  for (const c of posts) days.set(c.start.slice(0, 10), [...(days.get(c.start.slice(0, 10)) || []), c]);
  const functions = Array.from(new Set(ctx.allCrew.map((c) => c.function))).sort();
  const openCount = ctx.allCrew.filter((c) => !c.personId && c.end >= now && RESERVING.includes(sMap.get(c.subprojectId)?.status || 'annule') && !pMap.get(c.projectId)?.isTemplate).length;

  return (
    <>
      <PageHead title={myPersonId ? 'Mon planning' : 'Attribution des techniciens'}>
        <select value={weeks} onChange={(e) => setWeeks(Number(e.target.value))} style={{ width: 'auto' }}>
          {[2, 4, 6, 12, 26].map((w) => <option key={w} value={w}>{w} semaines</option>)}
        </select>
      </PageHead>
      <div className="info">
        Les postes se prévoient dans chaque projet (onglet <em>Équipe & transport → Postes à prévoir</em>). Ici, tu attribues les techniciens :
        les disponibles d'abord, du moins cher au plus cher. {openCount} poste(s) à pourvoir au total.
      </div>
      <div className="toolbar">
        <label className="check-row"><input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> Seulement les postes à pourvoir <span className="muted">(décoche pour voir les postes pourvus et remplacer quelqu'un)</span></label>
        <select value={fn} onChange={(e) => setFn(e.target.value)} style={{ width: 'auto' }}>
          <option value="">Toutes les fonctions</option>
          {functions.map((f) => <option key={f}>{f}</option>)}
        </select>
      </div>
      {posts.length === 0 ? <div className="card"><Empty>{onlyOpen ? 'Tous les postes sont pourvus.' : 'Aucun poste sur la période.'}</Empty></div> : (
        [...days.entries()].map(([day, list]) => (
          <div key={day} className="card">
            <h2 style={{ marginTop: 0 }}>{new Date(day + 'T12:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
            <div className="table-wrap">
              <table className="list cards-sm">
                <thead><tr><th>Projet</th><th>Fonction</th><th>Horaires</th><th>Technicien</th><th>Coût</th><th title="Final : visible du technicien">Final</th><th className="n">Marge</th></tr></thead>
                <tbody>
                  {list.map((c) => <AssignRow key={c.id} c={c} project={pMap.get(c.projectId)!} sp={sMap.get(c.subprojectId)!} person={c.personId ? people.get(c.personId) : undefined} ctx={ctx} travelMinutes={pMap.get(c.projectId)?.travelMinutes} settings={settings} actions={cd.forPost(c)} />)}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      {cd.dialogs}
    </>
  );
}

function AssignRow({ c, project, sp, person, ctx, travelMinutes, settings, actions }: { c: CrewAssignment; project: Project; sp: Subproject; person?: Person; ctx: CrewContext; travelMinutes?: number; settings: ReturnType<typeof useSettings>; actions: { onAsk: () => void; onReplace: () => void; onDetails: () => void } }) {
  const a = crewAmount(c, settings, travelMinutes, crewCostProfile(c, person));
  const margin = (c.billable ? a.billed : 0) - a.cost;
  const pe = sp.periods?.find((x) => x.id === c.periodId);
  return (
    <tr>
      <td><Link to={`/projets/${project.id}?onglet=equipe`}><strong>{project.name}</strong></Link> <StatusBadge status={sp.status} /><div className="muted">{sp.name}{pe ? ` · ${pe.name}` : ''}</div></td>
      <td>{c.function}</td>
      <td className="nowrap">{fmtRange(c.start, c.end)}</td>
      <td><PersonSelect c={c} ctx={ctx} /><PostRequests c={c} people={ctx.people} requests={ctx.requests || []} {...actions} /></td>
      <td className="nowrap"><CostCell c={c} person={person} /></td>
      <td><input type="checkbox" aria-label="Planification finale" checked={c.final !== false} onChange={(e) => patch(db.crew, c.id, { final: e.target.checked })} /></td>
      <td className="n">{!c.personId && c.cost == null ? <span className="muted">—</span> : <span className={'avail ' + (margin < 0 ? 'ko' : 'ok')}>{money(round2(margin))}</span>}</td>
    </tr>
  );
}
