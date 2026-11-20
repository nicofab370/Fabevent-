export type ID = string;

export interface Base {
  id: ID;
  createdAt: string;
  updatedAt: string;
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

export interface Equipment extends Base {
  name: string;
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
  notes?: string;
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

export interface Person extends Base {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  dailyRate: number;
  /** ce que la personne te coûte par jour */
  costRate?: number;
  external: boolean;
  contactId?: ID;
  notes?: string;
}

export interface CrewAssignment extends Base {
  projectId: ID;
  subprojectId: ID;
  personId?: ID;
  /** créneau du sous-projet auquel le poste est rattaché */
  periodId?: ID;
  function: string;
  start: string;
  end: string;
  rate: number;
  /** coût / jour pour toi */
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

export interface ProjectCost extends Base {
  projectId: ID;
  label: string;
  amount: number;
}

export interface Vehicle extends Base {
  name: string;
  plate?: string;
  seats?: number;
  payload?: number;
  dailyPrice: number;
  notes?: string;
}

export interface VehicleAssignment extends Base {
  projectId: ID;
  subprojectId: ID;
  vehicleId: ID;
  start: string;
  end: string;
  price: number;
  billable: boolean;
  driverId?: ID;
  notes?: string;
}

export type DocType = 'devis' | 'facture' | 'acompte' | 'avoir' | 'bon_sortie' | 'feuille_route';
export const INVOICE_TYPES: DocType[] = ['facture', 'acompte', 'avoir'];
export const DOC_LABELS: Record<DocType, string> = {
  devis: 'Devis',
  facture: 'Facture',
  acompte: "Facture d'acompte",
  avoir: 'Avoir',
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
  crew: { function: string; person?: string; phone?: string; start: string; end: string; days: number; rate: number; total: number; billable: boolean }[];
  vehicles: { name: string; plate?: string; driver?: string; start: string; end: string; price: number; billable: boolean }[];
  subtotal: number;
}

export interface DocSnapshot {
  company: CompanyInfo;
  client?: Contact;
  project: Pick<Project, 'number' | 'name' | 'venue' | 'start' | 'end' | 'notes' | 'discount'>;
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
  footer: string;
  appUrl: string;
  counters: Record<string, number>;
}
