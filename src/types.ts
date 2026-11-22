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
  type: 'texte' | 'oui_non' | 'nombre' | 'date' | 'liste';
  /** valeurs proposées (type liste) */
  choices?: string[];
  /** affiché en colonne et en filtre dans la liste */
  inList?: boolean;
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

/** Commentaire sur un lieu (accès, électricité, retour d'expérience…). */
export interface VenueComment {
  id: ID;
  at: string;
  text: string;
  /** projet pendant lequel la remarque a été faite */
  projectId?: ID;
  /** affiché en alerte sur les projets de ce lieu */
  important?: boolean;
  /** imprimé sur la feuille de route et le bon de sortie */
  onRoadmap?: boolean;
}

/** Informations pratiques d'un lieu. */
export interface VenueInfo {
  access?: string;
  power?: string;
  onSite?: string;
  capacity?: string;
}
export const VENUE_INFO_LABELS: Record<keyof VenueInfo, string> = {
  access: 'Accès et déchargement', power: 'Électricité', onSite: 'Contact sur place', capacity: 'Salle : dimensions, capacité, accroche',
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
  /** délai de paiement propre au client (jours) */
  paymentDays?: number;
  /** moments de facturation par défaut de ses projets */
  moments?: ID[];
  /** lieu : informations pratiques et commentaires */
  venueInfo?: VenueInfo;
  comments?: VenueComment[];
  /** lieu : endroits (bâtiments, scènes, salles…), chacun pouvant avoir sa propre adresse */
  spots?: VenueSpot[];
  /** client : services (communication, RH, événementiel…) avec leurs interlocuteurs */
  departments?: Department[];
}

/** Endroit d'un lieu : bâtiment, scène, salle, entrée… (adresse propre ou celle du lieu). */
export interface VenueSpot {
  id: ID;
  name: string;
  address?: string;
  postalCode?: string;
  city?: string;
  info?: VenueInfo;
}

/** Service d'une société cliente. Ses coordonnées remplacent celles de la société sur les documents. */
export interface Department {
  id: ID;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  postalCode?: string;
  city?: string;
}

export interface ContactPerson {
  id?: ID;
  /** service de la société (vide = général) */
  departmentId?: ID;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
}

export interface Category extends Base {
  name: string;
  /** sous-catégorie : catégorie principale (Son › Micro) ; un seul niveau */
  parentId?: ID;
  /** lettre(s) dans les codes du matériel : S son, V vidéo, L lumière, IT informatique, R rigging… */
  letter?: string;
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
  /** lettre des codes du matériel basé dans ce dépôt (F-S-0010) */
  letter?: string;
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
  /** unitIds : unités choisies (articles sérialisés), rangées au dépôt d'arrivée quand le transfert définitif est effectué */
  lines: { equipmentId: ID; qty: number; unitIds?: ID[] }[];
  /** transfert définitif effectué : le stock a été déplacé (stock propre des dépôts, unités choisies) */
  applied?: boolean;
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
  /** dépôt de base (première lettre du code) */
  homeDepotId?: ID;
  /**
   * élément d'accessoire (chargeur, dock, housse…) : hors inventaire, hors catalogue et hors disponibilités,
   * il n'existe que comme accessoire d'autres articles (lignes cochées à la sortie et au retour)
   */
  accessoryOnly?: boolean;
  /** contenu fourni avec l'article, sans fiche ni stock à part (ex. PC : chargeur, dock USB-C) */
  contents?: { name: string; qty: number }[];
  /** codes en plus (code-barres du fabricant, ancienne étiquette…) qui désignent aussi l'article */
  extraCodes?: string[];
  /** mouvements de stock (ajout, inventaire, perte…), le plus récent en dernier */
  stockLog?: { at: string; delta: number; text: string; projectId?: ID }[];
  location?: string;
  notes?: string;
}

/**
 * Statuts de gestion de projet (comme Rentman depuis 2026) :
 * demande → brouillon → en attente (devis envoyé) → confirmé → en cours (1er article sorti)
 * → exécution terminée (tout est rentré) → terminé (tout est bouclé). Annulé à tout moment.
 * L'état du matériel (préparé, sorti, rentré) est suivi ligne par ligne dans l'entrepôt.
 */
