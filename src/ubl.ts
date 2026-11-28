/**
 * Export Peppol BIS Billing 3.0 (UBL 2.1) d'une facture, facture d'acompte ou avoir.
 * Le fichier XML produit est à déposer chez ton point d'accès Peppol.
 */
import type { CompanyInfo, Contact, Doc } from './types';
import { escHtml as esc, orderedSubprojects, round2 } from './utils';

const amt = (n: number) => round2(n).toFixed(2);
const day = (iso?: string) => (iso || new Date().toISOString()).slice(0, 10);

const COUNTRIES: Record<string, string> = { belgique: 'BE', belgium: 'BE', france: 'FR', luxembourg: 'LU', 'pays-bas': 'NL', netherlands: 'NL', allemagne: 'DE', suisse: 'CH' };
function countryCode(v?: string, fallback = 'BE'): string {
  if (!v) return fallback;
  const t = v.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return COUNTRIES[t.toLowerCase()] || fallback;
}

function endpoint(peppolId?: string): { scheme: string; id: string } | null {
  if (!peppolId) return null;
  const m = peppolId.trim().match(/^(\d{4}):(.+)$/);
  return m ? { scheme: m[1], id: m[2].replace(/\s/g, '') } : null;
}

export function peppolProblems(doc: Doc): string[] {
  const s = doc.snapshot;
  const out: string[] = [];
  if (!endpoint(s.company.peppolId)) out.push("Ton identifiant Peppol (Paramètres → Ma société), ex. 0208:0123456789");
  if (!s.company.vatNumber) out.push('Ton numéro de TVA (Paramètres)');
  if (!s.client) out.push('Un client sur le projet');
  else if (!endpoint(s.client.peppolId)) out.push(`L'identifiant Peppol du client « ${s.client.company} » (fiche contact)`);
  if (s.vatRegime === 'autoliquidation' && !s.client?.vatNumber) out.push('Le numéro de TVA du client (obligatoire en autoliquidation)');
  return out;
}

function party(p: { name: string; peppolId?: string; vatNumber?: string; street?: string; city?: string; postalCode?: string; country: string }) {
  const ep = endpoint(p.peppolId);
  return `<cac:Party>
      ${ep ? `<cbc:EndpointID schemeID="${esc(ep.scheme)}">${esc(ep.id)}</cbc:EndpointID>` : ''}
      <cac:PostalAddress>
        ${p.street ? `<cbc:StreetName>${esc(p.street)}</cbc:StreetName>` : ''}
        ${p.city ? `<cbc:CityName>${esc(p.city)}</cbc:CityName>` : ''}
        ${p.postalCode ? `<cbc:PostalZone>${esc(p.postalCode)}</cbc:PostalZone>` : ''}
        <cac:Country><cbc:IdentificationCode>${p.country}</cbc:IdentificationCode></cac:Country>
      </cac:PostalAddress>
      ${p.vatNumber ? `<cac:PartyTaxScheme><cbc:CompanyID>${esc(p.vatNumber.replace(/[\s.]/g, ''))}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>` : ''}
      <cac:PartyLegalEntity><cbc:RegistrationName>${esc(p.name)}</cbc:RegistrationName></cac:PartyLegalEntity>
    </cac:Party>`;
}

function supplier(c: CompanyInfo) {
  return party({ name: c.name, peppolId: c.peppolId, vatNumber: c.vatNumber, street: c.street, city: c.city, postalCode: c.postalCode, country: countryCode(c.country) });
}
function customer(c: Contact | undefined, supplierCountry: string) {
  // adresse de facturation du client si elle est différente de l'adresse principale
  const a = c?.billingAddress?.address ? c.billingAddress : c;
  return party({
    name: c?.company || 'Client', peppolId: c?.peppolId, vatNumber: c?.vatNumber, street: a?.address, city: a?.city,
    postalCode: a?.postalCode, country: countryCode(a?.country || c?.country, supplierCountry),
  });
}

interface Line { name: string; qty: number; total: number; /** taux de TVA de la ligne quand il diffère du taux du document */ rate?: number }

/** Lignes facturables avec montants nets (positifs pour un avoir). */
function collectLines(doc: Doc, sign: number): Line[] {
  const s = doc.snapshot;
  if (s.simpleLines?.length) return s.simpleLines.map((l) => ({ name: l.label, qty: 1, total: sign * l.ht }));
  const out: Line[] = [];
  for (const sp of orderedSubprojects(doc)) {
    for (const l of sp.equipment) if (!l.optional && !l.kid) out.push({ name: `${l.name}${l.unit === 'pièce' ? '' : ` (${l.days} j)`} — ${sp.name}`, qty: l.qty, total: l.total, rate: l.vatRate });
    for (const c of sp.crew) if (c.billable) out.push({ name: `${c.function} (${c.days} j) — ${sp.name}`, qty: c.days, total: c.total });
    for (const v of sp.vehicles) if (v.billable) out.push({ name: `Transport ${v.name} — ${sp.name}`, qty: 1, total: v.price });
  }
  for (const x of s.extras || []) out.push({ name: x.label, qty: x.qty, total: x.total });
  return out.filter((l) => l.total !== 0 || l.qty !== 0);
}

