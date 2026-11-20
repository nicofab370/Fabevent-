export type ID = string;

export interface Base {
  id: ID;
  createdAt: string;
  updatedAt: string;
}

/** Régime de TVA d'un client ou d'un projet. */
export type VatRegime = 'normal' | 'autoliquidation' | 'exonere' | 'hors_ue';
export const VAT_REGIME_LABELS: Record<VatRegime, string> = {
  normal: 'TVA normale',
  autoliquidation: 'Autoliquidation (client assujetti UE)',
  exonere: 'Exonéré de TVA',
  hors_ue: 'Hors UE (export de services)',
};

export type Lang = 'fr' | 'nl' | 'en';
export const LANG_LABELS: Record<Lang, string> = { fr: 'Français', nl: 'Nederlands', en: 'English' };

/** Champ personnalisé (Paramètres) ajouté aux projets, contacts ou articles. */
export interface CustomField {
  id: ID;
  label: string;
  entity: 'projet' | 'contact' | 'materiel';
  type: 'texte' | 'oui_non' | 'nombre' | 'date';
}
export type CustomValues = Record<ID, string | number | boolean | undefined>;

/** Rendez-vous hors projet (repérage, réunion…). */
export interface Appointment extends Base {
  title: string;
  start: string;
  end: string;
  location?: string;
  personIds?: ID[];
  notes?: string;
}

export type ContactType = 'client' | 'fournisseur' | 'soustraitant' | 'lieu' | 'autre';
export const CONTACT_TYPES: Record<ContactType, string> = {
  client: 'Client',
  fournisseur: 'Fournisseur',
  soustraitant: 'Sous-traitant',
  lieu: 'Lieu',
  autre: 'Autre',
};

export interface Contact extends Base {
  type: ContactType;
  company: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  country?: string;
  vatNumber?: string;
  siret?: string;
  peppolId?: string;
  persons?: ContactPerson[];
  /** régime de TVA appliqué par défaut à ses projets */
  vatRegime?: VatRegime;
  /** remises par défaut (%) : sur le matériel (par ligne) et sur le total du projet */
  discounts?: { equipment?: number; total?: number };
  /** langue des documents envoyés à ce client */
  language?: Lang;
  tags?: string[];
  custom?: CustomValues;
  notes?: string;
}

export interface ContactPerson {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
}

export interface Category extends Base {
  name: string;
}

export interface KitItem {
  equipmentId: ID;
  qty: number;
}

export interface Accessory extends KitItem {
  /** true = ajouté gratuitement, false = facturé à son prix */
  free: boolean;
}

/** location = facturé par jour et revient ; vente = consommable vendu à l'unité */
export type EquipmentKind = 'location' | 'vente';

/** Dépôt / emplacement de stock. Le premier de la liste est le dépôt principal. */
export interface Depot {
  id: ID;
  name: string;
  street?: string;
  postalCode?: string;
  city?: string;
  country?: string;
}

export type TransferStatus = 'planifie' | 'effectue' | 'annule';
export const TRANSFER_LABELS: Record<TransferStatus, string> = { planifie: 'Planifié', effectue: 'Effectué', annule: 'Annulé' };

/** Déplacement de matériel entre dépôts : définitif (sans date de retour) ou temporaire. */
export interface Transfer extends Base {
  number: string;
  fromDepotId: ID;
  toDepotId: ID;
  start: string;
  /** retour au dépôt d'origine ; vide = transfert définitif */
  end?: string;
  status: TransferStatus;
  lines: { equipmentId: ID; qty: number }[];
  projectId?: ID;
  notes?: string;
}

