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
  notes?: string;
}

export interface Category extends Base {
  name: string;
}

export interface KitItem {
  equipmentId: ID;
  qty: number;
}

export interface Equipment extends Base {
  name: string;
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
  notes?: string;
}

export interface Subproject extends Base {
  projectId: ID;
  name: string;
  venue?: string;
  status: ProjectStatus;
  start: string;
  end: string;
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
}

export interface Person extends Base {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  dailyRate: number;
  external: boolean;
  contactId?: ID;
  notes?: string;
}

export interface CrewAssignment extends Base {
  projectId: ID;
  subprojectId: ID;
  personId?: ID;
  function: string;
  start: string;
  end: string;
  rate: number;
  billable: boolean;
  notes?: string;
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

export type DocType = 'devis' | 'facture' | 'bon_sortie' | 'feuille_route';
export const DOC_LABELS: Record<DocType, string> = {
  devis: 'Devis',
  facture: 'Facture',
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
}

export interface SnapshotSub {
  name: string;
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
}

/** Document figé : une génération = un nouvel enregistrement, jamais d'écrasement. */
export interface Doc extends Base {
  projectId: ID;
  type: DocType;
  number: string;
  version: number;
  status: DocStatus;
  note?: string;
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
  logo?: string;
}

export interface Settings {
  id: 'main';
  company: CompanyInfo;
  vatRate: number;
  /** facteur par nombre de jours : index 0 = 1 jour */
  factors: number[];
  factorExtraPerDay: number;
  quoteValidityDays: number;
  footer: string;
  appUrl: string;
  counters: Record<string, number>;
}
