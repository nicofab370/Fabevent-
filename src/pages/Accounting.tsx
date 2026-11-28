import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, PageHead } from '../components/ui';
import { BillingRecap } from './BillingRecap';
import { OverdueInvoices } from './Overdue';
import { ToInvoice } from './ToInvoice';
import { db } from '../db';
import type { Doc } from '../types';
import { DOC_CSS, DocRender } from '../components/DocRender';
import { DOC_LABELS, DOC_STATUS_LABELS } from '../types';
import { download, fmtDate, money } from '../utils';
import { Icon } from '../components/Icon';

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
  const invoices = useLiveQuery(() => db.docs.where('type').anyOf('facture', 'acompte', 'avoir').toArray(), []) || [];
  const [printAll, setPrintAll] = useState(false);
  const projects = useLiveQuery(() => db.projects.toArray(), []) || [];
  const pMap = new Map(projects.map((p) => [p.id, p]));

  const list = invoices
    .filter((d) => { const m = d.snapshot.issuedAt.slice(0, 7); return m >= from && m <= to; })
    .sort((a, b) => a.number.localeCompare(b.number));
  const sum = (f: (d: Doc) => number) => list.reduce((a, d) => a + f(d), 0);

  const exportCsv = () => {
    const head = ['Date', 'Type', 'N° pièce', 'Client', 'N° TVA client', 'Projet', 'Total HT', 'Taux TVA', 'TVA', 'Total TTC', 'Statut'];
    const rows = list.map((d) => {
      const s = d.snapshot;
      return [fmtDate(s.issuedAt, false), DOC_LABELS[d.type], d.number, s.client?.company || '', s.client?.vatNumber || '', `${s.project.number} ${s.project.name}`,
        num(s.totalHT), num(s.vatRate), num(s.vat), num(s.totalTTC), DOC_STATUS_LABELS[d.status]];
    });
    rows.push(['', '', '', '', '', 'TOTAL', num(sum((d) => d.snapshot.totalHT)), '', num(sum((d) => d.snapshot.vat)), num(sum((d) => d.snapshot.totalTTC)), '']);
    const csv = '﻿' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
    download(`journal-ventes_${from}_${to}.csv`, csv, 'text/csv;charset=utf-8');
  };

  /** Ventilation HT par compte comptable : matériel selon le compte de chaque ligne, le reste selon les comptes par défaut. */
  const exportLedgers = async () => {
    const st = await db.settings.get('main');
    const code = (k: 'personnel' | 'transport' | 'frais' | 'assurance') => { const id = st?.ledgerDefaults?.[k]; return (id && st?.ledgers?.find((x) => x.id === id)?.code) || k; };
    const head = ['Date', 'Type', 'N° pièce', 'Client', 'Compte', 'Montant HT'];
    const rows: unknown[][] = [];
    for (const d of list) {
      const s = d.snapshot;
      const raw = new Map<string, number>();
      const add = (k: string, v: number) => raw.set(k, (raw.get(k) || 0) + v);
      for (const sp of s.subprojects) {
        for (const l of sp.equipment) if (!l.optional && !l.kid) add(l.ledger || 'materiel', l.total);
        for (const c of sp.crew) if (c.billable) add(code('personnel'), c.total);
        for (const v of sp.vehicles) if (v.billable) add(code('transport'), v.price);
      }
      const sum = [...raw.values()].reduce((a, x) => a + x, 0);
      const k = sum ? s.totalHT / sum : 0;
      if (!raw.size || !sum) raw.set(code('frais'), s.totalHT);
      for (const [acc, v] of raw) rows.push([fmtDate(s.issuedAt, false), DOC_LABELS[d.type], d.number, s.client?.company || '', acc, num(sum ? v * k : v)]);
    }
    const csv = '\ufeff' + [head, ...rows].map((r) => r.map(cell).join(';')).join('\r\n');
    download(`ventilation-comptes_${from}_${to}.csv`, csv, 'text/csv;charset=utf-8');
  };

  if (printAll) {
    return (
      <>
        <style>{DOC_CSS + '@media print{.doc{break-after:page}}'}</style>
        <div className="no-print toolbar">
          <button onClick={() => window.print()}>Imprimer / enregistrer en PDF ({list.length} pièces)</button>
          <button className="secondary" onClick={() => setPrintAll(false)}><Icon name="arrow-left" />Retour</button>
          <span className="muted" style={{ alignSelf: 'center' }}>Dans la fenêtre d'impression, choisis « Enregistrer au format PDF ».</span>
        </div>
        {list.map((d) => <div key={d.id} className="doc-wrap" style={{ marginBottom: 16 }}><DocRender doc={d} /></div>)}
      </>
    );
  }

  return (
    <>
      <PageHead title="Export comptable">
        <span className="muted">Du</span>
        <input type="month" value={from} onChange={(e) => setFrom(e.target.value)} style={{ width: 'auto' }} />
        <span className="muted">au</span>
        <input type="month" value={to} onChange={(e) => setTo(e.target.value)} style={{ width: 'auto' }} />
        <button onClick={() => setPrintAll(true)} disabled={!list.length}>Toutes les factures en PDF</button>
        <button className="secondary" onClick={exportCsv} disabled={!list.length}>Journal des ventes (CSV)</button>
        <button className="secondary" onClick={exportLedgers} disabled={!list.length} title="Montants HT par compte du grand livre (Paramètres → Comptes comptables)">Ventilation par compte (CSV)</button>
      </PageHead>
      <div className="info">
        Pour ton comptable (Billy.tech) : « Toutes les factures en PDF » regroupe factures, acomptes et avoirs de la période
        dans un seul PDF (une pièce par page). Le journal CSV sert de récapitulatif. Pour l'envoi Peppol, ouvre la facture → « Peppol (XML) ».
      </div>
      <BillingRecap />
      <ToInvoice />
      <OverdueInvoices />
      <div className="stats">
        <div className="stat"><b>{list.length}</b><span>pièces (factures, acomptes, avoirs)</span></div>
        <div className="stat"><b>{money(sum((d) => d.snapshot.totalHT))}</b><span>total HT</span></div>
        <div className="stat"><b>{money(sum((d) => d.snapshot.vat))}</b><span>TVA collectée</span></div>
        <div className="stat"><b>{money(sum((d) => d.snapshot.totalTTC))}</b><span>total TTC</span></div>
        <div className="stat"><b>{money(list.filter((d) => d.status !== 'paye' && d.type !== 'avoir').reduce((a, d) => a + d.snapshot.totalTTC - (d.snapshot.deposits || []).reduce((x, y) => x + y.ttc, 0) - (d.payments || []).reduce((x, y) => x + y.amount, 0), 0))}</b><span>reste à encaisser</span></div>
      </div>
      <div className="card">
        {list.length === 0 ? <Empty>Aucune facture sur cette période.</Empty> : (
          <div className="table-wrap">
            <table className="list">
              <thead><tr><th>Date</th><th>Type</th><th>N°</th><th>Client</th><th>Projet</th><th className="n">HT</th><th className="n">TVA</th><th className="n">TTC</th><th>Statut</th></tr></thead>
              <tbody>
                {list.map((d) => (
                  <tr key={d.id} className="click" onClick={() => nav('/documents/' + d.id)}>
                    <td>{fmtDate(d.snapshot.issuedAt, false)}</td><td>{DOC_LABELS[d.type]}</td><td><strong>{d.number}</strong></td>
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