export interface Equipment extends Base {
  name: string;
  /** quantités dans les dépôts secondaires (matériel en vrac) ; le dépôt principal a le reste */
  stock?: Record<ID, number>;
  /** calculé, jamais enregistré : quantité par dépôt */
  _stock?: Record<ID, number>;
  /** articles de remplacement proposés en cas de manque */
  alternatives?: ID[];
  /** archivé : masqué des listes et des choix, l'historique est conservé */
  archived?: boolean;
  /** photo (image réduite) */
  photo?: string;
  tags?: string[];
  custom?: CustomValues;
  kind?: EquipmentKind;
  trackSerials?: boolean;
  accessories?: Accessory[];
  /** coût d'achat unitaire (consommables) */
  costPrice?: number;
  inspectionMonths?: number;
  code?: string;
  categoryId?: ID;
  quantity: number;
  dailyPrice: number;
  replacementValue?: number;
  weight?: number;
  isKit: boolean;
  kitItems: KitItem[];
  barcode?: string;
  location?: string;
  notes?: string;
}

export type ProjectStatus = 'demande' | 'option' | 'confirme' | 'en_cours' | 'termine' | 'annule';
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  demande: 'Demande',
  option: 'Option',
  confirme: 'Confirmé',
  en_cours: 'En cours',
  termine: 'Terminé',
  annule: 'Annulé',
};
/** Statuts qui bloquent réellement le matériel / les personnes. */
export const RESERVING: ProjectStatus[] = ['option', 'confirme', 'en_cours'];

export interface Project extends Base {
  number: string;
  name: string;
  clientId?: ID;
  venue?: string;
  status: ProjectStatus;
  start: string;
  end: string;
  discount: number;
  /** interlocuteur chez le client */
  contactPerson?: string;
  /** type de projet (paramétrable) */
  typeName?: string;
  color?: string;
  /** référence externe, ex. n° de bon de commande du client */
  externalRef?: string;
  /** lieu de prestation (contact de type « lieu ») */
  venueId?: ID;
  vatRegime?: VatRegime;
  /** modèle de projet (n'apparaît pas dans les listes) */
  isTemplate?: boolean;
  /** langue des documents (sinon celle du client) */
  language?: Lang;
  tags?: string[];
  custom?: CustomValues;
  /** dépôt d'où part le matériel */
  depotId?: ID;
  /** distance aller dépôt → lieu (km) et temps de trajet (min) */
  distanceKm?: number;
  travelMinutes?: number;
  tasks?: Task[];
  notes?: string;
}

export interface Task {
  id: ID;
  text: string;
  done: boolean;
  due?: string;
}

/** Groupe d'équipement (par type, emplacement ou jour) rattaché à des créneaux de la salle. */
export interface EquipGroup {
  id: ID;
  name: string;
  /** créneaux couverts ; vide = toute la salle */
  periodIds: ID[];
}

export interface ProjectFile {
  id: ID;
  /** vide pour un document du personnel */
  projectId: ID;
  personId?: ID;
  /** date d'expiration (permis, habilitation…) */
  expires?: string;
  name: string;
  type: string;
  size: number;
  blob: Blob;
  createdAt: string;
}

export interface LogEntry {
  id: ID;
  projectId: ID;
  entityId: ID;
  at: string;
  text: string;
  fields?: string[];
}

export type PeriodKind = 'montage' | 'prestation' | 'demontage' | 'autre';
export const PERIOD_LABELS: Record<PeriodKind, string> = {
  montage: 'Montage', prestation: 'Prestation', demontage: 'Démontage', autre: 'Autre',
};

/** Créneau horaire d'un sous-projet (montage, jour de prestation, démontage…). */
export interface Period {
  id: ID;
  name: string;
  kind: PeriodKind;
  start: string;
  end: string;
}

/** Sous-projet = une salle / zone du projet, avec son matériel et ses horaires. */
export interface Subproject extends Base {
  projectId: ID;
  name: string;
  venue?: string;
  status: ProjectStatus;
  start: string;
  end: string;
  /** début de préparation (le matériel est bloqué dès cette date) */
  prepStart?: string;
  /** fin du retour / contrôle au dépôt */
  returnEnd?: string;
  /** horaires détaillés ; s'ils existent, start/end/prepStart/returnEnd en sont déduits */
  periods?: Period[];
  groups?: EquipGroup[];
  order: number;
  notes?: string;
}

