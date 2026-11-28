import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { Empty, Field, Modal, NumInput } from '../../components/ui';
import { invoiceSchedule, MOMENT_STATE_LABELS, projectMoments, settingsMoments, type ScheduleRow } from '../../invoicing';
import { db } from '../../db';
import { createDocument } from '../../documents';
import type { DepositStatus, DiscountPart, DocType } from '../../types';
import { CONFIRMED, DEPOSIT_LABELS, DISCOUNT_PARTS, DOC_LABELS, DOC_STATUS_LABELS, INVOICE_TYPES, MOMENT_TRIGGERS } from '../../types';
import { fmtDate, lineDays, lineTotal, money, patch, round2 } from '../../utils';
import { computeFinance, invoicedHT, isPerPiece, type ProjectData } from './shared';
import { hrOrders } from './hrOrders';

/** Onglet Finances : chiffre d'affaires, coûts et marge par catégorie, remise, documents. */
export default function FinanceTab({ d }: { d: ProjectData }) {
  const nav = useNavigate();
  const { project, docs, settings } = d;
  const [busy, setBusy] = useState(false);
  const [olderOpen, setOlderOpen] = useState<Set<DocType>>(new Set());
  const [roomInvoice, setRoomInvoice] = useState(false);
  const invoicedRooms = new Set(docs.filter((x) => x.type === 'facture' && x.subprojectIds).flatMap((x) => x.subprojectIds || []));
  const invoiced = invoicedHT(docs);

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
      <FinanceOverview d={d} invoiced={invoiced} />

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
        for (const c of d.costs.filter((x) => x.supplierName?.trim() || x.supplierId)) { const k = c.supplierName?.trim() || cName.get(c.supplierId!) || '?'; rows.set(k, (rows.get(k) || 0) + c.amount); }
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
        {docs.length === 0 ? <Empty>Aucun document pour l'instant.</Empty> : (() => {
          // le plus récent de chaque type ; les plus anciens sur demande
          const byType = new Map<DocType, typeof docs>();
          for (const x of [...docs].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) byType.set(x.type, [...(byType.get(x.type) || []), x]);
          const order: DocType[] = ['devis', 'acompte', 'facture', 'avoir', 'rappel', 'bon_sortie', 'feuille_route'];
          const types = [...byType.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
          const row = (x: (typeof docs)[number], older = false) => (
            <tr key={x.id} className={'click' + (older ? ' doc-older' : '')} onClick={() => nav('/documents/' + x.id)}>
              <td>{older ? <span className="muted">{DOC_LABELS[x.type]}</span> : DOC_LABELS[x.type]}</td><td><strong>{x.number}</strong></td><td>{INVOICE_TYPES.includes(x.type) ? '' : `v${x.version}`}</td>
              <td>{fmtDate(x.createdAt)}</td>
              <td className="n">{x.snapshot.hidePrices ? '—' : money(x.snapshot.totalHT)}</td>
              <td><span className="badge">{DOC_STATUS_LABELS[x.status]}</span></td>
            </tr>
          );
          return (
            <table className="list docs-list">
              <thead><tr><th>Type</th><th>Numéro</th><th>Version</th><th>Date</th><th className="n">Total HT</th><th>Statut</th></tr></thead>
              {types.map((t) => {
                const list = byType.get(t)!;
                const open = olderOpen.has(t);
                return (
                  <tbody key={t}>
                    {row(list[0])}
                    {list.length > 1 && (
                      <tr className="doc-more"><td colSpan={6}>
                        <button type="button" className="ghost small" aria-expanded={open} onClick={() => { const n = new Set(olderOpen); if (open) n.delete(t); else n.add(t); setOlderOpen(n); }}>
                          <Icon name={open ? 'chevron-down' : 'chevron-right'} />{open ? 'Masquer' : 'Plus anciens'} ({list.length - 1} {DOC_LABELS[t].toLowerCase()}{list.length > 2 ? 's' : ''})
                        </button>
                      </td></tr>
                    )}
                    {open && list.slice(1).map((x) => row(x, true))}
                  </tbody>
                );
              })}
            </table>
          );
        })()}
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
    <input className="w-price" inputMode="decimal" value={v} placeholder={String(placeholder).replace('.', ',') + (suffix || '')} aria-label={`Montant réel (défaut ${String(placeholder).replace('.', ',')}${suffix || ''})`} title="Montant réel constaté ; vide = valeur prévue" onChange={(e) => setV(e.target.value)}
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

