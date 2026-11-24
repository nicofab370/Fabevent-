import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Empty, PageHead, StatusBadge } from '../components/ui';
import { db } from '../db';
import { FIRM } from '../types';
import { blockPeriod, fmtDate, fmtRange, save, toLocalInput } from '../utils';

/** Liste des préparations à venir. */
export default function Warehouse() {
  const nav = useNavigate();
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const lines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));
  const [onlyReady, setOnlyReady] = useState(false);
  const now = toLocalInput(new Date(Date.now() - 7 * 86400000));
  // l'entrepôt voit les salles confirmées, et celles marquées « prêtes pour la préparation »
  const list = subs
    .filter((s) => (FIRM.includes(s.status) || (s.readyToPack && s.status !== 'annule')) && !pMap.get(s.projectId)?.isTemplate && (!onlyReady || s.readyToPack) && (s.returnEnd || s.end) >= now)
    .sort((a, b) => blockPeriod(a)[0].localeCompare(blockPeriod(b)[0]));

  return (
    <>
      <PageHead title="Entrepôt">
        <Link to="/checklists"><button className="secondary">Checklists libres (bons importés)</button></Link>
      </PageHead>
      <div className="info">Choisis une prestation pour préparer la sortie ou pointer le retour, à la douchette ou avec la caméra du téléphone.
        Les sous-projets confirmés apparaissent ici ; un sous-projet encore en attente apparaît dès qu'il est marqué « prête pour la préparation » (onglet Planning).</div>
      <label className="check-row" style={{ marginBottom: 8 }}><input type="checkbox" checked={onlyReady} onChange={(e) => setOnlyReady(e.target.checked)} /> Seulement les sous-projets prêts pour la préparation</label>
      {(() => {
        // une liste de colisage par date de départ (montage) ; à défaut : début de la période bloquée
        const rows = list.flatMap((s) => {
          const deps = (s.periods || []).filter((p) => p.kind === 'montage').map((p) => p.start.slice(0, 10));
          const dates = deps.length ? Array.from(new Set(deps)) : [blockPeriod(s)[0].slice(0, 10)];
          const n = lines.filter((l) => l.subprojectId === s.id && !l.optional && l.equipmentId).reduce((a, l) => a + l.qty, 0);
          return dates.map((d) => ({ s, d, n }));
        }).sort((a, b) => a.d.localeCompare(b.d) || a.s.name.localeCompare(b.s.name));
        if (!rows.length) return null;
        return (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Listes de colisage par date de départ</h2>
            <table className="list">
              <thead><tr><th>Date de départ</th><th>Projet</th><th>Sous-projet</th><th className="n">Articles</th><th>Colisage</th><th /></tr></thead>
              <tbody>{rows.map(({ s, d, n }) => {
                const st = s.packing?.[d];
                return (
                  <tr key={s.id + d} className="pack-row">
                    <td><strong>{fmtDate(d, false)}</strong></td>
                    <td>{pMap.get(s.projectId)?.name}</td>
                    <td>{s.name}</td>
                    <td className="n">{n}</td>
                    <td>{st ? <span className={'badge ' + (st === 'charge' ? 'st-confirme' : 'st-option')}>{st === 'charge' ? 'chargé' : 'préparé'}</span> : <span className="muted">—</span>}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {st !== 'prep' && <button className="secondary small" onClick={() => save(db.subprojects, { ...s, packing: { ...(s.packing || {}), [d]: 'prep' } })}>Marquer préparé</button>}{' '}
                      {st !== 'charge' && <button className="small" onClick={() => save(db.subprojects, { ...s, packing: { ...(s.packing || {}), [d]: 'charge' } })}>Marquer chargé</button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        );
      })()}
      <div className="card">
        {list.length === 0 ? <Empty>Aucune prestation à préparer.</Empty> : (
          <table className="list">
            <thead><tr><th>Projet</th><th>Sous-projet</th><th>Période bloquée</th><th>Statut</th><th className="n">Sortis</th><th className="n">Retournés</th></tr></thead>
            <tbody>
              {list.map((s) => {
                const ls = lines.filter((l) => l.subprojectId === s.id && !l.optional && l.equipmentId);
                const planned = ls.reduce((a, l) => a + l.qty, 0);
                const out = ls.reduce((a, l) => a + (l.outQty || 0), 0);
                const back = ls.reduce((a, l) => a + (l.inQty || 0), 0);
                const [b0, b1] = blockPeriod(s);
                return (
                  <tr key={s.id} className="click" onClick={() => nav('/entrepot/' + s.id)}>
                    <td><strong>{pMap.get(s.projectId)?.name}</strong></td><td>{s.name}</td><td>{fmtRange(b0, b1)}</td>
                    <td><StatusBadge status={s.status} />{s.readyToPack && <span className="badge st-confirme" style={{ marginLeft: 4 }}>prête</span>}</td>
                    <td className="n">{out}/{planned}</td><td className="n">{back}/{out}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