export type ProjectStatus = 'demande' | 'brouillon' | 'option' | 'confirme' | 'en_cours' | 'execute' | 'termine' | 'annule';
export const STATUS_LABELS: Record<ProjectStatus, string> = {
  demande: 'Demande',
  brouillon: 'Brouillon',
  option: 'En attente',
  confirme: 'Confirmé',
  en_cours: 'En cours',
  execute: 'Exécution terminée',
  termine: 'Terminé',
  annule: 'Annulé',
};
/** Statuts dont le matériel et les personnes sont décomptés des disponibilités. */
export const RESERVING: ProjectStatus[] = ['demande', 'brouillon', 'option', 'confirme', 'en_cours', 'execute'];
/** Statuts où le matériel est réservé ferme (prioritaire sur les demandes et projets en attente). */
export const FIRM: ProjectStatus[] = ['confirme', 'en_cours', 'execute'];
/** Projet accepté par le client (apparaît dans « À facturer »). */
export const CONFIRMED: ProjectStatus[] = ['confirme', 'en_cours', 'execute', 'termine'];

export type DepositStatus = 'aucune' | 'demandee' | 'payee' | 'remboursee';
export const DEPOSIT_LABELS: Record<DepositStatus, string> = {
  aucune: 'Pas de caution', demandee: 'Demandée', payee: 'Payée', remboursee: 'Remboursée',
};

/** Note de projet et documents sur lesquels elle s'imprime. */
export interface ProjectNote {
  id: ID;
  title: string;
  text: string;
  /** types de documents qui affichent la note (vide = note interne) */
  on: DocType[];
}

/** Moment de facturation : quand et quelle part du projet facturer. */
export interface InvoiceMoment {
  id: ID;
  name: string;
  /** part du total du projet (%) */
  percent: number;
  /** accord = à la confirmation ; avant = avant le premier jour ; fin = après le dernier jour */
  trigger: 'accord' | 'avant' | 'fin';
  /** décalage en jours (ex. 14 jours avant le premier jour) */
  days?: number;
}
export const MOMENT_TRIGGERS: Record<InvoiceMoment['trigger'], string> = {
  accord: 'À la confirmation', avant: 'Avant le premier jour', fin: 'À la fin du projet',
};

export interface Project extends Base {
  number: string;
  name: string;
  clientId?: ID;
  venue?: string;
  status: ProjectStatus;
  start: string;
  end: string;
  discount: number;
  /** interlocuteur chez le client (nom affiché sur les documents) */
  contactPerson?: string;
  contactPersonId?: ID;
  /** service du client qui commande */
  departmentId?: ID;
  /** endroit du lieu (bâtiment, scène…) */
  spotId?: ID;
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
  /** notes imprimées sur certains documents */
  noteList?: ProjectNote[];
  /** caution demandée au client (non soumise à TVA) */
  deposit?: { amount: number; status: DepositStatus };
  /** assurance du matériel loué, en % du prix de location */
  insurancePct?: number;
  /** moments de facturation choisis (sinon ceux du client ou du type de projet) */
  moments?: ID[];
  /** facturé en dehors de FabEvent : n'apparaît plus dans « À facturer » */
  externalInvoiced?: boolean;
  /** date de confirmation (moment « à la confirmation ») */
  confirmedAt?: string;
  /** coûts réels saisis après le projet, par catégorie de l'onglet Finances */
  actualCosts?: Record<string, number>;
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
  /** endroit du lieu du projet où se trouve cette salle */
  spotId?: ID;
  /** horaires détaillés ; s'ils existent, start/end/prepStart/returnEnd en sont déduits */
  periods?: Period[];
  groups?: EquipGroup[];
  order: number;
  notes?: string;
  /** l'entrepôt peut commencer la préparation */
  readyToPack?: boolean;
  /** réserve le matériel même si le projet est encore en attente */
  reserve?: boolean;
  /** manquants du retour déjà déclarés perdus */
  missingSent?: boolean;
  /** ce qui a déjà été déclaré perdu au retour (« u<id d'unité> » ou « b<id de ligne> ») : jamais deux fois */
  lostSent?: string[];
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
  /** créneaux propres à la ligne (prioritaires sur ceux du groupe) */
  periodIds?: ID[];
  /** remarque imprimée sur le devis et la facture */
  remark?: string;
  /** remarque pour l'entrepôt (bon de sortie) */
  internalRemark?: string;
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

/** Ce que la personne coûte pour une fonction donnée (ex. Technicien vidéo 300 €/j, Roadie 180 €/j). */
export interface PersonRate { function: string; cost?: number; hourCost?: number }

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
  /** heures comprises dans son forfait journalier (au-delà : heures sup.) ; sinon le réglage général */
  dayHours?: number;
  external: boolean;
  /** société de sous-traitance (contact) qui facture ses prestations */
  contactId?: ID;
  notes?: string;
  /** fonctions qu'il sait occuper (formulaire d'inscription) */
  skills?: string[];
  /** tarifs propres à certaines fonctions (vidéo, son, road…) ; sinon coût par défaut */
  rates?: PersonRate[];
  city?: string;
  vatNumber?: string;
  /** indépendant, société, salarié… */
  status?: string;
  /** inscrit via le formulaire, pas encore validé */
  pending?: boolean;
  source?: 'formulaire';
  signedUpAt?: string;
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
  /** unité du coût saisi à la main (sinon celle du poste) */
  costUnit?: 'jour' | 'heure';
  billable: boolean;
  notes?: string;
  /** détails du poste envoyés au technicien confirmé */
  detailsSentAt?: string;
  /** horaires tels qu'envoyés au technicien dans son planning (pour signaler les changements) */
  sent?: { at: string; start: string; end: string; final: boolean };
}