/* ---------- Aperçu financier (tout le projet ou un sous-projet) ---------- */

/** Chiffres d'une partie du projet : tout le projet, ou un sous-projet. */
function financeOf(d: ProjectData, subId: string) {
  const subs = subId ? d.subs.filter((s) => s.id === subId) : d.subs;
  const ids = new Set(subs.map((s) => s.id));
  const lines = d.lines.filter((l) => ids.has(l.subprojectId));
  // coûts supplémentaires et rendez-vous : rattachés au projet, pas à un sous-projet
  const costs = subId ? [] : d.costs;
  const srCost = d.subrentals.filter((s) => s.status !== 'annule' && (!subId || s.subprojectId === subId)).reduce((a, s) => a + s.lines.reduce((b, l) => b + l.cost, 0), 0);
  const appt = subId ? 0 : d.projectAppts.reduce((a, x) => a + (x.cost || 0), 0);
  const f = computeFinance(d.project, subs, lines, d.projectCrew.filter((c) => ids.has(c.subprojectId)), d.projectVas.filter((v) => ids.has(v.subprojectId)), costs, d.people, d.eqMap, d.settings, srCost, appt);
  // matériel : location / vente, avant et après les remises des lignes
  const eq = { locBrut: 0, loc: 0, venteBrut: 0, vente: 0, venteCost: 0, locCost: round2(srCost) };
  const active = new Map(subs.filter((s) => s.status !== 'annule').map((s) => [s.id, s]));
  for (const l of lines) {
    const sp = active.get(l.subprojectId);
    if (!sp || l.optional) continue;
    const per = isPerPiece(l, d.eqMap), days = lineDays(l, sp);
    const fg = l.equipmentId ? d.eqMap.get(l.equipmentId)?.factorGroupId : undefined;
    const t = lineTotal(l, days, d.settings, per, fg), brut = lineTotal({ ...l, discount: 0 }, days, d.settings, per, fg);
    if (per) { eq.vente += t; eq.venteBrut += brut; eq.venteCost += l.qty * (d.eqMap.get(l.equipmentId!)?.costPrice || 0); }
    else { eq.loc += t; eq.locBrut += brut; }
  }
  return { f, eq };
}

/** Petit anneau de progression (facturé, bénéfice). */
function Ring({ value, danger }: { value: number; danger?: boolean }) {
  const v = Math.max(0, Math.min(1, value)), r = 15, c = 2 * Math.PI * r;
  return (
    <svg className="ring" viewBox="0 0 36 36" width="40" height="40" aria-hidden="true">
      <circle cx="18" cy="18" r={r} fill="none" stroke="var(--border)" strokeWidth="4" />
      <circle cx="18" cy="18" r={r} fill="none" stroke={danger ? 'var(--danger)' : 'var(--accent)'} strokeWidth="4" strokeDasharray={`${v * c} ${c}`} transform="rotate(-90 18 18)" strokeLinecap="round" />
    </svg>
  );
}

