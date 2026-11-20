import { Fragment, type CSSProperties } from 'react';
import { DEFAULT_DOC_STYLE } from '../db';
import type { Doc } from '../types';
import { DOC_LABELS, INVOICE_TYPES } from '../types';
import { fmtDate, money } from '../utils';

export const DOC_CSS = `
.doc{--accent:#111;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff;max-width:820px;margin:0 auto;padding:32px;font-size:13px;line-height:1.45}
.doc.f-serif{font-family:Georgia,'Times New Roman',serif}.doc.f-arrondie{font-family:'Trebuchet MS','Segoe UI',Verdana,sans-serif}
.doc h1{font-size:22px;margin:0 0 4px;color:var(--accent)}.doc h2{font-size:15px;margin:22px 0 6px;border-bottom:2px solid var(--accent);padding-bottom:3px}
.doc h3{font-size:13px;margin:12px 0 4px;color:#444}
.doc .head{display:flex;justify-content:space-between;gap:24px;margin-bottom:20px}
.doc .head img,.doc .logo-centre img{max-height:60px;max-width:180px}
.doc .logo-centre{text-align:center;margin-bottom:12px}
.doc .box{border:1px solid #ccc;border-top:3px solid var(--accent);border-radius:6px;padding:10px 12px;min-width:220px}
.doc .muted{color:#666}.doc .right{text-align:right}
.doc table{width:100%;border-collapse:collapse;margin:4px 0 8px}
.doc th,.doc td{border-bottom:1px solid #e3e3e3;padding:5px 6px;text-align:left;vertical-align:top}
.doc th{background:#f4f4f4;font-weight:600;font-size:12px}
.doc td.n,.doc th.n{text-align:right;white-space:nowrap}
.doc .check{width:22px;height:14px;border:1px solid #888;display:inline-block}
.doc .totals{margin-left:auto;width:300px;margin-top:12px}
.doc .totals td{border:none;padding:3px 6px}.doc .totals tr.grand td{font-weight:700;font-size:15px;border-top:2px solid var(--accent)}
.doc .foot{margin-top:28px;font-size:11px;color:#666;border-top:1px solid #ddd;padding-top:8px;white-space:pre-wrap}
.doc .text{white-space:pre-wrap;margin:14px 0}
.doc tr.opt td{color:#666;font-style:italic}
.doc .sign{display:flex;gap:24px;margin-top:24px}.doc .sign div{flex:1;border:1px solid #ccc;height:80px;padding:6px;border-radius:6px}
@media print{.doc{padding:0;max-width:none}}
`;

