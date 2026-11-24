import { Fragment, useMemo, type CSSProperties, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_DOC_STYLE } from '../db';
import { DEFAULT_HTML, fillTemplate, stripScripts, withDefaults } from '../docTemplate';
import { epcPayload, qrSvg } from '../payment';
import { docLang, REMINDER_TEXTS, tr, VAT_SHORT } from '../i18n';
import type { Doc, DocStyle } from '../types';
import { INVOICE_TYPES } from '../types';
import { fmtDate, money } from '../utils';

export const DOC_CSS = `
.doc{--accent:#1d4ed8;--accent-soft:#eef2fd;--accent-line:#c7d4f7;--accent-ink:#fff;--accent2:#0f766e;--accent2-soft:#f0fdfa;font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1c2330;background:#fff;max-width:820px;margin:0 auto;padding:0 40px 36px;font-size:12.5px;line-height:1.5;border-top:8px solid var(--accent);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc.f-serif{font-family:Georgia,'Times New Roman',serif}.doc.f-arrondie{font-family:'Trebuchet MS','Segoe UI',Verdana,sans-serif}
.doc h1{font-size:28px;line-height:1.1;margin:0;color:var(--accent);font-weight:800;letter-spacing:-.01em}
.doc h2{font-size:14px;margin:26px 0 8px;padding:7px 12px;background:var(--accent-soft);border-left:4px solid var(--accent);border-radius:0 6px 6px 0;color:#111}
.doc h3{font-size:10.5px;margin:14px 0 4px;color:var(--accent2);text-transform:uppercase;letter-spacing:.07em;font-weight:700}
.doc section>.muted:first-of-type{margin:-2px 0 6px 2px}
.doc .head{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding:26px 0 18px;border-bottom:1px solid var(--accent-line);margin-bottom:16px}
.doc .head img,.doc .logo-centre img{max-height:64px;max-width:200px;display:block;margin-bottom:8px}
.doc .d-co-name{font-size:15px;font-weight:700;color:#111}
.doc .head .d-title{text-align:right}.doc .head .d-no{margin-top:6px;font-size:13px;color:#4b5563;font-weight:600}
.doc .d-small{font-size:11px}
.doc .d-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:0 0 18px}
.doc .d-card{background:var(--accent-soft);border-radius:8px;padding:10px 12px}
.doc .d-card:has(>.d-lbl:only-child){display:none}
.doc .d-lbl{font-size:10px;text-transform:uppercase;letter-spacing:.08em;font-weight:700;color:var(--accent2);margin-bottom:3px}
.doc .logo-centre{text-align:center;margin-bottom:12px}
.doc .box{border:1px solid var(--accent-line);border-top:3px solid var(--accent);border-radius:8px;padding:10px 12px;min-width:220px}
.doc .muted{color:#6b7280}.doc .right{text-align:right}
.doc table{width:100%;border-collapse:separate;border-spacing:0;margin:4px 0 10px}
.doc th,.doc td{border-bottom:1px solid #e8ebf0;padding:6px 8px;text-align:left;vertical-align:top}
.doc th{background:var(--accent);color:var(--accent-ink);font-weight:600;font-size:11px;border-bottom:0}
.doc th:first-child{border-radius:6px 0 0 6px}.doc th:last-child{border-radius:0 6px 6px 0}
.doc tbody tr:nth-child(even) td{background:#f9fafb}
.doc tr.grp td{background:var(--accent-soft)!important;color:var(--accent);font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.doc td.n,.doc th.n{text-align:right;white-space:nowrap}
.doc .check{width:22px;height:14px;border:1.5px solid #9ca3af;border-radius:3px;display:inline-block}
.doc .subtotal{text-align:right;margin:2px 0 0}.doc .subtotal span{display:inline-block;background:var(--accent-soft);border-radius:6px;padding:4px 10px;font-weight:700}
.doc .totals{margin-left:auto;width:320px;margin-top:16px;background:var(--accent-soft);border-radius:10px;padding:6px}
.doc .totals td{border:none;padding:4px 10px;background:none!important}
.doc .totals tr.grand td{font-weight:800;font-size:15px;background:var(--accent)!important;color:var(--accent-ink)}
.doc .totals tr.grand td:first-child{border-radius:7px 0 0 7px}.doc .totals tr.grand td:last-child{border-radius:0 7px 7px 0}
.doc .foot{margin-top:30px;font-size:10.5px;color:#6b7280;border-top:1px solid var(--accent-line);padding-top:10px;white-space:pre-wrap;text-align:center}
.doc .text{white-space:pre-wrap;margin:14px 0}.doc .mention{font-size:11.5px;font-style:italic;text-align:right;color:#4b5563}
.doc .pay{display:flex;gap:16px;align-items:center;border:1px solid var(--accent-line);background:#fff;border-left:4px solid var(--accent);border-radius:8px;padding:12px 14px;margin-top:18px}.doc .pay svg{flex:none}
.doc .pay .comm{font-family:ui-monospace,Menlo,monospace;font-size:15px;font-weight:700;color:var(--accent)}.doc .pre{white-space:pre-line}
.doc tr.opt td{color:#6b7280;font-style:italic}
.doc .doc-options{border:1px dashed var(--accent-line);border-radius:8px;padding:6px 10px;margin:10px 0}
.doc .deposit{background:var(--accent-soft);border-radius:8px;padding:8px 12px}
.doc .sign{display:flex;gap:24px;margin-top:26px}.doc .sign div{flex:1;border:1.5px dashed var(--accent-line);height:86px;padding:8px 10px;border-radius:8px;color:#4b5563;font-size:11px}
.doc .terms{font-size:.95em;color:#4b5563}
.doc.t-sobre{border-top:0;padding-top:24px;color:#111}
.doc.t-sobre h1{color:#111;font-size:24px}.doc.t-sobre h2{background:none;border-left:0;border-bottom:2px solid var(--accent);border-radius:0;padding:0 0 3px}
.doc.t-sobre h3{color:#444}.doc.t-sobre .d-lbl{color:#444}
.doc.t-sobre .d-card,.doc.t-sobre .subtotal span,.doc.t-sobre .deposit{background:none;border:1px solid #ddd}
.doc.t-sobre th{background:#f4f4f4;color:#111}.doc.t-sobre tbody tr:nth-child(even) td{background:none}
.doc.t-sobre tr.grp td{background:#fafafa!important;color:#111}
.doc.t-sobre .totals{background:none}.doc.t-sobre .totals tr.grand td{background:none!important;color:#111;border-top:2px solid var(--accent)}
.doc [data-bloc]{border-radius:6px;transition:outline-color .15s}
.doc.marking [data-bloc]{cursor:pointer;outline:2px solid transparent;outline-offset:4px}
.doc.marking [data-bloc]:hover{outline-color:#cbd5e1}
@media print{.doc{padding:0 0 0;max-width:none}}
@media (max-width:600px){.doc{padding:0 16px 24px}.doc .d-cards{grid-template-columns:1fr}.doc .head{flex-direction:column}.doc .head .d-title{text-align:left}.doc .totals{width:100%}}
`;

