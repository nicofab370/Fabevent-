import { CONFIRMED } from '../types';
import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Empty, PageHead, useSettings } from '../components/ui';
import { db } from '../db';
import { INVOICE_TYPES } from '../types';
import { lineDays, lineTotal, money, round2 } from '../utils';
import { Icon } from '../components/Icon';

const MONTHS = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.'];

export default function Reports() {
  const settings = useSettings();
  const [year, setYear] = useState(new Date().getFullYear());
  const docs = useLiveQuery(() => db.docs.where('type').anyOf(INVOICE_TYPES).toArray(), []) || [];
  const lines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const equipment = useLiveQuery(() => db.equipment.toArray(), []) || [];
  const y = String(year);

  // Chiffre d'affaires facturé : factures + avoirs + acomptes pas encore repris dans une facture finale
  const deducted = new Set(docs.flatMap((d) => (d.snapshot.deposits || []).map((x) => x.number)));
  const counted = docs.filter((d) => d.snapshot.issuedAt.slice(0, 4) === y && !(d.type === 'acompte' && deducted.has(d.number)));
  const byMonth = MONTHS.map((_, m) => round2(counted.filter((d) => new Date(d.snapshot.issuedAt).getMonth() === m).reduce((a, d) => a + d.snapshot.totalHT, 0)));
  const yearTotal = round2(byMonth.reduce((a, b) => a + b, 0));
  const maxMonth = Math.max(1, ...byMonth.map(Math.abs));

  const byClient = new Map<string, number>();
  for (const d of counted) {
    const k = d.snapshot.client?.company || '(sans client)';
    byClient.set(k, round2((byClient.get(k) || 0) + d.snapshot.totalHT));
  }
  const clients = [...byClient.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  const maxClient = Math.max(1, ...clients.map((c) => c[1]));

  // Matériel : chiffre généré et taux d'utilisation sur l'année (projets confirmés, en cours, terminés)
  const subMap = new Map(subs.map((s) => [s.id, s]));
  const stats = new Map<string, { revenue: number; unitDays: number }>();
  for (const l of lines) {
    const sp = subMap.get(l.subprojectId);
    if (!sp || !l.equipmentId || l.optional || !CONFIRMED.includes(sp.status) || sp.start.slice(0, 4) !== y) continue;
    const days = lineDays(l, sp);
    const eq = equipment.find((e) => e.id === l.equipmentId);
    const cur = stats.get(l.equipmentId) || { revenue: 0, unitDays: 0 };
    cur.revenue += lineTotal(l, days, settings, eq?.kind === 'vente');
    cur.unitDays += l.qty * days;
    stats.set(l.equipmentId, cur);
  }
  const top = [...stats.entries()]
    .map(([id, s]) => {
      const e = equipment.find((x) => x.id === id);
      return { id, name: e?.name || '?', revenue: round2(s.revenue), usage: e && e.quantity && e.kind !== 'vente' ? Math.min(100, Math.round((s.unitDays / (e.quantity * 365)) * 100)) : null };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 15);
  const maxEq = Math.max(1, ...top.map((t) => t.revenue));
  const unused = equipment.filter((e) => !e.isKit && !e.archived && e.kind !== 'vente' && !stats.has(e.id));

  return (
    <>
      <PageHead title="Rapports">
        <button className="secondary" onClick={() => setYear(year - 1)} aria-label="Précédent"><Icon name="chevron-left" /></button>
        <strong>{year}</strong>
        <button className="secondary" onClick={() => setYear(year + 1)} aria-label="Suivant"><Icon name="chevron-right" /></button>
      </PageHead>
      <div className="stats">
        <div className="stat"><b>{money(yearTotal)}</b><span>chiffre d'affaires facturé HT</span></div>
        <div className="stat"><b>{counted.length}</b><span>pièces émises</span></div>
        <div className="stat"><b>{unused.length}</b><span>articles jamais loués cette année</span></div>
        <div className="stat"><b>{money(equipment.filter((e) => !e.archived && !e.isKit).reduce((a, e) => a + (e.replacementValue || 0) * e.quantity, 0))}</b><span>valeur de remplacement du parc</span></div>
      </div>
      <div className="grid">
        <div className="card">
          <h2>Chiffre d'affaires par mois (HT)</h2>
          <table className="list">
            <tbody>
              {MONTHS.map((m, i) => (
                <tr key={m}><td>{m}</td><td className="n bar-cell"><i style={{ width: `${(Math.abs(byMonth[i]) / maxMonth) * 100}%` }} /><span>{money(byMonth[i])}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Meilleurs clients</h2>
          {clients.length === 0 ? <Empty>Aucune facture cette année.</Empty> : (
            <table className="list">
              <tbody>
                {clients.map(([c, v]) => <tr key={c}><td>{c}</td><td className="n bar-cell"><i style={{ width: `${(v / maxClient) * 100}%` }} /><span>{money(v)}</span></td></tr>)}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="card">
        <h2>Matériel le plus rentable</h2>
        <p className="muted" style={{ marginTop: 0 }}>Basé sur les projets confirmés, en cours et terminés de l'année. Utilisation = jours loués ÷ (stock × 365).</p>
        {top.length === 0 ? <Empty>Pas encore de données.</Empty> : (
          <table className="list">
            <thead><tr><th>Article</th><th className="n">Chiffre généré HT</th><th className="n">Utilisation</th></tr></thead>
            <tbody>
              {top.map((t) => (
                <tr key={t.id}><td><Link to={'/materiel/' + t.id}>{t.name}</Link></td>
                  <td className="n bar-cell"><i style={{ width: `${(t.revenue / maxEq) * 100}%` }} /><span>{money(t.revenue)}</span></td>
                  <td className="n">{t.usage === null ? '—' : `${t.usage} %`}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {unused.length > 0 && <p className="muted">Jamais loués : {unused.slice(0, 20).map((e) => e.name).join(', ')}{unused.length > 20 ? '…' : ''}</p>}
      </div>
    </>
  );
}