/** Remplace les variables {client}, {projet}… dans les textes du modèle. */
export function fillVars(text: string | undefined, doc: Doc): string {
  if (!text) return '';
  const s = doc.snapshot;
  const vars: Record<string, string> = {
    client: s.client?.company || '',
    contact: doc.contactPerson || [s.client?.firstName, s.client?.lastName].filter(Boolean).join(' ') || '',
    projet: s.project.name,
    numero_projet: s.project.number,
    numero: doc.number,
    date: fmtDate(s.issuedAt, false),
    lieu: s.project.venue || '',
    debut: fmtDate(s.project.start),
    fin: fmtDate(s.project.end),
    total: money(s.totalTTC),
    echeance: s.dueDate ? fmtDate(s.dueDate, false) : '',
    validite: s.validUntil ? fmtDate(s.validUntil, false) : '',
    societe: s.company.name,
  };
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

export function DocRender({ doc }: { doc: Doc }) {
  const s = doc.snapshot;
  const t = s.template;
  const st = { ...DEFAULT_DOC_STYLE, ...t?.style };
  const showPrices = !s.hidePrices;
  const isPacking = doc.type === 'bon_sortie';
  const isRoadmap = doc.type === 'feuille_route';
  const c = s.client;
  const isInvoice = INVOICE_TYPES.includes(doc.type);
  const depositsTTC = (s.deposits || []).reduce((a, d) => a + d.ttc, 0);
  const summaryOnly = showPrices && st.hideEquipmentDetail;
  const priceCols = 1 + (st.showFactor ? 1 : 0) + (st.showDiscount ? 1 : 0) + 1;
  const title = t?.title?.trim() || DOC_LABELS[doc.type];
  const logo = s.company.logo ? <img src={s.company.logo} alt="" /> : null;

  return (
    <div className={`doc f-${st.font}`} style={{ '--accent': st.color } as CSSProperties}>
      {st.logoPosition === 'centre' && logo && <div className="logo-centre">{logo}</div>}
      <div className="head">
        <div>
          {st.logoPosition === 'gauche' && logo}
          <div><strong>{s.company.name}</strong></div>
          {s.company.address && <div style={{ whiteSpace: 'pre-line' }}>{s.company.address}</div>}
          {s.company.phone && <div>{s.company.phone}</div>}
          {s.company.email && <div>{s.company.email}</div>}
          {s.company.siret && <div className="muted">N° d'entreprise {s.company.siret}</div>}
          {s.company.vatNumber && <div className="muted">TVA {s.company.vatNumber}</div>}
        </div>
        <div>
          {st.logoPosition === 'droite' && logo && <div className="right" style={{ marginBottom: 8 }}>{logo}</div>}
          <div className="box">
            <h1>{title}</h1>
            <div>N° <strong>{doc.number}</strong>{!isInvoice && ` — v${doc.version}`}</div>
            <div>Date : {fmtDate(s.issuedAt, false)}</div>
            {s.validUntil && <div>Valable jusqu'au : {fmtDate(s.validUntil, false)}</div>}
            {s.dueDate && doc.type !== 'avoir' && <div>Échéance : {fmtDate(s.dueDate, false)}</div>}
            {s.refNumber && <div>Réf. : {doc.type === 'avoir' ? 'facture' : 'devis'} {s.refNumber}</div>}
            {c && !isRoadmap && (
              <div style={{ marginTop: 8 }}>
                <strong>{c.company}</strong>
                {(c.firstName || c.lastName) && <div>{[c.firstName, c.lastName].filter(Boolean).join(' ')}</div>}
                {c.address && <div>{c.address}</div>}
                {(c.postalCode || c.city) && <div>{[c.postalCode, c.city].filter(Boolean).join(' ')}</div>}
                {c.vatNumber && <div className="muted">TVA {c.vatNumber}</div>}
                {doc.contactPerson && <div>À l'attention de {doc.contactPerson}</div>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div>
        <strong>Projet {s.project.number} — {s.project.name}</strong>
        {s.project.externalRef && !isRoadmap && <div>Votre référence : {s.project.externalRef}</div>}
        <div className="muted">{fmtDate(s.project.start)} → {fmtDate(s.project.end)}{s.project.venue && ` · ${s.project.venue}`}</div>
        {s.project.notes && (isRoadmap || isPacking) && <p style={{ whiteSpace: 'pre-wrap' }}>{s.project.notes}</p>}
      </div>

      {t?.intro && <div className="text">{fillVars(t.intro, doc)}</div>}

      {s.subprojects.map((sp, i) => {
        const eqLines = sp.equipment.filter((l) => !(showPrices && st.hideZero && !l.total && !l.unitPrice));
        const eqTotal = sp.equipment.filter((l) => !l.optional).reduce((a, l) => a + l.total, 0);
        return (
          <section key={i}>
            <h2>{sp.name}</h2>
            <div className="muted">{fmtDate(sp.start)} → {fmtDate(sp.end)}{sp.venue && ` · ${sp.venue}`}</div>
            {st.showPeriods && sp.periods && sp.periods.length > 0 && (
              <>
                <h3>Horaires</h3>
                <table>
                  <tbody>
                    {sp.periods.map((p, k) => (
                      <tr key={k}><td style={{ width: '40%' }}><strong>{p.name}</strong></td><td>{fmtDate(p.start)} → {fmtDate(p.end)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {summaryOnly && sp.equipment.length > 0 && (
              <table><tbody><tr><td>Location de matériel ({sp.equipment.filter((l) => !l.optional).length} lignes)</td><td className="n">{money(eqTotal)}</td></tr></tbody></table>
            )}
            {!summaryOnly && eqLines.length > 0 && (
              <>
                <h3>Matériel</h3>
                <table>
                  <thead>
                    <tr>
                      {isPacking && <th>Sortie</th>}
                      {isPacking && <th>Retour</th>}
                      <th className="n">Qté</th>
                      <th>Désignation</th>
                      {showPrices && <>
                        <th className="n">P.U.</th>
                        {st.showFactor && <th className="n">Coef.</th>}
                        {st.showDiscount && <th className="n">Remise</th>}
                        <th className="n">Total HT</th>
                      </>}
                    </tr>
                  </thead>
                  <tbody>
                    {eqLines.map((l, j) => (<Fragment key={j}>
                      {st.showGroups && l.group && l.group !== eqLines[j - 1]?.group && (
                        <tr><td colSpan={(isPacking ? 4 : 2) + (showPrices ? priceCols : 0)} style={{ fontWeight: 600, background: '#fafafa' }}>{l.group}</td></tr>
                      )}
                      <tr className={l.optional ? 'opt' : ''}>
                        {isPacking && <td><span className="check" /></td>}
                        {isPacking && <td><span className="check" /></td>}
                        <td className="n">{l.qty}</td>
                        <td>{l.name}{st.showCode && l.code && <span className="muted"> ({l.code})</span>}{l.optional && ' — en option'}</td>
                        {showPrices && <>
                          <td className="n">{money(l.unitPrice)}</td>
                          {st.showFactor && <td className="n">{l.unit === 'pièce' ? 'vente' : `${l.factor} (${l.days} j)`}</td>}
                          {st.showDiscount && <td className="n">{l.discount ? `${l.discount} %` : ''}</td>}
                          <td className="n">{money(l.total)}</td>
                        </>}
                      </tr>
                    </Fragment>))}
                  </tbody>
                </table>
              </>
            )}

            {(sp.crew.length > 0 && (isRoadmap || sp.crew.some((x) => x.billable))) && (
              <>
                <h3>Personnel</h3>
                <table>
                  <thead><tr><th>Fonction</th>{isRoadmap && <th>Nom</th>}{isRoadmap && <th>Tél.</th>}<th>Horaires</th>{showPrices && <><th className="n">Jours</th><th className="n">Tarif/j</th><th className="n">Total HT</th></>}</tr></thead>
                  <tbody>
                    {sp.crew.filter((x) => isRoadmap || x.billable || !showPrices).filter((x) => !(showPrices && st.hideZero && !x.total)).map((x, j) => (
                      <tr key={j}>
                        <td>{x.function}</td>
                        {isRoadmap && <td>{x.person || '—'}</td>}
                        {isRoadmap && <td>{x.phone || ''}</td>}
                        <td>{fmtDate(x.start)} → {fmtDate(x.end)}</td>
                        {showPrices && <><td className="n">{x.days}</td><td className="n">{money(x.rate)}</td><td className="n">{money(x.total)}</td></>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {(sp.vehicles.length > 0 && (!showPrices || sp.vehicles.some((v) => v.billable))) && (
              <>
                <h3>Transport</h3>
                <table>
                  <thead><tr><th>Véhicule</th>{!showPrices && <th>Chauffeur</th>}<th>Période</th>{showPrices && <th className="n">Total HT</th>}</tr></thead>
                  <tbody>
                    {sp.vehicles.filter((v) => !showPrices || v.billable).map((v, j) => (
                      <tr key={j}>
                        <td>{v.name}{v.plate && ` (${v.plate})`}{v.km ? <span className="muted"> — {v.trips ? `${v.trips} A/R, ` : ''}{v.km} km</span> : null}</td>
                        {!showPrices && <td>{v.driver || '—'}</td>}
                        <td>{fmtDate(v.start)} → {fmtDate(v.end)}</td>
                        {showPrices && <td className="n">{money(v.price)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {showPrices && st.showSubtotals && <div className="right"><strong>Sous-total {sp.name} : {money(sp.subtotal)}</strong></div>}
          </section>
        );
      })}

      {s.extras && s.extras.length > 0 && showPrices && (
        <section>
          <h2>Frais supplémentaires</h2>
          <table>
            <thead><tr><th className="n">Qté</th><th>Désignation</th><th className="n">P.U.</th><th className="n">Total HT</th></tr></thead>
            <tbody>{s.extras.map((x, i) => <tr key={i}><td className="n">{x.qty}</td><td>{x.label}</td><td className="n">{money(x.unitPrice)}</td><td className="n">{money(x.total)}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      {s.simpleLines && s.simpleLines.length > 0 && (
        <table style={{ marginTop: 16 }}>
          <thead><tr><th>Désignation</th><th className="n">Montant HT</th></tr></thead>
          <tbody>{s.simpleLines.map((l, i) => <tr key={i}><td>{l.label}</td><td className="n">{money(l.ht)}</td></tr>)}</tbody>
        </table>
      )}

      {showPrices && s.optionalTotal ? <p className="muted">Options proposées (non incluses dans le total) : {money(s.optionalTotal)} HT</p> : null}

      {showPrices && (
        <table className="totals">
          <tbody>
            {s.discountAmount > 0 && <tr><td>Remise ({s.project.discount} %)</td><td className="n">− {money(s.discountAmount)}</td></tr>}
            <tr><td>Total HT</td><td className="n">{money(s.totalHT)}</td></tr>
            <tr><td>TVA {s.vatRate} %</td><td className="n">{money(s.vat)}</td></tr>
            <tr className="grand"><td>Total TTC</td><td className="n">{money(s.totalTTC)}</td></tr>
            {(s.deposits || []).map((d) => <tr key={d.number}><td>Acompte {d.number}</td><td className="n">− {money(d.ttc)}</td></tr>)}
            {depositsTTC > 0 && <tr className="grand"><td>Reste à payer</td><td className="n">{money(s.totalTTC - depositsTTC)}</td></tr>}
          </tbody>
        </table>
      )}

      {t?.outro && <div className="text">{fillVars(t.outro, doc)}</div>}

      {doc.type === 'devis' && st.showSignature && <div className="sign"><div>Bon pour accord (date, signature, cachet)</div></div>}
      {isPacking && <div className="sign"><div>Préparé par</div><div>Vérifié / retour par</div></div>}
      {isInvoice && doc.type !== 'avoir' && s.company.iban && <p>Règlement par virement — IBAN : {s.company.iban}{s.company.bic && ` — BIC : ${s.company.bic}`} — communication : {doc.number}</p>}
      {s.footer && !isRoadmap && <div className="foot">{s.footer}</div>}
    </div>
  );
}