/** Ancien format conservé pour compatibilité : {client}, {projet}… */
export function fillVars(text: string | undefined, doc: Doc): string {
  return text ? fillTemplate(text, doc) : '';
}

/** Rend un document : gabarit HTML (en-tête, mise en page, pied) + blocs générés. */
export function DocRender({ doc, mark, highlight, onPick }: { doc: Doc; mark?: boolean; highlight?: string; onPick?: (bloc: string) => void }) {
  const st = docStyle(doc);
  const html = useMemo(() => buildDocHtml(doc, { mark }), [doc, mark]);
  return (
    <>
      {highlight && <style>{`.doc [data-bloc="${highlight.replace(/[^\w]/g, '')}"]{outline:2px solid ${st.color}!important;outline-offset:4px}`}</style>}
      <div className={`doc f-${st.font} t-${st.theme || 'moderne'}${mark ? ' marking' : ''}`} style={accentVars(st.color, st.color2)}
        onClick={onPick ? (e) => { const b = (e.target as HTMLElement).closest('[data-bloc]'); if (b) onPick(b.getAttribute('data-bloc')!); } : undefined}
        dangerouslySetInnerHTML={{ __html: html }} />
    </>
  );
}

/** style du document ; l'ancien noir par défaut devient la couleur par défaut actuelle */
export function docStyle(doc: Doc): DocStyle {
  const st = { ...DEFAULT_DOC_STYLE, ...doc.snapshot.template?.style };
  if (/^#1{6}$/i.test(st.color)) st.color = DEFAULT_DOC_STYLE.color;
  if (!/^#([0-9a-f]{6})$/i.test(st.color2 || '')) st.color2 = DEFAULT_DOC_STYLE.color2;
  return st;
}

/** variables de couleur : teinte claire, filet et couleur du texte sur l'accent (calculés, pour le PDF aussi) */
export function accentVars(color: string, color2?: string): CSSProperties {
  const vars = (hex: string, prefix: 'accent' | 'accent2') => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    const [r, g, b] = m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : [29, 78, 216];
    const mix = (t: number) => `rgb(${[r, g, b].map((c) => Math.round(c + (255 - c) * t)).join(',')})`;
    const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    return { [`--${prefix}`]: `rgb(${r},${g},${b})`, [`--${prefix}-soft`]: mix(0.92), ...(prefix === 'accent' ? { '--accent-line': mix(0.75), '--accent-ink': lum > 0.62 ? '#111' : '#fff' } : {}) } as CSSProperties;
  };
  return { ...vars(color, 'accent'), ...(color2 ? vars(color2, 'accent2') : {}) } as CSSProperties;
}

export function buildDocHtml(doc: Doc, opts: { mark?: boolean } = {}): string {
  const s = doc.snapshot;
  const t = s.template;
  const st: DocStyle = { ...DEFAULT_DOC_STYLE, ...t?.style };
  const h = withDefaults(t?.html);
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
          <tbody>{s.extras.map((x, i) => <tr key={i}><td className="n">{x.qty}</td><td>{x.label}{x.supplier && <span className="muted"> — {x.supplier}</span>}</td><td className="n">{money(x.unitPrice)}</td><td className="n">{money(x.total)}</td></tr>)}</tbody>
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
          {!s.reminder && (s.vatBreakdown && s.vatBreakdown.length > 1
            ? s.vatBreakdown.map((b) => <tr key={b.rate}><td>{tr(doc, 'vat')} {b.rate} %</td><td className="n">{money(b.vat)}</td></tr>)
            : <tr><td>{tr(doc, 'vat')} {s.vatRate} %{s.vatRegime && s.vatRegime !== 'normal' ? ` (${VAT_SHORT[docLang(doc)][s.vatRegime]})` : ''}</td><td className="n">{money(s.vat)}</td></tr>)}
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
    'bloc.notes': s.notes?.length || s.venueNotes?.length || s.contacts?.length ? r(
      <section className="notes">
        {s.contacts?.length ? (
          <div className="doc-contacts">
            <h3>{tr(doc, 'contacts')}</h3>
            <table><tbody>{s.contacts.map((c, i) => (
              <tr key={i}><td style={{ width: '14%' }}><strong>{c.role}</strong></td><td>{c.name}{c.detail && <div className="muted">{c.detail}</div>}</td>
                <td>{c.phone && <a href={`tel:${c.phone.replace(/[^+\d]/g, '')}`}>{c.phone}</a>}</td><td>{c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}</td></tr>
            ))}</tbody></table>
          </div>
        ) : null}
        {s.venueNotes?.length ? (
          <div className="venue-notes">
            <h3>{tr(doc, 'venue')}{s.project.venue ? ` — ${s.project.venue}` : ''}</h3>
            <table><tbody>{s.venueNotes.map((n, i) => <tr key={i}><td style={{ width: '30%' }}><strong>{n.label}</strong></td><td style={{ whiteSpace: 'pre-wrap' }}>{n.text}</td></tr>)}</tbody></table>
          </div>
        ) : null}
        {(s.notes || []).map((n, i) => <div key={i}><h3>{n.title || tr(doc, 'notes')}</h3><p style={{ whiteSpace: 'pre-wrap', marginTop: 0 }}>{n.text}</p></div>)}
      </section>,
    ) : '',
    'bloc.caution': s.deposit?.amount ? r(
      <p className="deposit"><strong>{tr(doc, 'securityDeposit')} : {money(s.deposit.amount)}</strong>
        {s.deposit.status === 'payee' ? ` — ${tr(doc, 'depositPaid')}` : s.deposit.status === 'remboursee' ? ` — ${tr(doc, 'depositRefunded')}` : ''}</p>,
    ) : '',
    'bloc.conditions': s.terms ? r(
      <section className="terms"><h2>{tr(doc, 'terms')}</h2><div style={{ whiteSpace: 'pre-wrap', fontSize: '0.85em' }}>{s.terms}</div></section>,
    ) : '',
  };
  // sections choisies pour ce type de document (modèle figé) : les autres sont retirées
  const allowed = s.template?.blocks;
  if (allowed) for (const k of Object.keys(blocks)) if (!allowed.includes(k.slice(5)) && k !== 'bloc.entete' && k !== 'bloc.pied') blocks[k] = '';
  // gabarits personnalisés plus anciens : on place les nouveaux blocs à un endroit raisonnable
  if (!h.layout.includes('bloc.notes')) blocks['bloc.salles'] = blocks['bloc.notes'] + blocks['bloc.salles'];
  // le paiement (IBAN, communication, QR) doit toujours apparaître sur les factures, même sans {{bloc.paiement}} dans le gabarit
  if (!h.layout.includes('bloc.paiement')) blocks['bloc.totaux'] += blocks['bloc.paiement'];
  if (!h.layout.includes('bloc.caution')) blocks['bloc.totaux'] += blocks['bloc.caution'];
  // la mention de TVA suit les totaux, sauf si le gabarit la place lui-même
  if (!h.layout.includes('bloc.mention_tva')) blocks['bloc.totaux'] += blocks['bloc.mention_tva'];
  blocks['bloc.entete'] = fillTemplate(h.header, doc, blocks);
  blocks['bloc.pied'] = isRoadmap || !s.footer && h.footer === DEFAULT_HTML.footer ? '' : fillTemplate(h.footer, doc, blocks);
  const css = h.css.trim() ? `<style>${h.css.replace(/<\/style/gi, '')}</style>` : '';
  const tail = h.layout.includes('bloc.conditions') ? '' : blocks['bloc.conditions'];
  if (opts.mark) for (const k of Object.keys(blocks)) if (blocks[k]) blocks[k] = `<div data-bloc="${k.slice(5)}">${blocks[k]}</div>`;
  return stripScripts(css + fillTemplate(h.layout, doc, blocks) + tail);
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
            <div className="muted">{fmtDate(sp.start)} → {fmtDate(sp.end)}{sp.venue && ` · ${sp.venue}`}{sp.address && ` (${sp.address})`}</div>
            {st.showPeriods && sp.periods && sp.periods.length > 0 && (
              <>
                <h3>{tr(doc, 'schedule')}</h3>
                <table><tbody>{sp.periods.map((p, k) => <tr key={k}><td style={{ width: '40%' }}><strong>{p.name}</strong></td><td>{fmtDate(p.start)} → {fmtDate(p.end)}</td></tr>)}</tbody></table>
              </>
            )}
            {summaryOnly && sp.equipment.length > 0 && (
              <table><tbody><tr><td>{tr(doc, 'rental')} ({sp.equipment.filter((l) => !l.optional).length} {tr(doc, 'lines')})</td><td className="n">{money(eqTotal)}</td></tr></tbody></table>
            )}
            {(() => {
              // devis : les options dans une section à part, non comptées dans le total
              const splitOpts = !isPacking && !isRoadmap;
              const mainLines = splitOpts ? eqLines.filter((l) => !l.optional) : eqLines;
              const optLines = splitOpts ? eqLines.filter((l) => l.optional) : [];
              const table = (lines: typeof eqLines) => (
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
                    {lines.map((l, j) => (<Fragment key={j}>
                      {st.showGroups && l.group && l.group !== lines[j - 1]?.group && (
                        <tr className="grp"><td colSpan={(isPacking ? 4 : 2) + (showPrices ? priceCols : 0)}>{l.group}</td></tr>
                      )}
                      <tr className={l.optional ? 'opt' : ''}>
                        {isPacking && <td><span className="check" /></td>}
                        {isPacking && <td><span className="check" /></td>}
                        <td className="n">{l.qty}</td>
                        <td>{l.name}{st.showCode && l.code && <span className="muted"> ({l.code})</span>}{l.optional && !splitOpts && ` — ${tr(doc, 'option')}`}
                          {l.periods && <div className="muted" style={{ fontSize: '0.85em' }}>{l.periods}</div>}
                          {l.contents && <div className="muted" style={{ fontSize: '0.85em' }}>Avec : {l.contents}</div>}
                          {l.remark && <div className="muted" style={{ fontSize: '0.85em' }}>{l.remark}</div>}</td>
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
              );
              return <>
                {!summaryOnly && mainLines.length > 0 && <><h3>{tr(doc, 'equipment')}</h3>{table(mainLines)}</>}
                {optLines.length > 0 && (
                  <div className="doc-options">
                    <h3>{tr(doc, 'options')}</h3>
                    {(() => {
                      // options groupées : dans chaque groupe, le client choisit (acceptation en ligne)
                      const groups = new Map<string, typeof optLines>();
                      for (const l of optLines) { const g = l.optionGroup || ''; groups.set(g, [...(groups.get(g) || []), l]); }
                      return [...groups.entries()].map(([g, ls]) => (
                        <div key={g || '_'} style={{ marginBottom: 8 }}>
                          {g ? <div className="muted" style={{ fontWeight: 700 }}>{tr(doc, 'optionsGroup')} « {g} »</div> : null}
                          {table(ls)}
                          {showPrices && g ? <div className="right muted">{money(ls.reduce((a, l) => a + l.total, 0))} HT</div> : null}
                        </div>
                      ));
                    })()}
                    {showPrices && <div className="right muted">{tr(doc, 'optionsTotal')} : <strong>{money(optLines.reduce((a, l) => a + l.total, 0))}</strong> HT</div>}
                  </div>
                )}
              </>;
            })()}
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
            {showPrices && st.showSubtotals && <div className="subtotal"><span>{tr(doc, 'subtotal')} {sp.name} : {money(sp.subtotal)}</span></div>}
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
