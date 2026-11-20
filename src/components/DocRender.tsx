import { Fragment, useMemo, type CSSProperties, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_DOC_STYLE } from '../db';
import { DEFAULT_HTML, fillTemplate, stripScripts } from '../docTemplate';
import { epcPayload, qrSvg } from '../payment';
import { docLang, REMINDER_TEXTS, tr, VAT_SHORT } from '../i18n';
import type { Doc, DocStyle } from '../types';
import { INVOICE_TYPES } from '../types';
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
.doc .text{white-space:pre-wrap;margin:14px 0}.doc .mention{font-size:12px;font-style:italic;text-align:right}
.doc .pay{display:flex;gap:16px;align-items:center;border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin-top:16px}.doc .pay svg{flex:none}
.doc .pay .comm{font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:700}.doc .pre{white-space:pre-line}
.doc tr.opt td{color:#666;font-style:italic}
.doc .sign{display:flex;gap:24px;margin-top:24px}.doc .sign div{flex:1;border:1px solid #ccc;height:80px;padding:6px;border-radius:6px}
@media print{.doc{padding:0;max-width:none}}
`;

/** Ancien format conservé pour compatibilité : {client}, {projet}… */
export function fillVars(text: string | undefined, doc: Doc): string {
  return text ? fillTemplate(text, doc) : '';
}

/** Rend un document : gabarit HTML (en-tête, mise en page, pied) + blocs générés. */
export function DocRender({ doc }: { doc: Doc }) {
  const st = { ...DEFAULT_DOC_STYLE, ...doc.snapshot.template?.style };
  const html = useMemo(() => buildDocHtml(doc), [doc]);
  return <div className={`doc f-${st.font}`} style={{ '--accent': st.color } as CSSProperties} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function buildDocHtml(doc: Doc): string {
  const s = doc.snapshot;
  const t = s.template;
  const st: DocStyle = { ...DEFAULT_DOC_STYLE, ...t?.style };
  const h = { ...DEFAULT_HTML, ...t?.html };
  const showPrices = !s.hidePrices;
  const isRoadmap = doc.type === 'feuille_route';
  const isPacking = doc.type === 'bon_sortie';
  const isInvoice = INVOICE_TYPES.includes(doc.type);
  const depositsTTC = (s.deposits || []).reduce((a, d) => a + d.ttc, 0);
  const r = (el: ReactElement) => renderToStaticMarkup(el);
  const text = (v?: string) => (v ? `<div class="text">${fillTemplate(v, doc)}</div>` : '');
  const intro = t?.intro || (s.reminder ? REMINDER_TEXTS[docLang(doc)][Math.min(3, s.reminder.level) as 1 | 2 | 3] : '');

  const blocks: Record<string, string> = {
    'bloc.introduction': text(intro),
    'bloc.conclusion': text(t?.outro),
    'bloc.salles': r(<Rooms doc={doc} st={st} />),
    'bloc.frais': s.extras?.length && showPrices ? r(
      <section>
        <h2>{tr(doc, 'extras')}</h2>
        <table>
          <thead><tr><th className="n">{tr(doc, 'qty')}</th><th>{tr(doc, 'item')}</th><th className="n">{tr(doc, 'unitPrice')}</th><th className="n">{tr(doc, 'totalExcl')}</th></tr></thead>
          <tbody>{s.extras.map((x, i) => <tr key={i}><td className="n">{x.qty}</td><td>{x.label}</td><td className="n">{money(x.unitPrice)}</td><td className="n">{money(x.total)}</td></tr>)}</tbody>
        </table>
      </section>,
    ) : '',
    'bloc.lignes_simples': s.simpleLines?.length ? r(
      <table style={{ marginTop: 16 }}>
        <thead><tr><th>{tr(doc, 'item')}</th><th className="n">{tr(doc, 'amountExcl')}</th></tr></thead>
        <tbody>{s.simpleLines.map((l, i) => <tr key={i}><td>{l.label}</td><td className="n">{money(l.ht)}</td></tr>)}</tbody>
      </table>,
    ) : '',
    'bloc.options': showPrices && s.optionalTotal ? r(<p className="muted">{tr(doc, 'options')} : {money(s.optionalTotal)}</p>) : '',
    'bloc.totaux': showPrices ? r(
      <table className="totals">
        <tbody>
          {s.discountAmount > 0 && <tr><td>{tr(doc, 'discount')} ({s.project.discount} %)</td><td className="n">− {money(s.discountAmount)}</td></tr>}
          {!s.reminder && <tr><td>{tr(doc, 'totalExcl')}</td><td className="n">{money(s.totalHT)}</td></tr>}
          {!s.reminder && <tr><td>{tr(doc, 'vat')} {s.vatRate} %{s.vatRegime && s.vatRegime !== 'normal' ? ` (${VAT_SHORT[docLang(doc)][s.vatRegime]})` : ''}</td><td className="n">{money(s.vat)}</td></tr>}
          <tr className="grand"><td>{s.reminder ? tr(doc, 'remaining') : tr(doc, 'totalIncl')}</td><td className="n">{money(s.totalTTC)}</td></tr>
          {(s.deposits || []).map((d) => <tr key={d.number}><td>{tr(doc, 'deposit')} {d.number}</td><td className="n">− {money(d.ttc)}</td></tr>)}
          {depositsTTC > 0 && <tr className="grand"><td>{tr(doc, 'toPay')}</td><td className="n">{money(s.totalTTC - depositsTTC)}</td></tr>}
        </tbody>
      </table>,
    ) : '',
    'bloc.signature': doc.type === 'devis' && st.showSignature ? r(<div className="sign"><div>{tr(doc, 'approval')}</div></div>)
      : isPacking ? r(<div className="sign"><div>{tr(doc, 'preparedBy')}</div><div>{tr(doc, 'checkedBy')}</div></div>) : '',
    'bloc.paiement': paymentBlock(doc),
    'bloc.mention_tva': s.vatMention ? `<p class="mention">${esc(s.vatMention)}</p>` : '',
  };
  // la mention de TVA suit les totaux, sauf si le gabarit la place lui-même
  if (!h.layout.includes('bloc.mention_tva')) blocks['bloc.totaux'] += blocks['bloc.mention_tva'];
  blocks['bloc.entete'] = fillTemplate(h.header, doc, blocks);
  blocks['bloc.pied'] = isRoadmap || !s.footer && h.footer === DEFAULT_HTML.footer ? '' : fillTemplate(h.footer, doc, blocks);
  const css = h.css.trim() ? `<style>${h.css.replace(/<\/style/gi, '')}</style>` : '';
  return stripScripts(css + fillTemplate(h.layout, doc, blocks));
}

/** Bloc des salles : horaires, matériel, personnel, transport, sous-totaux. */
function Rooms({ doc, st }: { doc: Doc; st: DocStyle }) {
  const s = doc.snapshot;
  const showPrices = !s.hidePrices;
  const isPacking = doc.type === 'bon_sortie';
  const isRoadmap = doc.type === 'feuille_route';
  const summaryOnly = showPrices && st.hideEquipmentDetail;
  const priceCols = 1 + (st.showFactor ? 1 : 0) + (st.showDiscount ? 1 : 0) + 1;
  return (
    <>
      {(isRoadmap || isPacking) && s.project.notes && <p style={{ whiteSpace: 'pre-wrap' }}>{s.project.notes}</p>}
      {s.partialRooms && <p><strong>{tr(doc, 'partial')} :</strong> {s.partialRooms.join(', ')}</p>}
      {s.partialInvoices?.map((p) => <p key={p.number} className="muted">{tr(doc, 'alreadyInvoiced')} {p.number} : {p.rooms.join(', ')} ({money(p.ht)} HT)</p>)}
      {s.subprojects.map((sp, i) => {
        const eqLines = sp.equipment.filter((l) => !(showPrices && st.hideZero && !l.total && !l.unitPrice));
        const eqTotal = sp.equipment.filter((l) => !l.optional).reduce((a, l) => a + l.total, 0);
        return (
          <section key={i}>
            <h2>{sp.name}</h2>
            <div className="muted">{fmtDate(sp.start)} → {fmtDate(sp.end)}{sp.venue && ` · ${sp.venue}`}</div>
            {st.showPeriods && sp.periods && sp.periods.length > 0 && (
              <>
                <h3>{tr(doc, 'schedule')}</h3>
                <table><tbody>{sp.periods.map((p, k) => <tr key={k}><td style={{ width: '40%' }}><strong>{p.name}</strong></td><td>{fmtDate(p.start)} → {fmtDate(p.end)}</td></tr>)}</tbody></table>
              </>
            )}
            {summaryOnly && sp.equipment.length > 0 && (
              <table><tbody><tr><td>{tr(doc, 'rental')} ({sp.equipment.filter((l) => !l.optional).length} {tr(doc, 'lines')})</td><td className="n">{money(eqTotal)}</td></tr></tbody></table>
            )}
            {!summaryOnly && eqLines.length > 0 && (
              <>
                <h3>{tr(doc, 'equipment')}</h3>
                <table>
                  <thead>
                    <tr>
                      {isPacking && <th>{tr(doc, 'out')}</th>}
                      {isPacking && <th>{tr(doc, 'back')}</th>}
                      <th className="n">{tr(doc, 'qty')}</th>
                      <th>{tr(doc, 'item')}</th>
                      {showPrices && <>
                        <th className="n">{tr(doc, 'unitPrice')}</th>
                        {st.showFactor && <th className="n">{tr(doc, 'factor')}</th>}
                        {st.showDiscount && <th className="n">{tr(doc, 'discount')}</th>}
                        <th className="n">{tr(doc, 'totalExcl')}</th>
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
                        <td>{l.name}{st.showCode && l.code && <span className="muted"> ({l.code})</span>}{l.optional && ` — ${tr(doc, 'option')}`}</td>
                        {showPrices && <>
                          <td className="n">{money(l.unitPrice)}</td>
                          {st.showFactor && <td className="n">{l.unit === 'pièce' ? tr(doc, 'sale') : `${l.factor} (${l.days} ${tr(doc, 'days')})`}</td>}
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
                <h3>{tr(doc, 'crew')}</h3>
                <table>
                  <thead><tr><th>{tr(doc, 'function')}</th>{isRoadmap && <th>{tr(doc, 'name')}</th>}{isRoadmap && <th>{tr(doc, 'phone')}</th>}<th>{tr(doc, 'hours')}</th>{showPrices && <><th className="n">{tr(doc, 'quantity')}</th><th className="n">{tr(doc, 'rate')}</th><th className="n">{tr(doc, 'totalExcl')}</th></>}</tr></thead>
                  <tbody>
                    {sp.crew.filter((x) => isRoadmap || x.billable || !showPrices).filter((x) => !(showPrices && st.hideZero && !x.total)).map((x, j) => (
                      <tr key={j}>
                        <td>{x.function}</td>
                        {isRoadmap && <td>{x.person || '—'}</td>}
                        {isRoadmap && <td>{x.phone || ''}</td>}
                        <td>{fmtDate(x.start)} → {fmtDate(x.end)}{!showPrices && x.departure && <div className="muted">{tr(doc, 'departure')} {fmtDate(x.departure)} · {tr(doc, 'return')} {fmtDate(x.back)}</div>}</td>
                        {showPrices && <>
                          <td className="n">{x.unit === 'heure' ? `${x.hours} h${x.overtime ? ` (${tr(doc, 'of')} ${x.overtime} ${tr(doc, 'overtime')})` : ''}` : `${x.days} ${tr(doc, 'days')}`}</td>
                          <td className="n">{money(x.rate)}{x.unit === 'heure' ? '/h' : `/${tr(doc, 'days')}`}</td>
                          <td className="n">{money(x.total)}</td>
                        </>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
            {(sp.vehicles.length > 0 && (!showPrices || sp.vehicles.some((v) => v.billable))) && (
              <>
                <h3>{tr(doc, 'transport')}</h3>
                <table>
                  <thead><tr><th>{tr(doc, 'vehicle')}</th>{!showPrices && <th>{tr(doc, 'driver')}</th>}<th>{tr(doc, 'period')}</th>{showPrices && <th className="n">{tr(doc, 'totalExcl')}</th>}</tr></thead>
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
            {showPrices && st.showSubtotals && <div className="right"><strong>{tr(doc, 'subtotal')} {sp.name} : {money(sp.subtotal)}</strong></div>}
          </section>
        );
      })}
    </>
  );
}


const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const DEFAULT_REMINDER_TEXT = REMINDER_TEXTS.fr;

/** Bloc de paiement : IBAN, communication (structurée) et QR code de virement. */
export function paymentBlock(doc: Doc): string {
  const s = doc.snapshot;
  const payable = doc.type === 'facture' || doc.type === 'acompte' || doc.type === 'rappel';
  if (!payable || !s.company.iban) return '';
  const deposits = (s.deposits || []).reduce((a, d) => a + d.ttc, 0);
  const amount = Math.round((s.totalTTC - deposits) * 100) / 100;
  const comm = s.payment?.communication || doc.number;
  let qr = '';
  try {
    if (amount > 0) qr = qrSvg(epcPayload({ name: s.company.name, iban: s.company.iban, bic: s.company.bic, amount, communication: comm }), 110);
  } catch { /* QR impossible : on garde le texte */ }
  return `<div class="pay">${qr}<div>
    <div>${tr(doc, 'pay')} <strong>${esc(money(amount))}</strong> ${tr(doc, 'onAccount')} <strong>${esc(s.company.iban)}</strong>${s.company.bic ? ` (BIC ${esc(s.company.bic)})` : ''}</div>
    <div>${tr(doc, 'withComm')}${s.payment?.structured ? ` ${tr(doc, 'structured')}` : ''} :</div><div class="comm">${esc(comm)}</div>
    ${qr ? `<div class="muted" style="font-size:11px">${tr(doc, 'scan')}</div>` : ''}
  </div></div>`;
}