/**
 * Demande de disponibilité envoyée à un technicien pour un ou plusieurs postes d'un projet.
 * Il répond en cliquant sur le lien (page publique du serveur) ; on peut aussi noter sa réponse à la main.
 * Les infos affichées sur la page publique sont recopiées ici (le serveur ne lit rien d'autre).
 */
export interface CrewRequest extends Base {
  token: string;
  personId: ID;
  personName: string;
  projectId: ID;
  projectName: string;
  company: string;
  venue?: string;
  message?: string;
  posts: { crewId: ID; function: string; start: string; end: string; place?: string }[];
  sentAt?: string;
  /** réponse : oui (tous les postes), partiel, non */
  answer?: 'oui' | 'partiel' | 'non';
  /** réponse poste par poste */
  answers?: Record<ID, boolean>;
  note?: string;
  answeredAt?: string;
  /** noté à la main (téléphone, SMS…) */
  manual?: boolean;
  /** postes pourvus : le lien affiche « plus besoin de répondre » */
  closed?: boolean;
}

/** Liste de postes préétablie : fonctions, nombre, créneau (type), tarif client prévu. */
export interface CrewPreset {
  id: ID;
  name: string;
  posts: { function: string; qty: number; rate: number; rateUnit?: 'jour' | 'heure'; periodKind?: PeriodKind }[];
}

export type MailKind = 'devis' | 'facture' | 'acompte' | 'avoir' | 'rappel' | 'bon_sortie' | 'feuille_route' | 'planning' | 'dispo' | 'confirmation' | 'annulation' | 'sous_location' | 'autre';
export interface MailTemplate {
  id: ID;
  kind: MailKind;
  name: string;
  subject: string;
  body: string;
}

export interface Unavailability extends Base {
  personId: ID;
  start: string;
  end: string;
  reason?: string;
}

export interface SerialUnit extends Base {
  equipmentId: ID;
  /** numéro de l'unité dans son article (#1, #2…), fixe : jamais réutilisé ni décalé */
  number?: number;
  serial: string;
  barcode?: string;
  /** hs / perdu = sorti définitivement du stock */
  status: 'ok' | 'hs' | 'perdu';
  /** à réparer mais encore utilisable (défaut signalé au scan) */
  defect?: string;
  /** historique daté de l'unité (perdue, réparée, retrouvée…), le plus récent en dernier */
  history?: { at: string; text: string; projectId?: ID }[];
  /** codes en plus (n° gravé, ancienne étiquette…) */
  extraCodes?: string[];
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
  /** fournisseur en texte libre (relié à un contact s'il porte le même nom) ; absent des documents s'il est vide */
  supplierName?: string;
  category?: string;
  /** les montants se saisissent TVA comprise (stockés hors TVA) */
  vatIncl?: boolean;
  vatRate?: number;
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
  remark?: string;
  periods?: string;
  /** contenu fourni (bon de sortie, feuille de route) */
  contents?: string;
}