export function buildUbl(doc: Doc): string {
  const s = doc.snapshot;
  const isCredit = doc.type === 'avoir';
  const sign = isCredit ? -1 : 1;
  const root = isCredit ? 'CreditNote' : 'Invoice';
  const lineTag = isCredit ? 'CreditNoteLine' : 'InvoiceLine';
  const qtyTag = isCredit ? 'CreditedQuantity' : 'InvoicedQuantity';
  // catégorie de TVA EN 16931 : S normal, AE autoliquidation, E exonéré, G export hors UE, Z taux zéro
  const regime = s.vatRegime || 'normal';
  const cat = regime === 'autoliquidation' ? 'AE' : regime === 'exonere' ? 'E' : regime === 'hors_ue' ? 'G' : s.vatRate > 0 ? 'S' : 'Z';
  const exCode = cat === 'AE' ? 'VATEX-EU-AE' : cat === 'G' ? 'VATEX-EU-G' : '';
  const exemption = ['AE', 'E', 'G'].includes(cat)
    ? `${exCode ? `<cbc:TaxExemptionReasonCode>${exCode}</cbc:TaxExemptionReasonCode>` : ''}<cbc:TaxExemptionReason>${esc(s.vatMention || 'Exonération de TVA')}</cbc:TaxExemptionReason>` : '';
  const taxCatFor = (rate: number) => `<cac:TaxCategory><cbc:ID>${cat}</cbc:ID><cbc:Percent>${rate}</cbc:Percent>${exemption}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:TaxCategory>`;
  const taxCat = taxCatFor(s.vatRate);
  const lines = collectLines(doc, sign);
  const lineSum = round2(lines.reduce((a, l) => a + l.total, 0));
  const allowance = round2(sign * s.discountAmount);
  const totalHT = round2(sign * s.totalHT);
  const vat = round2(sign * s.vat);
  const ttc = round2(sign * s.totalTTC);
  const prepaid = round2((s.deposits || []).reduce((a, d) => a + d.ttc, 0));
  const typeCode = isCredit ? '381' : doc.type === 'acompte' ? '386' : '380';

  const xmlLines = lines.map((l, i) => {
    // quantité réelle si le prix unitaire tombe juste, sinon 1 × montant (validation EN 16931)
    const unit = l.qty ? round2(l.total / l.qty) : 0;
    const exact = l.qty > 0 && round2(unit * l.qty) === round2(l.total);
    const qty = exact ? l.qty : 1;
    const price = exact ? unit : l.total;
    return `  <cac:${lineTag}>
    <cbc:ID>${i + 1}</cbc:ID>
    <cbc:${qtyTag} unitCode="C62">${qty}</cbc:${qtyTag}>
    <cbc:LineExtensionAmount currencyID="EUR">${amt(l.total)}</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>${esc((exact ? '' : `${l.qty} × `) + l.name).slice(0, 200)}</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>${cat}</cbc:ID><cbc:Percent>${l.rate ?? s.vatRate}</cbc:Percent><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="EUR">${amt(Math.abs(price))}</cbc:PriceAmount></cac:Price>
  </cac:${lineTag}>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${esc(doc.number)}</cbc:ID>
  <cbc:IssueDate>${day(s.issuedAt)}</cbc:IssueDate>
  ${!isCredit && s.dueDate ? `<cbc:DueDate>${day(s.dueDate)}</cbc:DueDate>` : ''}
  <cbc:${isCredit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>${typeCode}</cbc:${isCredit ? 'CreditNoteTypeCode' : 'InvoiceTypeCode'}>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>${esc(s.project.number)}</cbc:BuyerReference>
  ${s.refNumber && isCredit ? `<cac:BillingReference><cac:InvoiceDocumentReference><cbc:ID>${esc(s.refNumber)}</cbc:ID></cac:InvoiceDocumentReference></cac:BillingReference>` : ''}
  <cac:AccountingSupplierParty>
    ${supplier(s.company)}
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    ${customer(s.client, countryCode(s.company.country))}
  </cac:AccountingCustomerParty>
  ${!isCredit && s.company.iban ? `<cac:PaymentMeans>
    <cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cbc:PaymentID>${esc(s.payment?.structured ? s.payment.communication.replace(/\D/g, '') : s.payment?.communication || doc.number)}</cbc:PaymentID>
    <cac:PayeeFinancialAccount><cbc:ID>${esc(s.company.iban.replace(/\s/g, ''))}</cbc:ID></cac:PayeeFinancialAccount>
  </cac:PaymentMeans>` : ''}
  ${allowance ? `<cac:AllowanceCharge>
    <cbc:ChargeIndicator>false</cbc:ChargeIndicator>
    <cbc:AllowanceChargeReason>Remise</cbc:AllowanceChargeReason>
    <cbc:Amount currencyID="EUR">${amt(allowance)}</cbc:Amount>
    ${taxCat}
  </cac:AllowanceCharge>` : ''}
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">${amt(vat)}</cbc:TaxAmount>
    ${(s.vatBreakdown && s.vatBreakdown.length > 1
      ? s.vatBreakdown.map((b) => `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${amt(sign * b.ht)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${amt(sign * b.vat)}</cbc:TaxAmount>
      ${taxCatFor(b.rate)}
    </cac:TaxSubtotal>`).join('\n')
      : `    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">${amt(totalHT)}</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">${amt(vat)}</cbc:TaxAmount>
      ${taxCat}
    </cac:TaxSubtotal>`)}
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">${amt(lineSum)}</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">${amt(totalHT)}</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">${amt(ttc)}</cbc:TaxInclusiveAmount>
    ${allowance ? `<cbc:AllowanceTotalAmount currencyID="EUR">${amt(allowance)}</cbc:AllowanceTotalAmount>` : ''}
    ${prepaid ? `<cbc:PrepaidAmount currencyID="EUR">${amt(prepaid)}</cbc:PrepaidAmount>` : ''}
    <cbc:PayableAmount currencyID="EUR">${amt(ttc - prepaid)}</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
${xmlLines}
</${root}>
`.replace(/\n\s*\n/g, '\n');
}