export interface EquipmentLine extends Base {
  projectId: ID;
  subprojectId: ID;
  equipmentId?: ID;
  name: string;
  qty: number;
  unitPrice: number;
  discount: number;
  factor?: number;
  group?: string;
  /** groupe d'équipement de la salle */
  groupId?: ID;
  order: number;
  /** ligne facultative : affichée sur le devis mais hors total */
  optional?: boolean;
  /** accessoire ajouté automatiquement avec une autre ligne */
  parentLineId?: ID;
  /** consommable déjà déduit du stock */
  consumed?: boolean;
  /** entrepôt */
  outQty?: number;
  inQty?: number;
  outSerials?: string[];
  inSerials?: string[];
}

/** Fonction facturée au client (le coût, lui, dépend de la personne affectée). */
export interface CrewFunction {
  name: string;
  dayRate: number;
  hourRate?: number;
}

export interface Person extends Base {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  dailyRate: number;
  /** ce que la personne te coûte par jour */
  costRate?: number;
  /** tarifs horaires (facturé / coût) */
  hourlyRate?: number;
  hourlyCost?: number;
  external: boolean;
  /** société de sous-traitance (contact) qui facture ses prestations */
  contactId?: ID;
  notes?: string;
}

export interface CrewAssignment extends Base {
  projectId: ID;
  subprojectId: ID;
  personId?: ID;
  /** créneau du sous-projet auquel le poste est rattaché */
  periodId?: ID;
  /** tarif à la journée (défaut) ou à l'heure, avec heures supplémentaires */
  rateUnit?: 'jour' | 'heure';
  /** temps de trajet du projet ajouté avant et après les horaires communiqués */
  travel?: boolean;
  /** planification finale (visible du technicien) ; sinon provisoire */
  final?: boolean;
  function: string;
  start: string;
  end: string;
  rate: number;
  /** coût saisi à la main pour ce poste ; sinon celui de la personne affectée */
  cost?: number;
  billable: boolean;
  notes?: string;
}

export interface Unavailability extends Base {
  personId: ID;
  start: string;
  end: string;
  reason?: string;
}

export interface SerialUnit extends Base {
  equipmentId: ID;
  serial: string;
  barcode?: string;
  /** hs / perdu = sorti définitivement du stock */
  status: 'ok' | 'hs' | 'perdu';
  depotId?: ID;
  lastInspection?: string;
  notes?: string;
}

export interface Repair extends Base {
  equipmentId: ID;
  unitId?: ID;
  qty: number;
  start: string;
  /** vide = toujours en réparation */
  end?: string;
  status: 'ouvert' | 'termine';
  description: string;
  cost: number;
  supplierId?: ID;
  projectId?: ID;
}

export interface Inspection extends Base {
  equipmentId: ID;
  unitId?: ID;
  date: string;
  result: 'ok' | 'ko';
  by?: string;
  notes?: string;
}

export type SubrentStatus = 'demande' | 'confirme' | 'recu' | 'retourne' | 'annule';
export const SUBRENT_LABELS: Record<SubrentStatus, string> = {
  demande: 'Demandée', confirme: 'Confirmée', recu: 'Reçue', retourne: 'Retournée', annule: 'Annulée',
};

export interface Subrental extends Base {
  number: string;
  projectId: ID;
  subprojectId?: ID;
  supplierId?: ID;
  status: SubrentStatus;
  start: string;
  end: string;
  lines: { equipmentId?: ID; name: string; qty: number; cost: number }[];
  notes?: string;
}

/** Coût supplémentaire : frais interne et/ou refacturé au client (déplacement, hébergement…). */
export interface ProjectCost extends Base {
  projectId: ID;
  label: string;
  /** coût total pour toi (HT) */
  amount: number;
  qty?: number;
  /** prix de vente unitaire HT si refacturé */
  price?: number;
  billable?: boolean;
  supplierId?: ID;
  category?: string;
}