export interface SnapshotSub {
  name: string;
  /** adresse de l'endroit si elle diffère de celle du projet */
  address?: string;
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
  /** moderne : en-têtes de tableaux colorés, cartes ; sobre : noir et blanc, filets fins */
  theme?: 'moderne' | 'sobre';
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
  /** service du client (ses coordonnées priment sur celles de la société) */
  department?: Department;
  /** email de l'interlocuteur ou du service, pour l'envoi */
  contactEmail?: string;
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
  /** lieu : informations pratiques et commentaires à imprimer (feuille de route, bon de sortie) */
  venueNotes?: { label: string; text: string }[];
  /** feuille de route / bon de sortie : contacts du client et du lieu */
  contacts?: { role: string; name: string; detail?: string; phone?: string; email?: string }[];
  /** notes du projet prévues pour ce type de document */
  notes?: { title: string; text: string }[];
  /** caution à verser (hors TVA) */
  deposit?: { amount: number; status: DepositStatus };
  /** conditions générales */
  terms?: string;
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
  projectTypes?: { name: string; color: string; moments?: ID[] }[];
  /** QR des étiquettes = lien vers la fiche (lisible avec l'appareil photo de n'importe quel téléphone) */
  qrLink?: boolean;
  /** modèles d'étiquettes créés par l'utilisateur (planches A4, rouleaux) */
  labelTemplates?: import('./labelTemplates').LabelTemplate[];
  /** modèle d'étiquette proposé d'office sur la page Étiquettes */
  labelDefault?: string;
  /** modèles d'étiquettes standard masqués (inutiles pour cette société) */
  labelHidden?: string[];
  /** lettre des codes du matériel quand aucun dépôt n'est déclaré (F par défaut) */
  codeLetter?: string;
  /** moments de facturation (au plus 3 par projet) */
  invoiceMoments?: InvoiceMoment[];
  /** assurance matériel par défaut (% du prix de location, 0 = aucune) */
  insurancePct?: number;
  /** conditions générales imprimées après les devis (et les factures si coché) */
  terms?: string;
  termsOnInvoices?: boolean;
  /** catalogue des fonctions : tarif facturé au client, quel que soit le prestataire */
  crewFunctions?: CrewFunction[];
  depots?: Depot[];
  customFields?: CustomField[];
  /** nouveaux postes en planification finale par défaut */
  crewFinalByDefault?: boolean;
  /** listes de postes préétablies (ex. « Équipe son conférence ») avec leur tarif client prévu */
  crewPresets?: CrewPreset[];
  /** clé du formulaire d'inscription des techniciens (lien public) ; vide = formulaire fermé */
  signupKey?: string;
  /** modèles de mail par type d'envoi */
  mailTemplates?: MailTemplate[];
  templates?: DocTemplates;
}

/** Ligne d'une checklist libre (bon importé ou liste saisie à la main). */
export interface FreeLine {
  id: ID;
  cat: string;
  /** contenu d'un kit : ligne parente */
  parent: ID | null;
  qty: number;
  name: string;
  code?: string;
  /** article FabEvent reconnu par son code (permet le scan) */
  equipmentId?: ID;
  out: number;
  back: number;
  outSerials?: string[];
  inSerials?: string[];
}

/** Checklist libre : job hors FabEvent, créée depuis un bon (PDF, Word, HTML, texte) ou à la main. */
export interface FreeChecklist extends Base {
  title: string;
  meta: Record<string, string>;
  plan: { label: string; from: string; to: string }[];
  lines: FreeLine[];
  phase: 'sortie' | 'retour';
  missingSent?: boolean;
  lostSent?: string[];
  /** projet FabEvent créé à partir de cette liste */
  projectId?: ID;
}
