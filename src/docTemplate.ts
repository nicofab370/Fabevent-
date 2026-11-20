/**
 * Gabarits HTML des documents : variables {{groupe.nom}} et blocs {{bloc.xxx}}.
 * Les variables sont échappées ; les blocs sont du HTML généré par l'application.
 */
import type { Doc, DocHtml } from './types';
import { DOC_LABELS, INVOICE_TYPES, VAT_REGIME_LABELS } from './types';
import { epcPayload, qrSvg } from './payment';
import { fmtDate, money } from './utils';

export const DEFAULT_HTML: DocHtml = {
  header: `<div class="head">
  <div>
    {{societe.logo}}
    <div><strong>{{societe.nom}}</strong></div>
    <div class="pre">{{societe.adresse}}</div>
    <div>{{societe.telephone}}</div>
    <div>{{societe.email}}</div>
    <div class="muted">{{societe.identifiants}}</div>
  </div>
  <div class="box">
    <h1>{{document.titre}}</h1>
    <div>N° <strong>{{document.numero}}</strong> {{document.version}}</div>
    <div>Date : {{document.date}}</div>
    {{document.infos}}
    <div style="margin-top:8px">{{client.bloc}}</div>
  </div>
</div>
<div>
  <strong>Projet {{projet.numero}} — {{projet.nom}}</strong>
  {{projet.reference_bloc}}
  <div class="muted">{{projet.debut}} → {{projet.fin}} · {{projet.lieu}}</div>
</div>`,
  layout: `{{bloc.entete}}
{{bloc.introduction}}
{{bloc.salles}}
{{bloc.frais}}
{{bloc.lignes_simples}}
{{bloc.options}}
{{bloc.totaux}}
{{bloc.conclusion}}
{{bloc.signature}}
{{bloc.paiement}}
{{bloc.pied}}`,
  footer: `<div class="foot">{{societe.pied}}</div>`,
  css: '',
};

/** Catalogue affiché dans l'éditeur (liste cliquable). */
export const VARIABLE_GROUPS: { label: string; items: [string, string][] }[] = [
  { label: 'Société', items: [
    ['societe.nom', 'Nom'], ['societe.logo', 'Logo (image)'], ['societe.adresse', 'Adresse'], ['societe.telephone', 'Téléphone'],
    ['societe.email', 'Email'], ['societe.tva', 'N° TVA'], ['societe.numero_entreprise', "N° d'entreprise"], ['societe.identifiants', 'N° entreprise + TVA'],
    ['societe.iban', 'IBAN'], ['societe.bic', 'BIC'], ['societe.pied', 'Pied de page (Paramètres)'],
  ] },
  { label: 'Client', items: [
    ['client.nom', 'Nom / société'], ['client.contact', 'Personne de contact'], ['client.adresse', 'Adresse'], ['client.cp', 'Code postal'],
    ['client.ville', 'Ville'], ['client.tva', 'N° TVA'], ['client.email', 'Email'], ['client.telephone', 'Téléphone'], ['client.bloc', 'Bloc adresse complet'],
  ] },
  { label: 'Document', items: [
    ['document.titre', 'Titre'], ['document.type', 'Type'], ['document.numero', 'Numéro'], ['document.version', 'Version (v2…)'], ['document.date', "Date d'émission"],
    ['document.validite', 'Valable jusqu\'au'], ['document.echeance', 'Échéance'], ['document.reference', 'Référence (devis / facture liée)'], ['document.infos', 'Lignes validité / échéance / réf.'],
  ] },
  { label: 'Projet', items: [
    ['projet.nom', 'Nom'], ['projet.numero', 'Numéro'], ['projet.lieu', 'Lieu'], ['projet.debut', 'Début'], ['projet.fin', 'Fin'],
    ['projet.reference_client', 'Référence du client'], ['projet.reference_bloc', 'Ligne « Votre référence »'], ['projet.notes', 'Notes'],
  ] },
  { label: 'Paiement & TVA', items: [
    ['paiement.communication', 'Communication (structurée)'], ['paiement.qr', 'QR code de virement'], ['tva.regime', 'Régime de TVA'], ['tva.mention', 'Mention légale de TVA'],
  ] },
  { label: 'Totaux', items: [
    ['total.ht', 'Total HT'], ['total.tva', 'TVA'], ['total.taux_tva', 'Taux de TVA'], ['total.ttc', 'Total TTC'], ['total.remise', 'Remise'], ['total.reste', 'Reste à payer'],
  ] },
  { label: 'Blocs générés', items: [
    ['bloc.entete', 'En-tête (gabarit ci-dessus)'], ['bloc.introduction', "Texte d'introduction"], ['bloc.salles', 'Salles : horaires, matériel, personnel, transport'],
    ['bloc.frais', 'Frais supplémentaires'], ['bloc.lignes_simples', 'Lignes acompte / avoir'], ['bloc.options', 'Total des options'], ['bloc.totaux', 'Tableau des totaux'],
    ['bloc.conclusion', 'Texte de fin'], ['bloc.signature', 'Cadre de signature'], ['bloc.paiement', 'Paiement : IBAN, communication, QR'],
    ['bloc.mention_tva', 'Mention de TVA (sinon sous les totaux)'], ['bloc.pied', 'Pied de page (gabarit)'],
  ] },
];

