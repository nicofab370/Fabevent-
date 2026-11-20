import type { Doc } from '../types';
import { DOC_LABELS, INVOICE_TYPES } from '../types';
import { fmtDate, money } from '../utils';

export const DOC_CSS = `
.doc{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;background:#fff;max-width:820px;margin:0 auto;padding:32px;font-size:13px;line-height:1.45}
.doc h1{font-size:22px;margin:0 0 4px}.doc h2{font-size:15px;margin:22px 0 6px;border-bottom:2px solid #111;padding-bottom:3px}
.doc h3{font-size:13px;margin:12px 0 4px;color:#444}
.doc .head{display:flex;justify-content:space-between;gap:24px;margin-bottom:20px}
.doc .head img{max-height:60px;max-width:180px}
.doc .box{border:1px solid #ccc;border-radius:6px;padding:10px 12px;min-width:220px}
.doc .muted{color:#666}.doc .right{text-align:right}
.doc table{width:100%;border-collapse:collapse;margin:4px 0 8px}
.doc th,.doc td{border-bottom:1px solid #e3e3e3;padding:5px 6px;text-align:left;vertical-align:top}
.doc th{background:#f4f4f4;font-weight:600;font-size:12px}
.doc td.n,.doc th.n{text-align:right;white-space:nowrap}
.doc .check{width:22px;height:14px;border:1px solid #888;display:inline-block}
.doc .totals{margin-left:auto;width:300px;margin-top:12px}
.doc .totals td{border:none;padding:3px 6px}.doc .totals tr.grand td{font-weight:700;font-size:15px;border-top:2px solid #111}
.doc .foot{margin-top:28px;font-size:11px;color:#666;border-top:1px solid #ddd;padding-top:8px;white-space:pre-wrap}
.doc tr.opt td{color:#666;font-style:italic}
.doc .sign{display:flex;gap:24px;margin-top:24px}.doc .sign div{flex:1;border:1px solid #ccc;height:80px;padding:6px;border-radius:6px}
@media print{.doc{padding:0;max-width:none}}
`;

export function DocRender({ doc }: { doc: Doc }) {
  const s = doc.snapshot;
  const showPrices = !s.hidePrices;
  const isPacking = doc.type === 'bon_sortie';
  const isRoadmap = doc.type === 'feuille_route';
  const c = s.client;
  const isInvoice = INVOICE_TYPES.includes(doc.type);
  const depositsTTC = (s.deposits || []).reduce((a, d) => a + d.ttc, 0);
  return (
    <div className="doc">
      <div className="head">
        <div>
          {s.company.logo && <img src={s.company.logo} alt="" />}
          <div><strong>{s.company.name}</strong></div>
          {s.company.address && <div style={{ whiteSpace: 'pre-line' }}>{s.company.address}</div>}
          {s.company.phone && <div>{s.company.phone}</div>}
          {s.company.email && <div>{s.company.email}</div>}
          {s.company.siret && <div className="muted">SIRET {s.company.siret}</div>}
          {s.company.vatNumber && <div className="muted">TVA {s.company.vatNumber}</div>}
        </div>
        <div className="box">
          <h1>{DOC_LABELS[doc.type]}</h1>
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

      <div>
        <strong>Projet {s.project.number} — {s.project.name}</strong>
        <div className="muted">{fmtDate(s.project.start)} → {fmtDate(s.project.end)}{s.project.venue && ` · ${s.project.venue}`}</div>
        {s.project.notes && (isRoadmap || isPacking) && <p style={{ whiteSpace: 'pre-wrap' }}>{s.project.notes}</p>}
      </div>

      {s.subprojects.map((sp, i) => (
        <section key={i}>
          <h2>{sp.name}</h2>
          <div className="muted">{fmtDate(sp.start)} → {fmtDate(sp.end)}{sp.venue && ` · ${sp.venue}`}</div>
          {sp.periods && sp.periods.length > 0 && (
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

          {sp.equipment.length > 0 && (
              <>
                <h3>Matériel</h3>
                <table>
                  <thead>
                    <tr>
                      {isPacking && <th>Sortie</th>}
                      {isPacking && <th>Retour</th>}
                      <th className="n">Qté</th>
                      <th>Désignation</th>
                      {showPrices && <><th className="n">P.U./j</th><th className="n">Coef.</th><th className="n">Remise</th><th className="n">Total HT</th></>}
                    </tr>
                  </thead>
                  <tbody>
                    {sp.equipment.map((l, j) => (
                      <tr key={j} className={l.optional ? 'opt' : ''}>
                        {isPacking && <td><span className="check" /></td>}
                        {isPacking && <td><span className="check" /></td>}
                        <td className="n">{l.qty}</td>
                        <td>{l.name}{l.code && <span className="muted"> ({l.code})</span>}{l.optional && ' — en option'}</td>
                        {showPrices && <>
                          <td className="n">{money(l.unitPrice)}</td>
                          <td className="n">{l.unit === 'pièce' ? 'vente' : `${l.factor} (${l.days} j)`}</td>
                          <td className="n">{l.discount ? `${l.discount} %` : ''}</td>
                          <td className="n">{money(l.total)}</td>
                        </>}
                      </tr>
                    ))}
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
                  {sp.crew.filter((x) => isRoadmap || x.billable || !showPrices).map((x, j) => (
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
                      <td>{v.name}{v.plate && ` (${v.plate})`}</td>
                      {!showPrices && <td>{v.driver || '—'}</td>}
                      <td>{fmtDate(v.start)} → {fmtDate(v.end)}</td>
                      {showPrices && <td className="n">{money(v.price)}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {showPrices && <div className="right"><strong>Sous-total {sp.name} : {money(sp.subtotal)}</strong></div>}
        </section>
      ))}

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

      {doc.type === 'devis' && <div className="sign"><div>Bon pour accord (date, signature, cachet)</div></div>}
      {isPacking && <div className="sign"><div>Préparé par</div><div>Vérifié / retour par</div></div>}
      {isInvoice && doc.type !== 'avoir' && s.company.iban && <p>Règlement par virement — IBAN : {s.company.iban}{s.company.bic && ` — BIC : ${s.company.bic}`} — communication : {doc.number}</p>}
      {s.footer && !isRoadmap && <div className="foot">{s.footer}</div>}
    </div>
  );
}
