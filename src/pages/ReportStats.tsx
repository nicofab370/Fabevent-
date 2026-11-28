/**
 * Statistiques configurables (page Rapports) : projets regroupés par projet, type, client, chargé de projet ou statut,
 * avec CA, coûts et marge (et le détail matériel / personnel / transport / frais) ; matériel par catégorie ;
 * sous-locations par fournisseur. Les vues se nomment et s'enregistrent (sur cet appareil) ; export CSV.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Field, useSettings } from '../components/ui';
import { CsvButton, exportCsv } from '../components/extra';
import { currentWorkspace, db } from '../db';
import { STATUS_LABELS } from '../types';
import { lineDays, lineTotal, money, round2 } from '../utils';
import { computeFinance, isPerPiece } from './project/shared';

type Kind = 'projet' | 'type' | 'client' | 'manager' | 'statut' | 'categorie' | 'fournisseur';
const KINDS: Record<Kind, string> = {
  projet: 'Projets : par projet', type: 'Projets : par type de projet', client: 'Projets : par client', manager: 'Projets : par chargé de projet',
  statut: 'Projets : par statut', categorie: 'Matériel : par catégorie', fournisseur: 'Sous-locations : par fournisseur',
};
interface View { name: string; kind: Kind; from: string; to: string }
const key = () => 'fab.stats.' + currentWorkspace();
const loadViews = (): View[] => { try { return JSON.parse(localStorage.getItem(key()) || '[]'); } catch { return []; } };

export function ReportStats({ year }: { year: number }) {
  const settings = useSettings();
  const [views, setViews] = useState<View[]>(loadViews);
  const [v, setV] = useState<View>({ name: '', kind: 'type', from: `${year}-01-01`, to: `${year}-12-31` });
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const subs = useLiveQuery(() => db.subprojects.toArray(), []) || [];
  const lines = useLiveQuery(() => db.lines.toArray(), []) || [];
  const crew = useLiveQuery(() => db.crew.toArray(), []) || [];
  const vas = useLiveQuery(() => db.vehicleAssignments.toArray(), []) || [];
  const costs = useLiveQuery(() => db.costs.toArray(), []) || [];
  const people = useLiveQuery(() => db.people.toArray(), []) || [];
  const equipment = useLiveQuery(() => db.equipment.toArray(), []) || [];
  const contacts = useLiveQuery(() => db.contacts.toArray(), []) || [];
  const subrentals = useLiveQuery(() => db.subrentals.toArray(), []) || [];
  const cats = useLiveQuery(() => db.categories.toArray(), []) || [];
  const repairs = useLiveQuery(() => db.repairs.toArray(), []) || [];
  const appts = useLiveQuery(() => db.appointments.toArray(), []) || [];

  const { head, rows } = useMemo(() => {
    const eqMap = new Map(equipment.map((e) => [e.id, e]));
    const cMap = new Map(contacts.map((c) => [c.id, c.company]));
    const inRange = (start: string, end: string) => start.slice(0, 10) <= v.to && end.slice(0, 10) >= v.from;
    if (v.kind === 'categorie') {
      const catName = new Map(cats.map((c) => [c.id, c.name]));
      const by = new Map<string, { rev: number; days: number; repairs: number; items: number }>();
      const subMap = new Map(subs.map((s) => [s.id, s]));
      for (const l of lines) {
        const sp = subMap.get(l.subprojectId), e = l.equipmentId ? eqMap.get(l.equipmentId) : undefined;
        if (!sp || !e || l.optional || sp.status === 'annule' || !inRange(sp.start, sp.end)) continue;
        const k = (e.categoryId && catName.get(e.categoryId)) || '(sans catégorie)';
        const cur = by.get(k) || { rev: 0, days: 0, repairs: 0, items: 0 };
        cur.rev += lineTotal(l, lineDays(l, sp), settings, isPerPiece(l, eqMap), e.factorGroupId);
        cur.days += l.qty * lineDays(l, sp);
        by.set(k, cur);
      }
      for (const r of repairs) { const e = eqMap.get(r.equipmentId); const k = (e?.categoryId && catName.get(e.categoryId)) || '(sans catégorie)'; const cur = by.get(k); if (cur) cur.repairs++; }
      return { head: ['Catégorie', 'CA HT', 'Jours × unités louées', 'Réparations'], rows: [...by].sort((a, b) => b[1].rev - a[1].rev).map(([k, x]) => [k, round2(x.rev), x.days, x.repairs]) };
    }
    if (v.kind === 'fournisseur') {
      const by = new Map<string, { n: number; qty: number; cost: number }>();
      for (const s of subrentals) {
        if (s.status === 'annule' || !inRange(s.start, s.end)) continue;
        const k = (s.supplierId && cMap.get(s.supplierId)) || '(sans fournisseur)';
        const cur = by.get(k) || { n: 0, qty: 0, cost: 0 };
        cur.n++; cur.qty += s.lines.reduce((a, l) => a + l.qty, 0); cur.cost += s.lines.reduce((a, l) => a + l.cost, 0);
        by.set(k, cur);
      }
      return { head: ['Fournisseur', 'Sous-locations', 'Quantité', 'Coût HT'], rows: [...by].sort((a, b) => b[1].cost - a[1].cost).map(([k, x]) => [k, x.n, x.qty, round2(x.cost)]) };
    }
    // projets
    const parts = ['Matériel', 'Personnel', 'Transport', 'Frais supplémentaires'];
    const by = new Map<string, { n: number; rev: number; cost: number; part: Record<string, number> }>();
    for (const p of projects) {
      if (p.isTemplate || p.status === 'annule' || !inRange(p.start, p.end)) continue;
      const ps = subs.filter((s) => s.projectId === p.id);
      const f = computeFinance(p, ps, lines.filter((l) => l.projectId === p.id), crew.filter((c) => c.projectId === p.id), vas.filter((x) => x.projectId === p.id),
        costs.filter((c) => c.projectId === p.id), people, eqMap, settings,
        subrentals.filter((s) => s.projectId === p.id && s.status !== 'annule').reduce((a, s) => a + s.lines.reduce((b, l) => b + l.cost, 0), 0),
        appts.filter((a) => a.projectId === p.id).reduce((a, x) => a + (x.cost || 0), 0));
      const k = v.kind === 'projet' ? `${p.number} ${p.name}` : v.kind === 'type' ? p.typeName || '(sans type)' : v.kind === 'client' ? (p.clientId && cMap.get(p.clientId)) || '(sans client)'
        : v.kind === 'manager' ? p.manager || '(sans chargé de projet)' : STATUS_LABELS[p.status];
      const cur = by.get(k) || { n: 0, rev: 0, cost: 0, part: {} };
      cur.n++; cur.rev += f.totalHT; cur.cost += f.cost;
      for (const r of f.rows) { const name = parts.find((x) => r.label.startsWith(x.split(' ')[0])) || 'Autre'; cur.part[name] = (cur.part[name] || 0) + r.revenue; }
      by.set(k, cur);
    }
    return {
      head: [KINDS[v.kind].split(': par ')[1] || 'Projet', 'Projets', 'CA HT', 'Coûts', 'Marge', 'Marge %', ...parts.map((x) => `CA ${x.toLowerCase()}`)],
      rows: [...by].sort((a, b) => b[1].rev - a[1].rev).map(([k, x]) => [k, x.n, round2(x.rev), round2(x.cost), round2(x.rev - x.cost), x.rev ? Math.round(((x.rev - x.cost) / x.rev) * 1000) / 10 : 0, ...parts.map((pt) => round2(x.part[pt] || 0))]),
    };
  }, [v, projects, subs, lines, crew, vas, costs, people, equipment, contacts, subrentals, cats, repairs, appts, settings]);

  const saveView = () => {
    const name = prompt('Nom de la statistique :', v.name || KINDS[v.kind])?.trim();
    if (!name) return;
    const next = [...views.filter((x) => x.name !== name), { ...v, name }];
    setViews(next); setV({ ...v, name });
    try { localStorage.setItem(key(), JSON.stringify(next)); } catch { /* sans stockage */ }
  };
  const isMoney = (h: string) => /CA|Coût|Marge(?! %)/.test(h);
  return (
    <div className="card">
      <h2>Statistiques</h2>
      <div className="form">
        <Field label="Statistique">
          <select value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as Kind, name: '' })}>
            {Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Du"><input type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value })} /></Field>
        <Field label="Au"><input type="date" value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} /></Field>
        {views.length > 0 && (
          <Field label="Statistiques enregistrées">
            <select value={v.name} onChange={(e) => { const x = views.find((w) => w.name === e.target.value); if (x) setV(x); }}>
              <option value="">—</option>
              {views.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
            </select>
          </Field>
        )}
      </div>
      <div className="toolbar">
        <button className="secondary small" onClick={saveView}>Enregistrer cette statistique</button>
        {v.name && views.some((x) => x.name === v.name) && <button className="ghost small" onClick={() => { const next = views.filter((x) => x.name !== v.name); setViews(next); try { localStorage.setItem(key(), JSON.stringify(next)); } catch { /* */ } setV({ ...v, name: '' }); }}>Supprimer</button>}
        <CsvButton onClick={() => exportCsv(`statistique-${v.kind}`, head, rows)} />
      </div>
      {rows.length === 0 ? <p className="muted">Rien sur cette période.</p> : (
        <div className="table-wrap">
          <table className="list">
            <thead><tr>{head.map((h) => <th key={h} className={typeof rows[0][head.indexOf(h)] === 'number' ? 'n' : ''}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'n' : ''}>{typeof c === 'number' && isMoney(head[j]) ? money(c) : head[j] === 'Marge %' ? `${c} %` : c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
