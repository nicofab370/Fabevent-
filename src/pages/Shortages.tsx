import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, PageHead, StatusBadge } from '../components/ui';
import { CsvButton, exportCsv } from '../components/extra';
import { useAvailability } from '../data';
import { db } from '../db';
import type { Conflict } from '../utils';
import { fmtRange, toLocalInput } from '../utils';
import type { Subproject } from '../types';
import { FIRM } from '../types';

const LEVEL_LABELS: Record<Conflict['level'], string> = {
  ferme: 'Manque réel',
  concurrence: 'Concurrence entre options',
};

/** Libellé du manque : un projet réservé ferme est servi avant les options qui lui font concurrence. */
export function shortageLabel(c: Conflict, sp?: Subproject): string {
  if (c.level === 'concurrence' && sp && (FIRM.includes(sp.status) || sp.reserve)) return 'Servi en priorité';
  return LEVEL_LABELS[c.level];
}

/** Tous les manques de matériel à venir, tous projets confondus. */
export default function Shortages() {
  const nav = useNavigate();
  const av = useAvailability();
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const [level, setLevel] = useState<'' | Conflict['level']>('');
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const sMap = new Map(subs.map((s) => [s.id, s]));
  const now = toLocalInput(new Date());
  const all = upcomingShortages(av.conflicts(), now).filter((c) => !pMap.get(c.projectId)?.isTemplate);
  const list = all.filter((c) => !level || c.level === level);
  const rows = list.map((c) => [c.equipment.name, c.shortage, shortageLabel(c, sMap.get(c.subprojectId)), pMap.get(c.projectId)?.name, sMap.get(c.subprojectId)?.name, c.start, c.end]);

  return (
    <>
      <PageHead title="Pénuries">
        <CsvButton onClick={() => exportCsv('penuries', ['Article', 'Manque', 'Type', 'Projet', 'Sous-projet', 'Du', 'Au'], rows)} />
      </PageHead>
      <div className="info">
        <strong>Manque réel</strong> : même sans compter les demandes et projets en attente, le stock ne suffit pas — sous-loue, transfère ou remplace.
        <br /><strong>Concurrence entre options</strong> : le stock suffit pour les projets confirmés, mais pas pour toutes les options en même temps. Le premier projet confirmé sera servi.
        <br /><strong>Servi en priorité</strong> : projet confirmé (ou matériel réservé) ; ce sont les options qui se chevauchent avec lui qui risquent de manquer.
      </div>
      <div className="toolbar">
        <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)} style={{ width: 'auto' }}>
          <option value="">Tous les manques ({all.length})</option>
          <option value="ferme">Manques réels ({all.filter((c) => c.level === 'ferme').length})</option>
          <option value="concurrence">Concurrence entre options ({all.filter((c) => c.level === 'concurrence').length})</option>
        </select>
      </div>
      <div className="card">
        {list.length === 0 ? <Empty>Aucun manque de matériel à venir.</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Article</th><th className="n">Manque</th><th>Type</th><th>Projet</th><th>Sous-projet</th><th>Période</th><th /></tr></thead>
              <tbody>
                {list.map((c, i) => {
                  const s = sMap.get(c.subprojectId);
                  return (
                    <tr key={i}>
                      <td><strong>{c.equipment.name}</strong></td>
                      <td className="n avail ko">−{c.shortage}</td>
                      <td><span className={'badge ' + (c.level === 'ferme' ? 'st-annule' : shortageLabel(c, s) === 'Servi en priorité' ? 'st-confirme' : 'st-option')}>{shortageLabel(c, s)}</span></td>
                      <td>{pMap.get(c.projectId)?.name} {s && <StatusBadge status={s.status} />}</td>
                      <td>{s?.name}</td>
                      <td>{fmtRange(c.start, c.end)}</td>
                      <td className="nowrap">
                        <button className="secondary small" onClick={() => nav(`/projets/${c.projectId}?onglet=equipement`)}>Matériel</button>{' '}
                        <button className="secondary small" onClick={() => nav(`/projets/${c.projectId}?onglet=souslocation`)}>Sous-louer</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/** Manques qui ne sont pas encore passés, du plus proche au plus lointain. */
export function upcomingShortages(conflicts: Conflict[], now: string): Conflict[] {
  return conflicts.filter((c) => c.end >= now).sort((a, b) => a.start.localeCompare(b.start));
}