export interface Vehicle extends Base {
  name: string;
  plate?: string;
  seats?: number;
  payload?: number;
  dailyPrice: number;
  /** prix facturé au km (sinon celui des paramètres) */
  pricePerKm?: number;
  notes?: string;
}

export interface VehicleAssignment extends Base {
  projectId: ID;
  subprojectId: ID;
  vehicleId: ID;
  periodId?: ID;
  start: string;
  end: string;
  /** nombre d'allers-retours (ex. 2 = livraison + reprise) */
  trips?: number;
  /** km facturés ; recalculés depuis la distance du projet tant que kmManual n'est pas coché */
  km?: number;
  kmManual?: boolean;
  /** prix au km appliqué (sinon celui du véhicule ou des paramètres) */
  perKm?: number;
  /** prix total HT = forfait journalier × jours + km × prix au km (modifiable) */
  price: number;
  billable: boolean;
  driverId?: ID;
  notes?: string;
}

export type DocType = 'devis' | 'facture' | 'acompte' | 'avoir' | 'rappel' | 'bon_sortie' | 'feuille_route';
export const INVOICE_TYPES: DocType[] = ['facture', 'acompte', 'avoir'];
export const DOC_LABELS: Record<DocType, string> = {
  devis: 'Devis',
  facture: 'Facture',
  acompte: "Facture d'acompte",
  avoir: 'Avoir',
  rappel: 'Rappel de paiement',
  bon_sortie: 'Bon de sortie',
  feuille_route: 'Feuille de route',
};
export type DocStatus = 'brouillon' | 'envoye' | 'accepte' | 'refuse' | 'paye';
export const DOC_STATUS_LABELS: Record<DocStatus, string> = {
  brouillon: 'Brouillon',
  envoye: 'Envoyé',
  accepte: 'Accepté',
  refuse: 'Refusé',
  paye: 'Payé',
};

export interface SnapshotLine {
  name: string;
  code?: string;
  qty: number;
  unitPrice: number;
  days: number;
  factor: number;
  discount: number;
  total: number;
  group?: string;
  optional?: boolean;
  unit?: 'jour' | 'pièce';
}

export interface SnapshotSub {
  name: string;
  periods?: { name: string; kind: PeriodKind; start: string; end: string }[];
  venue?: string;
  start: string;
  end: string;
  equipment: SnapshotLine[];
  crew: { function: string; person?: string; phone?: string; start: string; end: string; days: number; rate: number; total: number; billable: boolean; unit?: 'jour' | 'heure'; hours?: number; overtime?: number; departure?: string; back?: string }[];
  vehicles: { name: string; plate?: string; driver?: string; start: string; end: string; price: number; billable: boolean; km?: number; trips?: number }[];
  subtotal: number;
}

/** Style commun des documents (éditeur de modèles simplifié). */
export interface DocStyle {
  color: string;
  font: 'sans' | 'serif' | 'arrondie';
  logoPosition: 'gauche' | 'droite' | 'centre';
  showCode: boolean;
  showFactor: boolean;
  showDiscount: boolean;
  showGroups: boolean;
  showSubtotals: boolean;
  showPeriods: boolean;
  /** masque les lignes à 0 € (accessoires gratuits…) sur les documents chiffrés */
  hideZero: boolean;
  /** devis / factures : un total par salle au lieu du détail du matériel */
  hideEquipmentDetail: boolean;
  showSignature: boolean;
}

/** Textes propres à un type de document ; variables : {client} {contact} {projet} {numero} {date} {lieu} {debut} {fin} {total} {echeance} {societe} */
export interface DocTypeTemplate {
  title?: string;
  intro?: string;
  outro?: string;
}

/** Gabarit HTML commun à tous les documents, avec variables {{…}}. */
export interface DocHtml {
  header: string;
  layout: string;
  footer: string;
  css: string;
}

export interface DocTemplates {
  style: DocStyle;
  html?: DocHtml;
  types: Partial<Record<DocType, DocTypeTemplate>>;
}

