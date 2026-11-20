/**
 * Textes des documents en français, néerlandais et anglais (langue du client ou du projet).
 */
import type { Doc, DocType, Lang, VatRegime } from './types';

const fr = {
  no: 'N°', date: 'Date', project: 'Projet', validUntil: "Valable jusqu'au", due: 'Échéance', ref: 'Réf.', refInvoice: 'facture', refQuote: 'devis',
  vat: 'TVA', attention: "À l'attention de", yourRef: 'Votre référence', companyNo: "N° d'entreprise",
  schedule: 'Horaires', equipment: 'Matériel', rental: 'Location de matériel', lines: 'lignes', out: 'Sortie', back: 'Retour', qty: 'Qté',
  item: 'Désignation', unitPrice: 'P.U.', factor: 'Coef.', discount: 'Remise', totalExcl: 'Total HT', option: 'en option', sale: 'vente', days: 'j',
  crew: 'Personnel', function: 'Fonction', name: 'Nom', phone: 'Tél.', hours: 'Horaires', quantity: 'Quantité', rate: 'Tarif', overtime: 'h sup.', of: 'dont',
  departure: 'départ', return: 'retour', transport: 'Transport', vehicle: 'Véhicule', driver: 'Chauffeur', period: 'Période', subtotal: 'Sous-total',
  extras: 'Frais supplémentaires', amountExcl: 'Montant HT', options: 'Options proposées (non incluses dans le total)', totalIncl: 'Total TTC',
  remaining: 'Montant restant dû', deposit: 'Acompte', toPay: 'Reste à payer', approval: 'Bon pour accord (date, signature, cachet)',
  preparedBy: 'Préparé par', checkedBy: 'Vérifié / retour par', pay: 'Merci de verser', onAccount: 'sur le compte', withComm: 'avec la communication',
  structured: 'structurée', scan: 'Scannez le QR code avec votre application bancaire.', partial: 'Facture partielle — salles facturées',
  alreadyInvoiced: 'Déjà facturé séparément :', toConfirm: 'à confirmer',
};
type Dict = typeof fr;

const nl: Dict = {
  no: 'Nr.', date: 'Datum', project: 'Project', validUntil: 'Geldig tot', due: 'Vervaldatum', ref: 'Ref.', refInvoice: 'factuur', refQuote: 'offerte',
  vat: 'Btw', attention: 'Ter attentie van', yourRef: 'Uw referentie', companyNo: 'Ondernemingsnr.',
  schedule: 'Planning', equipment: 'Materiaal', rental: 'Verhuur van materiaal', lines: 'lijnen', out: 'Uit', back: 'Terug', qty: 'Aant.',
  item: 'Omschrijving', unitPrice: 'E.P.', factor: 'Coëf.', discount: 'Korting', totalExcl: 'Totaal excl. btw', option: 'optioneel', sale: 'verkoop', days: 'd',
  crew: 'Personeel', function: 'Functie', name: 'Naam', phone: 'Tel.', hours: 'Uren', quantity: 'Hoeveelheid', rate: 'Tarief', overtime: 'u overuren', of: 'waarvan',
  departure: 'vertrek', return: 'terug', transport: 'Transport', vehicle: 'Voertuig', driver: 'Chauffeur', period: 'Periode', subtotal: 'Subtotaal',
  extras: 'Bijkomende kosten', amountExcl: 'Bedrag excl. btw', options: 'Voorgestelde opties (niet inbegrepen in het totaal)', totalIncl: 'Totaal incl. btw',
  remaining: 'Openstaand bedrag', deposit: 'Voorschot', toPay: 'Te betalen saldo', approval: 'Voor akkoord (datum, handtekening, stempel)',
  preparedBy: 'Voorbereid door', checkedBy: 'Gecontroleerd / retour door', pay: 'Gelieve', onAccount: 'over te schrijven op rekening', withComm: 'met de',
  structured: 'gestructureerde mededeling', scan: 'Scan de QR-code met uw bankapp.', partial: 'Gedeeltelijke factuur — gefactureerde zalen',
  alreadyInvoiced: 'Reeds apart gefactureerd:', toConfirm: 'te bevestigen',
};

const en: Dict = {
  no: 'No.', date: 'Date', project: 'Project', validUntil: 'Valid until', due: 'Due date', ref: 'Ref.', refInvoice: 'invoice', refQuote: 'quote',
  vat: 'VAT', attention: 'For the attention of', yourRef: 'Your reference', companyNo: 'Company no.',
  schedule: 'Schedule', equipment: 'Equipment', rental: 'Equipment rental', lines: 'lines', out: 'Out', back: 'Back', qty: 'Qty',
  item: 'Description', unitPrice: 'Unit price', factor: 'Factor', discount: 'Discount', totalExcl: 'Total excl. VAT', option: 'optional', sale: 'sale', days: 'd',
  crew: 'Crew', function: 'Role', name: 'Name', phone: 'Phone', hours: 'Hours', quantity: 'Quantity', rate: 'Rate', overtime: 'h overtime', of: 'incl.',
  departure: 'departure', return: 'return', transport: 'Transport', vehicle: 'Vehicle', driver: 'Driver', period: 'Period', subtotal: 'Subtotal',
  extras: 'Additional costs', amountExcl: 'Amount excl. VAT', options: 'Proposed options (not included in the total)', totalIncl: 'Total incl. VAT',
  remaining: 'Amount outstanding', deposit: 'Deposit', toPay: 'Balance due', approval: 'Approved (date, signature, stamp)',
  preparedBy: 'Prepared by', checkedBy: 'Checked / returned by', pay: 'Please transfer', onAccount: 'to account', withComm: 'with the',
  structured: 'structured reference', scan: 'Scan the QR code with your banking app.', partial: 'Partial invoice — rooms invoiced',
  alreadyInvoiced: 'Already invoiced separately:', toConfirm: 'to be confirmed',
};