const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Valeurs des variables simples d'un document (non échappées). */
export function docValues(doc: Doc): Record<string, string> {
  const s = doc.snapshot;
  const c = s.client;
  const co = s.company;
  const isInvoice = INVOICE_TYPES.includes(doc.type);
  const deposits = (s.deposits || []).reduce((a, d) => a + d.ttc, 0);
  return {
    'societe.nom': co.name, 'societe.adresse': co.address || '', 'societe.telephone': co.phone || '', 'societe.email': co.email || '',
    'societe.tva': co.vatNumber || '', 'societe.numero_entreprise': co.siret || '', 'societe.iban': co.iban || '', 'societe.bic': co.bic || '',
    'societe.identifiants': [co.siret && `N° d'entreprise ${co.siret}`, co.vatNumber && `TVA ${co.vatNumber}`].filter(Boolean).join(' · '),
    'societe.pied': s.footer || '',
    'client.nom': c?.company || '', 'client.contact': doc.contactPerson || [c?.firstName, c?.lastName].filter(Boolean).join(' '),
    'client.adresse': c?.address || '', 'client.cp': c?.postalCode || '', 'client.ville': c?.city || '', 'client.tva': c?.vatNumber || '',
    'client.email': c?.email || '', 'client.telephone': c?.phone || '',
    'document.titre': s.template?.title?.trim() || DOC_LABELS[doc.type], 'document.type': DOC_LABELS[doc.type], 'document.numero': doc.number,
    'document.version': isInvoice ? '' : `— v${doc.version}`, 'document.date': fmtDate(s.issuedAt, false),
    'document.validite': s.validUntil ? fmtDate(s.validUntil, false) : '', 'document.echeance': s.dueDate && doc.type !== 'avoir' ? fmtDate(s.dueDate, false) : '',
    'document.reference': s.refNumber || '',
    'projet.nom': s.project.name, 'projet.numero': s.project.number, 'projet.lieu': s.project.venue || '', 'projet.debut': fmtDate(s.project.start),
    'projet.fin': fmtDate(s.project.end), 'projet.reference_client': s.project.externalRef || '', 'projet.notes': s.project.notes || '',
    'total.ht': money(s.totalHT), 'total.tva': money(s.vat), 'total.taux_tva': `${s.vatRate} %`, 'total.ttc': money(s.totalTTC),
    'total.remise': s.discountAmount ? money(s.discountAmount) : '', 'total.reste': money(s.totalTTC - deposits),
    'paiement.communication': s.payment?.communication || '', 'tva.regime': s.vatRegime ? VAT_REGIME_LABELS[s.vatRegime] : '', 'tva.mention': s.vatMention || '',
  };
}

/** Variables composées (HTML) utiles dans l'en-tête. */
function composite(doc: Doc, v: Record<string, string>): Record<string, string> {
  const s = doc.snapshot;
  const c = s.client;
  const isRoadmap = doc.type === 'feuille_route';
  const lines = (arr: (string | false | undefined)[]) => arr.filter(Boolean).map((x) => `<div>${x}</div>`).join('');
  return {
    'societe.logo': s.company.logo ? `<img src="${esc(s.company.logo)}" alt="">` : '',
    'client.bloc': c && !isRoadmap ? `<strong>${esc(c.company)}</strong>` + lines([
      (c.firstName || c.lastName) && esc([c.firstName, c.lastName].filter(Boolean).join(' ')), c.address && esc(c.address),
      (c.postalCode || c.city) && esc([c.postalCode, c.city].filter(Boolean).join(' ')), c.vatNumber && `<span class="muted">TVA ${esc(c.vatNumber)}</span>`,
      doc.contactPerson && `À l'attention de ${esc(doc.contactPerson)}`,
    ]) : '',
    'document.infos': lines([
      v['document.validite'] && `Valable jusqu'au : ${esc(v['document.validite'])}`, v['document.echeance'] && `Échéance : ${esc(v['document.echeance'])}`,
      s.refNumber && `Réf. : ${doc.type === 'avoir' ? 'facture' : 'devis'} ${esc(s.refNumber)}`,
    ]),
    'projet.reference_bloc': s.project.externalRef && !isRoadmap ? `<div>Votre référence : ${esc(s.project.externalRef)}</div>` : '',
    'paiement.qr': (() => {
      const amount = s.totalTTC - (s.deposits || []).reduce((a, d) => a + d.ttc, 0);
      if (!s.company.iban || amount <= 0 || !s.payment) return '';
      try { return qrSvg(epcPayload({ name: s.company.name, iban: s.company.iban, bic: s.company.bic, amount, communication: s.payment.communication })); } catch { return ''; }
    })(),
  };
}

/** Remplace les variables d'un texte : {{groupe.nom}} (et l'ancien format {client}). */
export function fillTemplate(tpl: string, doc: Doc, blocks: Record<string, string> = {}): string {
  const v = docValues(doc);
  const comp = composite(doc, v);
  const legacy: Record<string, string> = {
    client: v['client.nom'], contact: v['client.contact'], projet: v['projet.nom'], numero_projet: v['projet.numero'], numero: v['document.numero'],
    date: v['document.date'], lieu: v['projet.lieu'], debut: v['projet.debut'], fin: v['projet.fin'], total: v['total.ttc'],
    echeance: v['document.echeance'], validite: v['document.validite'], societe: v['societe.nom'],
  };
  return tpl
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (m, k: string) => (k in blocks ? blocks[k] : k in comp ? comp[k] : k in v ? esc(v[k]) : m))
    .replace(/\{(\w+)\}/g, (m, k: string) => (k in legacy ? esc(legacy[k]) : m));
}

/** Retire les scripts et gestionnaires d'événements d'un gabarit. */
export function stripScripts(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}
