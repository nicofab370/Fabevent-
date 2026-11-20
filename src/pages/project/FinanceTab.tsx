import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Empty, Field, Modal, NumInput } from '../../components/ui';
import { invoiceSchedule, MOMENT_STATE_LABELS, projectMoments, settingsMoments, type ScheduleRow } from '../../invoicing';
import { db } from '../../db';
import { createDocument } from '../../documents';
import type { DepositStatus, DocType } from '../../types';
import { CONFIRMED, DEPOSIT_LABELS, DOC_LABELS, DOC_STATUS_LABELS, INVOICE_TYPES, MOMENT_TRIGGERS } from '../../types';
import { fmtDate, money, patch, round2 } from '../../utils';
import { invoicedHT, type ProjectData } from './shared';
import { hrOrders } from './hrOrders';

/** Onglet Finances : chiffre d'affaires, coûts et marge par catégorie, remise, documents. */
export default function FinanceTab({ d }: { d: ProjectData }) {
  const nav = useNavigate();
  const { project, finance: f, docs, settings } = d;
  const [busy, setBusy] = useState(false);
  const [roomInvoice, setRoomInvoice] = useState(false);
  const invoicedRooms = new Set(docs.filter((x) => x.type === 'facture' && x.subprojectIds).flatMap((x) => x.subprojectIds || []));
  const invoiced = invoicedHT(docs);
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)} %` : '—');

  const generate = async (type: DocType) => {
    let percent: number | undefined;
    if (type === 'acompte') {
      const a = prompt("Pourcentage de l'acompte (calculé sur le dernier devis) :", '30');
      if (a === null) return;
      percent = parseFloat(a.replace(',', '.')) || 30;
    }
    setBusy(true);
    try { nav('/documents/' + (await createDocument(project.id, type, { percent })).id); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{money(f.totalHT)}</b><span>total HT{f.discount ? ` (après remise)` : ''}</span></div>
        <div className="stat"><b>{money(f.cost)}</b><span>coûts</span></div>
        <div className="stat"><b style={{ color: f.margin < 0 ? 'var(--danger)' : 'var(--ok)' }}>{money(f.margin)}</b><span>marge ({pct(f.margin, f.totalHT)})</span></div>
        <div className="stat"><b>{money(invoiced)}</b><span>déjà facturé HT · reste {money(round2(f.totalHT - invoiced))}</span></div>
      </div>
      <div className="card">
        <h2>Détail par catégorie</h2>
        <table className="list">
          <thead><tr><th>Catégorie</th><th className="n">Chiffre d'affaires HT</th><th className="n">Coûts prévus</th><th className="n">Marge</th><th className="n">%</th><th className="n" title="Saisis le coût réel une fois les factures fournisseurs reçues">Coût réel</th></tr></thead>
          <tbody>
            {f.rows.map((r) => (
              <tr key={r.label}><td>{r.label}</td><td className="n">{money(r.revenue)}</td><td className="n">{money(r.cost)}</td><td className="n">{money(round2(r.revenue - r.cost))}</td><td className="n">{pct(r.revenue - r.cost, r.revenue)}</td>
                <td className="n"><ActualInput value={project.actualCosts?.[r.label]} placeholder={r.cost} onSave={(v) => {
                  const actualCosts = { ...(project.actualCosts || {}) };
                  if (v === undefined) delete actualCosts[r.label]; else actualCosts[r.label] = v;
                  return patch(db.projects, project.id, { actualCosts: Object.keys(actualCosts).length ? actualCosts : undefined });
                }} /></td></tr>
            ))}
            <tr><td><strong>Sous-total</strong></td><td className="n"><strong>{money(f.gross)}</strong></td><td className="n">{money(f.cost)}</td><td /><td /><td className="n">{money(f.actualCost)}</td></tr>
            <tr>
              <td>Remise globale <NumInput className="w-qty" value={project.discount} onChange={(n) => patch(db.projects, project.id, { discount: n })} /> %</td>
              <td className="n">− {money(f.discount)}</td><td /><td /><td /><td />
            </tr>
            <tr><td><strong>Total HT</strong></td><td className="n"><strong>{money(f.totalHT)}</strong></td><td /><td className="n"><strong>{money(f.margin)}</strong></td><td className="n">{pct(f.margin, f.totalHT)}</td>
              <td className="n" title="Marge réelle"><strong style={{ color: f.actualMargin < 0 ? 'var(--danger)' : undefined }}>{money(f.actualMargin)}</strong> <span className="muted">({pct(f.actualMargin, f.totalHT)})</span></td></tr>
            <tr><td>TVA {settings.vatRate} %</td><td className="n">{money(f.vat)}</td><td /><td /><td /><td /></tr>
            <tr><td><strong>Total TTC</strong></td><td className="n"><strong>{money(f.totalTTC)}</strong></td><td /><td /><td /><td /></tr>
          </tbody>
        </table>
        <p className="muted" style={{ marginBottom: 0 }}>
          Coûts prévus : personnel (coût de la personne affectée), sous-locations et consommables (matériel), coûts supplémentaires.
          Coût réel : à saisir après le projet (factures des sous-traitants…) ; vide = coût prévu. Le taux de TVA se règle dans Paramètres.
        </p>
      </div>

      <div className="grid">
        <Schedule d={d} busy={busy} setBusy={setBusy} />
        <div className="card">
          <h2>Caution et assurance</h2>
          <div className="form">
            <Field label="Caution demandée (€, hors TVA)">
              <NumInput value={project.deposit?.amount || 0} onChange={(n) => patch(db.projects, project.id, { deposit: n ? { amount: n, status: project.deposit?.status && project.deposit.status !== 'aucune' ? project.deposit.status : 'demandee' } : undefined })} />
            </Field>
            <Field label="État de la caution">
              <select value={project.deposit?.status || 'aucune'} disabled={!project.deposit?.amount} onChange={(e) => project.deposit && patch(db.projects, project.id, { deposit: { ...project.deposit, status: e.target.value as DepositStatus } })}>
                {Object.entries(DEPOSIT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </Field>
            <Field label={`Assurance du matériel (% de la location${settings.insurancePct ? `, défaut ${settings.insurancePct} %` : ''})`}>
              <ActualInput value={project.insurancePct} placeholder={settings.insurancePct || 0} suffix=" %" onSave={(v) => patch(db.projects, project.id, { insurancePct: v })} />
            </Field>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>La caution s'affiche sur le devis, le bon de sortie et la facture, sans entrer dans le total. L'assurance est ajoutée comme ligne de frais.</p>
        </div>
      </div>

      {(() => {
        const cName = new Map(d.contacts.map((c) => [c.id, c.company]));
        const rows = new Map<string, number>();
        for (const o of hrOrders(d)) rows.set(o.supplier, (rows.get(o.supplier) || 0) + o.total);
        for (const sr of d.subrentals.filter((x) => x.status !== 'annule')) {
          const k = sr.supplierId ? cName.get(sr.supplierId) || '?' : 'Sous-location sans fournisseur';
          rows.set(k, (rows.get(k) || 0) + sr.lines.reduce((x, l) => x + l.cost, 0));
        }
        for (const c of d.costs.filter((x) => x.supplierId)) { const k = cName.get(c.supplierId!) || '?'; rows.set(k, (rows.get(k) || 0) + c.amount); }
        const list = [...rows.entries()].filter(([, v]) => v).sort((x, y) => y[1] - x[1]);
        return list.length ? (
          <div className="card">
            <h2>Coûts par fournisseur</h2>
            <table className="list"><tbody>{list.map(([k, v]) => <tr key={k}><td>{k}</td><td className="n">{money(round2(v))}</td></tr>)}</tbody></table>
          </div>
        ) : null;
      })()}

      <div className="card">
        <h2>Devis, factures et documents</h2>
        <div className="toolbar">
          {d.subs.length > 1 && <button className="secondary" disabled={busy} onClick={() => setRoomInvoice(true)}>+ Facture d'un sous-projet</button>}
          {(['devis', 'acompte', 'facture', 'bon_sortie', 'feuille_route'] as DocType[]).map((t) => (
            <button key={t} disabled={busy} className={t === 'devis' ? '' : 'secondary'} onClick={() => generate(t)}>+ {DOC_LABELS[t]}</button>
          ))}
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Chaque génération crée un nouveau document figé : rien n'est jamais écrasé. La facture finale déduit automatiquement les acomptes ;
          les avoirs se créent depuis la facture concernée.
        </p>
        {docs.length === 0 ? <Empty>Aucun document pour l'instant.</Empty> : (
          <table className="list">
            <thead><tr><th>Type</th><th>Numéro</th><th>Version</th><th>Date</th><th className="n">Total HT</th><th>Statut</th></tr></thead>
            <tbody>
              {docs.map((x) => (
                <tr key={x.id} className="click" onClick={() => nav('/documents/' + x.id)}>
                  <td>{DOC_LABELS[x.type]}</td><td><strong>{x.number}</strong></td><td>{INVOICE_TYPES.includes(x.type) ? '' : `v${x.version}`}</td>
                  <td>{fmtDate(x.createdAt)}</td>
                  <td className="n">{x.snapshot.hidePrices ? '—' : money(x.snapshot.totalHT)}</td>
                  <td><span className="badge">{DOC_STATUS_LABELS[x.status]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {roomInvoice && (
        <Modal title="Facturer un ou plusieurs sous-projets" onClose={() => setRoomInvoice(false)}>
          <form onSubmit={async (e) => {
            e.preventDefault();
            const ids = [...new FormData(e.currentTarget).keys()];
            if (!ids.length) return;
            setBusy(true);
            try { nav('/documents/' + (await createDocument(project.id, 'facture', { subIds: ids })).id); } catch (err) { alert((err as Error).message); } finally { setBusy(false); }
          }}>
            <p className="muted" style={{ marginTop: 0 }}>La facture finale du projet exclura ensuite automatiquement ces sous-projets. Les frais supplémentaires et les acomptes restent sur la facture finale.</p>
            {d.subs.filter((sp) => sp.status !== 'annule').map((sp) => (
              <label key={sp.id} className="check-row" style={{ marginBottom: 6 }}>
                <input type="checkbox" name={sp.id} disabled={invoicedRooms.has(sp.id)} /> {sp.name}{invoicedRooms.has(sp.id) && <span className="muted"> — déjà facturé</span>}
              </label>
            ))}
            <div className="form-actions" style={{ display: 'flex' }}>
              <button type="button" className="secondary" onClick={() => setRoomInvoice(false)}>Annuler</button>
              <button type="submit">Générer la facture</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}

/** Montant optionnel : vide = valeur par défaut (affichée en gris). */
function ActualInput({ value, placeholder, onSave, suffix }: { value?: number; placeholder: number; onSave: (v: number | undefined) => unknown; suffix?: string }) {
  const [v, setV] = useState(value === undefined ? '' : String(value).replace('.', ','));
  useEffect(() => setV(value === undefined ? '' : String(value).replace('.', ',')), [value]);
  return (
    <input className="w-price" inputMode="decimal" value={v} placeholder={String(placeholder).replace('.', ',') + (suffix || '')} onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        const n = v.trim() === '' ? undefined : parseFloat(v.replace(',', '.'));
        if (n !== value && (n === undefined || !isNaN(n))) onSave(n);
      }} />
  );
}

/** Échéancier : moments de facturation du projet, état de chacun, facturation en un clic. */
function Schedule({ d, busy, setBusy }: { d: ProjectData; busy: boolean; setBusy: (b: boolean) => void }) {
  const nav = useNavigate();
  const { project, client, settings, docs, finance: f } = d;
  const all = settingsMoments(settings);
  const moments = projectMoments(project, client, settings);
  const rows = invoiceSchedule(project, moments, f.totalHT, invoicedHT(docs));
  const source = project.moments?.length ? 'du projet' : client?.moments?.length ? 'du client' : settings.projectTypes?.find((t) => t.name === project.typeName)?.moments?.length ? `du type « ${project.typeName} »` : 'par défaut';
  const toggle = (id: string, on: boolean) => {
    const cur = moments.map((m) => m.id).filter((x) => all.some((m) => m.id === x));
    const next = all.filter((m) => (m.id === id ? on : cur.includes(m.id))).map((m) => m.id).slice(0, 3);
    patch(db.projects, project.id, { moments: next.length ? next : undefined });
  };
  const bill = async (r: ScheduleRow) => {
    setBusy(true);
    try {
      const doc = r.final ? await createDocument(project.id, 'facture') : await createDocument(project.id, 'acompte', { amountHT: round2(r.cumulativeHT - invoicedHT(docs)), label: r.moment.name });
      nav('/documents/' + doc.id);
    } catch (err) { alert((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <h2>Échéancier de facturation</h2>
      <p className="muted" style={{ marginTop: 0 }}>Moments {source} (3 au plus). Les échéances arrivent dans « Export comptable → À facturer ».</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
        {all.map((m) => (
          <label key={m.id} className="check-row"><input type="checkbox" checked={moments.some((x) => x.id === m.id)} onChange={(e) => toggle(m.id, e.target.checked)} /> {m.name} ({m.percent} %)</label>
        ))}
      </div>
      <table className="list">
        <thead><tr><th>Moment</th><th>Échéance</th><th className="n">Montant HT</th><th>État</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.moment.id}>
              <td>{r.moment.name} <span className="muted">· {MOMENT_TRIGGERS[r.moment.trigger]}</span></td>
              <td>{r.due ? fmtDate(r.due) : <span className="muted">à la confirmation</span>}</td>
              <td className="n">{money(r.amountHT)}</td>
              <td><span className={'badge ' + (r.state === 'facture' ? 'st-confirme' : r.state === 'en_retard' ? 'st-annule' : r.state === 'a_facturer' ? 'st-option' : '')}>{MOMENT_STATE_LABELS[r.state]}</span></td>
              <td>{r.state !== 'facture' && CONFIRMED.includes(project.status) && !project.externalInvoiced && (
                <button className="small" disabled={busy} onClick={() => bill(r)}>{r.final ? 'Facture finale' : 'Facturer'}</button>
              )}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="check-row" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={!!project.externalInvoiced} onChange={(e) => patch(db.projects, project.id, { externalInvoiced: e.target.checked || undefined })} /> Facturé en dehors de FabEvent (ne plus le rappeler)
      </label>
    </div>
  );
}