export const DICT: Record<Lang, Dict> = { fr, nl, en };
export type TKey = keyof Dict;

export function docLang(doc: Doc): Lang {
  return doc.snapshot.lang || 'fr';
}
export function tr(doc: Doc, key: TKey): string {
  return DICT[docLang(doc)][key] ?? fr[key];
}

export const DOC_TITLES: Record<Lang, Record<DocType, string>> = {
  fr: { devis: 'Devis', facture: 'Facture', acompte: "Facture d'acompte", avoir: 'Avoir', rappel: 'Rappel de paiement', bon_sortie: 'Bon de sortie', feuille_route: 'Feuille de route' },
  nl: { devis: 'Offerte', facture: 'Factuur', acompte: 'Voorschotfactuur', avoir: 'Creditnota', rappel: 'Betalingsherinnering', bon_sortie: 'Uitgiftebon', feuille_route: 'Draaiboek' },
  en: { devis: 'Quote', facture: 'Invoice', acompte: 'Deposit invoice', avoir: 'Credit note', rappel: 'Payment reminder', bon_sortie: 'Delivery note', feuille_route: 'Call sheet' },
};

export const VAT_SHORT: Record<Lang, Record<VatRegime, string>> = {
  fr: { normal: '', autoliquidation: 'autoliquidation', exonere: 'exonéré', hors_ue: 'hors UE' },
  nl: { normal: '', autoliquidation: 'verlegd', exonere: 'vrijgesteld', hors_ue: 'buiten EU' },
  en: { normal: '', autoliquidation: 'reverse charge', exonere: 'exempt', hors_ue: 'outside EU' },
};

export const VAT_MENTIONS_I18N: Record<Exclude<Lang, 'fr'>, Record<Exclude<VatRegime, 'normal'>, string>> = {
  nl: {
    autoliquidation: 'Btw verlegd — btw verschuldigd door de afnemer (artikel 196 van richtlijn 2006/112/EG).',
    exonere: 'Vrijgesteld van btw (artikel 44 van het Btw-wetboek).',
    hors_ue: 'Dienst buiten het toepassingsgebied van de Belgische btw — afnemer gevestigd buiten de Europese Unie (artikel 21, § 2 Btw-wetboek).',
  },
  en: {
    autoliquidation: 'Reverse charge — VAT to be accounted for by the recipient (article 196 of Directive 2006/112/EC).',
    exonere: 'Exempt from VAT (article 44 of the Belgian VAT Code).',
    hors_ue: 'Outside the scope of Belgian VAT — customer established outside the European Union (article 21, § 2 Belgian VAT Code).',
  },
};

export const REMINDER_TEXTS: Record<Lang, Record<1 | 2 | 3, string>> = {
  fr: {
    1: 'Sauf erreur de notre part, la facture {{document.reference}} reste impayée à ce jour. Nous vous remercions de bien vouloir régler {{total.ttc}} avant le {{document.echeance}}.\nSi le paiement a été effectué entre-temps, merci de ne pas tenir compte de ce rappel.',
    2: "Malgré notre précédent rappel, la facture {{document.reference}} n'est toujours pas réglée. Nous vous prions de verser {{total.ttc}} au plus tard le {{document.echeance}}.",
    3: "Mise en demeure : la facture {{document.reference}} demeure impayée malgré nos rappels. À défaut de paiement de {{total.ttc}} avant le {{document.echeance}}, nous serons contraints d'entamer une procédure de recouvrement.",
  },
  nl: {
    1: 'Behoudens vergissing onzerzijds is factuur {{document.reference}} nog niet betaald. Gelieve {{total.ttc}} te betalen vóór {{document.echeance}}.\nIndien de betaling intussen werd uitgevoerd, mag u deze herinnering als onbestaande beschouwen.',
    2: 'Ondanks onze vorige herinnering is factuur {{document.reference}} nog steeds niet betaald. Gelieve {{total.ttc}} uiterlijk op {{document.echeance}} te betalen.',
    3: 'Ingebrekestelling: factuur {{document.reference}} blijft onbetaald ondanks onze herinneringen. Zonder betaling van {{total.ttc}} vóór {{document.echeance}} zien wij ons genoodzaakt een invorderingsprocedure op te starten.',
  },
  en: {
    1: 'According to our records, invoice {{document.reference}} remains unpaid. Please pay {{total.ttc}} before {{document.echeance}}.\nIf payment has already been made, please disregard this reminder.',
    2: 'Despite our previous reminder, invoice {{document.reference}} is still unpaid. Please pay {{total.ttc}} no later than {{document.echeance}}.',
    3: 'Formal notice: invoice {{document.reference}} remains unpaid despite our reminders. Failing payment of {{total.ttc}} before {{document.echeance}}, we will have to start recovery proceedings.',
  },
};