function FinanceOverview({ d, invoiced }: { d: ProjectData; invoiced: number }) {
  const { project, settings } = d;
  const [subId, setSubId] = useState('');
  const [openEq, setOpenEq] = useState(false);
  const { f, eq } = financeOf(d, subId);
  const whole = !subId;
  // chiffre d'affaires avant toute remise (lignes et partie)
  const brutOf = (r: (typeof f.rows)[number]) => (r.label === 'Matériel' ? round2(eq.locBrut + eq.venteBrut) : r.before ?? r.revenue);
  const brut = round2(f.rows.reduce((a, r) => a + brutOf(r), 0));
  const lineDisc = round2(brut - f.gross);
  const totalDisc = round2(lineDisc + f.discount);
  const pctN = (a: number, b: number) => (b ? (a / b) * 100 : 0);
  const pctT = (a: number, b: number) => (b ? `${pctN(a, b).toFixed(1).replace('.', ',')} %` : '—');
  const actualCost = whole ? f.actualCost : f.cost;
  const actualMargin = round2(f.totalHT - actualCost);
  /** remise sur une partie (matériel, personnel…) : modifiable sur tout le projet, rappelée par sous-projet */
  const partInput = (part: DiscountPart) => whole
    ? <span className="fin-disc"><NumInput className="w-qty" value={project.partDiscounts?.[part] || 0} aria-label={`Remise ${DISCOUNT_PARTS[part]} %`}
        onChange={(n) => { const pd = { ...(project.partDiscounts || {}) }; if (n) pd[part] = n; else delete pd[part]; return patch(db.projects, project.id, { partDiscounts: Object.keys(pd).length ? pd : undefined }); }} /> %</span>
    : `${project.partDiscounts?.[part] || 0} %`;
  const row = (key: string, label: React.ReactNode, cost: number, real: React.ReactNode, b: number, total: number, kid = false, part?: DiscountPart) => (
    <tr key={key} className={kid ? 'fin-kid' : undefined}>
      <td>{label}</td>
      <td className="n">{money(cost)}</td>
      <td className="n">{real}</td>
      <td className="n">{money(b)}</td>
      <td className="n muted" title={part ? `Remise sur ${DISCOUNT_PARTS[part].toLowerCase()} seulement (avant la remise globale) ; remise effective, lignes comprises : ${b ? pctT(b - total, b) : '—'}` : undefined}>
        {part ? partInput(part) : b && round2(b - total) ? pctT(b - total, b) : '—'}
      </td>
      <td className="n">{money(total)}</td>
      <td className="n" style={{ color: total - cost < 0 ? 'var(--danger)' : undefined }}>{money(round2(total - cost))}</td>
    </tr>
  );
  return (
    <>
      {d.subs.length > 1 && (
        <div className="chips fin-scope" aria-label="Aperçu de">
          <button type="button" className={'chip' + (whole ? ' on' : '')} onClick={() => setSubId('')}>Tout le projet</button>
          {d.subs.map((s) => <button type="button" key={s.id} className={'chip' + (subId === s.id ? ' on' : '')} onClick={() => setSubId(s.id)}>{s.name}{s.status === 'annule' ? ' (annulé)' : ''}</button>)}
        </div>
      )}
      <div className="stats fin-kpis">
        <div className="stat"><b>{money(f.totalHT)}</b><span>total HT{whole ? '' : ' du sous-projet'}{f.discount ? ' (après remise)' : ''}</span></div>
        {whole && <div className="stat fin-ring"><Ring value={f.totalHT ? invoiced / f.totalHT : 0} /><div><b>{money(invoiced)}</b><span>facturé ({pctT(invoiced, f.totalHT)}) · reste {money(round2(f.totalHT - invoiced))}</span></div></div>}
        <div className="stat"><b>{money(f.cost)}</b><span>coûts prévus{whole && f.actualCost !== f.cost ? ` · réels ${money(f.actualCost)}` : ''}</span></div>
        <div className="stat fin-ring"><Ring value={Math.abs(pctN(f.margin, f.totalHT)) / 100} danger={f.margin < 0} /><div><b style={{ color: f.margin < 0 ? 'var(--danger)' : 'var(--ok)' }}>{pctT(f.margin, f.totalHT)}</b><span>bénéfice prévu · marge {money(f.margin)}</span></div></div>
        {whole && <div className="stat fin-ring"><Ring value={Math.abs(pctN(actualMargin, f.totalHT)) / 100} danger={actualMargin < 0} /><div><b style={{ color: actualMargin < 0 ? 'var(--danger)' : undefined }}>{pctT(actualMargin, f.totalHT)}</b><span>bénéfice réel · {money(actualMargin)}</span></div></div>}
        <div className="stat"><b>{money(totalDisc)}</b><span>remise totale ({pctT(totalDisc, brut)})</span></div>
      </div>
      <div className="card fin-overview">
        <h2>Aperçu financier{whole ? '' : ` — ${d.subs.find((s) => s.id === subId)?.name || ''}`}</h2>
        <div className="table-wrap">
          <table className="list fin-table">
            <thead><tr><th>Catégorie</th><th className="n">Coûts prévus</th><th className="n" title="Saisis le coût réel une fois les factures fournisseurs reçues">Coûts réels</th><th className="n" title="Avant les remises des lignes">Chiffre d'affaires</th><th className="n">Remise</th><th className="n">Total HT</th><th className="n">Bénéfice</th></tr></thead>
            <tbody>
              {f.rows.map((r) => {
                const real = whole
                  ? <ActualInput value={project.actualCosts?.[r.label]} placeholder={r.cost} onSave={(v) => {
                    const actualCosts = { ...(project.actualCosts || {}) };
                    if (v === undefined) delete actualCosts[r.label]; else actualCosts[r.label] = v;
                    return patch(db.projects, project.id, { actualCosts: Object.keys(actualCosts).length ? actualCosts : undefined });
                  }} />
                  : <span className="muted">—</span>;
                const label = r.label === 'Matériel'
                  ? <button type="button" className="link-btn fin-toggle" aria-expanded={openEq} onClick={() => setOpenEq(!openEq)}><Icon name={openEq ? 'chevron-down' : 'chevron-right'} />Matériel</button>
                  : r.label;
                return [
                  row(r.label, label, r.cost, real, brutOf(r), r.revenue, false, r.part),
                  ...(r.label === 'Matériel' && openEq ? [
                    row('loc', 'Location', eq.locCost, <span className="muted">—</span>, round2(eq.locBrut), round2(eq.loc), true),
                    row('vente', 'Vente', round2(eq.venteCost), <span className="muted">—</span>, round2(eq.venteBrut), round2(eq.vente), true),
                  ] : []),
                ];
              })}
              <tr className="fin-total"><td><strong>Total</strong></td><td className="n">{money(f.cost)}</td><td className="n">{whole ? money(f.actualCost) : '—'}</td><td className="n">{money(brut)}</td><td className="n muted">{lineDisc ? pctT(lineDisc, brut) : '—'}</td><td className="n"><strong>{money(f.gross)}</strong></td><td className="n">{money(round2(f.gross - f.cost))}</td></tr>
            </tbody>
          </table>
        </div>
        <div className="fin-bottom">
          <p className="muted">
            Coûts prévus : personnel (coût de la personne affectée), sous-locations et consommables, coûts supplémentaires, rendez-vous.
            Coûts réels : à saisir après le projet (vide = coût prévu).
            {!whole && ' Vue d’un sous-projet : les coûts supplémentaires, les rendez-vous et les coûts réels sont comptés sur tout le projet.'}
          </p>
          <table className="fin-summary">
            <tbody>
              <tr><td>Sous-total</td><td className="n">{money(f.gross)}</td></tr>
              <tr><td>Remise globale{f.discount ? <div className="muted" style={{ fontSize: 12 }}>bénéfice après remise {money(f.margin)}</div> : null}</td>
                <td className="n">{whole
                  ? <span className="fin-disc"><NumInput className="w-qty" value={project.discount} onChange={(n) => patch(db.projects, project.id, { discount: n })} aria-label="Remise globale %" /> %</span>
                  : `${project.discount || 0} %`}{f.discount ? <div className="muted">− {money(f.discount)}</div> : null}</td></tr>
              <tr className="fin-strong"><td>Total HT</td><td className="n">{money(f.totalHT)}</td></tr>
              <tr><td>TVA {settings.vatRate} %</td><td className="n">{money(f.vat)}</td></tr>
              <tr className="fin-strong"><td>Total TVA comprise</td><td className="n">{money(f.totalTTC)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