export interface DocSnapshot {
  company: CompanyInfo;
  client?: Contact;
  project: Pick<Project, 'number' | 'name' | 'venue' | 'start' | 'end' | 'notes' | 'discount' | 'externalRef'>;
  /** coûts supplémentaires refacturés */
  extras?: { label: string; qty: number; unitPrice: number; total: number }[];
  subprojects: SnapshotSub[];
  totalHT: number;
  discountAmount: number;
  vatRate: number;
  vat: number;
  totalTTC: number;
  issuedAt: string;
  validUntil?: string;
  footer?: string;
  hidePrices: boolean;
  /** lignes simples (acompte, avoir) à la place du détail */
  simpleLines?: { label: string; ht: number }[];
  /** acomptes déjà facturés, déduits du reste à payer */
  deposits?: { number: string; ttc: number }[];
  /** référence (devis pour un acompte, facture pour un avoir) */
  refNumber?: string;
  dueDate?: string;
  optionalTotal?: number;
  /** langue du document */
  lang?: Lang;
  /** champs personnalisés du projet et du client, figés (variables {{champ.clé}}) */
  customFields?: { key: string; label: string; value: string }[];
  vatRegime?: VatRegime;
  /** mention légale liée au régime de TVA */
  vatMention?: string;
  /** virement : communication (structurée belge ou numéro) */
  payment?: { communication: string; structured: boolean };
  /** facture partielle : salles facturées */
  partialRooms?: string[];
  /** facture finale : salles déjà facturées séparément */
  partialInvoices?: { number: string; rooms: string[]; ht: number }[];
  /** rappel de paiement */
  reminder?: { level: number; invoiceNumber: string; invoiceDate: string; invoiceDue?: string; amount: number };
  /** modèle figé au moment de la génération */
  template?: DocTypeTemplate & { style: DocStyle; html?: DocHtml };
}

/** Document figé : une génération = un nouvel enregistrement, jamais d'écrasement. */
export interface Doc extends Base {
  projectId: ID;
  type: DocType;
  number: string;
  version: number;
  status: DocStatus;
  note?: string;
  contactPerson?: string;
  /** facture partielle : salles facturées */
  subprojectIds?: ID[];
  snapshot: DocSnapshot;
}

export interface CompanyInfo {
  name: string;
  address?: string;
  email?: string;
  phone?: string;
  siret?: string;
  vatNumber?: string;
  iban?: string;
  bic?: string;
  logo?: string;
  country?: string;
  postalCode?: string;
  city?: string;
  street?: string;
  /** identifiant Peppol, ex. 0208:0123456789 (BE) ou 0009:SIRET (FR) */
  peppolId?: string;
}

export interface Settings {
  id: 'main';
  company: CompanyInfo;
  vatRate: number;
  /** facteur par nombre de jours : index 0 = 1 jour */
  factors: number[];
  factorExtraPerDay: number;
  quoteValidityDays: number;
  paymentDays: number;
  /** mentions légales par régime de TVA */
  vatMentions?: Partial<Record<VatRegime, string>>;
  /** communication structurée belge (+++…+++) sur les factures */
  structuredComm?: boolean;
  /** nouveau délai accordé par un rappel (jours) */
  reminderDays?: number;
  /** heures supplémentaires : au-delà de X heures par jour, majoration en % */
  overtimeAfter?: number;
  overtimeRate?: number;
  /** prix au km par défaut pour le transport */
  pricePerKm?: number;
  /** allers-retours par défaut (livraison + reprise = 2) */
  defaultTrips?: number;
  footer: string;
  appUrl: string;
  counters: Record<string, number>;
  projectTypes?: { name: string; color: string }[];
  /** catalogue des fonctions : tarif facturé au client, quel que soit le prestataire */
  crewFunctions?: CrewFunction[];
  depots?: Depot[];
  customFields?: CustomField[];
  /** nouveaux postes en planification finale par défaut */
  crewFinalByDefault?: boolean;
  templates?: DocTemplates;
}
