import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, PageHead } from '../components/ui';
import { db } from '../db';
import type { Doc } from '../types';
import { DOC_STATUS_LABELS } from '../types';
import { download, fmtDate, money } from '../utils';

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
/** Nombre au format français pour Excel (virgule décimale). */
const num = (n: number) => n.toFixed(2).replace('.', ',');
const cell = (s: unknown) => {
  const v = String(s ?? '');
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
};

export default function Accounting() {
  const nav = useNavigate();
  const prev = new Date();
  prev.setMonth(prev.getMonth() - 1);
  const [from, setFrom] = useState(ym(prev));
  const [to, setTo] = useState(ym(new Date()));
  const invoices = useLiveQuery(() => db.docs.where('type').equals('facture').toArray(), []) || [];
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));

  const list = invoices
    .filter((d) => { const m = d.snapshot.issuedAt.slice(0, 7); return m >= from && m <= to; })
    .sort((a, b) => a.number.localeCompare(b.number));
  const sum = (f: (d: Doc) => number) => list.reduce((a, d) => a + f(d), 0);

  const exportCsv = () => {
    const head = ['Date', 'N° facture', 'Client', 'N° TVA client', 'Projet', 'Total HT', 'Taux TVA', 'TVA', 'Total TTC', 'Statut'];
    const rows = list.map((d) => {
      const s = d.snapshot;
      return [fmtDate(s.issuedAt, false), d.number, s.client?.company || '', s.client?.vatNumber || '', `${s.project.number} ${s.project.name}`,
        num(s.totalHT), num(s.vatRate), num(s.vat), num(s.totalTTC), DOC_STATUS_LABELS[d.status]];
    });
    rows.push(['', '', '', '', 'TOTAL', num(sum((d) => d.snapshot.totalHT)), '', num(sum((d) => d.snapshot.vat)), num(sum((d) => d.snapshot.totalTTC)), '']);
    const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
    download(`journal-ventes_${from}_${to}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <>
      <PageHead title="Export comptable">
        <span className="muted">Du</span>
        <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />
        <span className="muted">au</span>
        <input type="month" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
        <button onClick={exportCsv} disabled={!list.length}>Télécharger le journal des ventes (CSV)</button>
      </PageHead>
      <div className="info">
        Journal des ventes à transmettre à ton comptable (Billy.tech) : un fichier CSV lisible dans Excel, avec une ligne par facture.
        Pour joindre les factures elles-mêmes, ouvre chacune et utilise « Imprimer / PDF ».
      </div>
      <div className="stats">
        <div className="stat"><b>{list.length}</b><span>factures</span></div>
        <div className="stat"><b>{money(sum((d) => d.snapshot.totalHT))}</b><span>total HT</span></div>
        <div className="stat"><b>{money(sum((d) => d.snapshot.vat))}</b><span>TVA collectée</span></div>
        <div className="stat"><b>{money(sum((d) => d.snapshot.totalTTC))}</b><span>total TTC</span></div>
        <div className="stat"><b>{money(list.filter((d) => d.status !== 'paye').reduce((a, d) => a + d.snapshot.totalTTC, 0))}</b><span>reste à encaisser</span></div>
      </div>
      <div className="card">
        {list.length === 0 ? <Empty>Aucune facture sur cette période.</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Date</th><th>N°</th><th>Client</th><th>Projet</th><th className="n">HT</th><th className="n">TVA</th><th className="n">TTC</th><th>Statut</th></tr></thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="click" onClick={() => nav('/documents/' + d.id)}>
                    <td>{fmtDate(d.snapshot.issuedAt, false)}</td><td><strong>{d.number}</strong></td>
                    <td>{d.snapshot.client?.company}</td><td>{pMap.get(d.projectId)?.name || d.snapshot.project.name}</td>
                    <td className="n">{money(d.snapshot.totalHT)}</td><td className="n">{money(d.snapshot.vat)}</td><td className="n">{money(d.snapshot.totalTTC)}</td>
                    <td><span className="badge">{DOC_STATUS_LABELS[d.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
