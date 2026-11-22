import Papa from 'papaparse';
import { useState } from 'react';
import { nextUnitCode, suggestCategoryLetter } from '../codegen';
import { Field, PageHead } from '../components/ui';
import { db, getSettings, nextNumber } from '../db';
import type { Contact, ContactPerson, ContactType, Department, Equipment, InvoiceMoment, Person, PersonRate, ProjectStatus } from '../types';
import { settingsMoments } from '../invoicing';
import { nowIso, parseDate, parseNumber, uid } from '../utils';

type Target = 'equipment' | 'contacts' | 'people' | 'projects';

/**
 * Champ FabEvent et colonnes reconnues. Les noms exacts des exports Rentman (FR) passent en premier.
 * alt : autres colonnes lues si la colonne choisie est vide sur une ligne (ex. adresse de visite, sinon postale).
 * note : la valeur est ajoutée aux notes de la fiche, précédée de ce libellé.
 */
interface ImportField { key: string; label: string; guess: string[]; alt?: string[]; note?: string; group?: string }

const UNIT = 'Unités (une ligne par numéro de série)';
const PERSON = 'Personnes de contact (une ligne par personne)';
const MORE = 'Gardé dans les notes';
const RATE = 'Tarifs (une ligne par tarif)';

const FIELDS: Record<Target, ImportField[]> = {
  equipment: [
    { key: 'name', label: 'Désignation *', guess: ['nom (dans la base de données)', 'nom', 'name', 'désignation', 'designation', 'displayname', 'article'] },
    { key: 'code', label: 'Référence (code équipement)', guess: ['code', 'référence', 'reference', 'ref', 'numéro', 'number'] },
    { key: 'category', label: 'Catégorie', guess: ['dossier (dossier)', 'catégorie', 'categorie', 'category', 'dossier', 'folder', 'groupe'] },
    { key: 'path', label: 'Chemin (catégorie / sous-catégorie, prioritaire)', guess: ['chemin', 'path', 'category path'] },
    { key: 'quantity', label: 'Quantité', guess: ['quantité actuelle', 'quantité', 'quantite', 'quantity', 'stock', 'qté', 'qty', 'nombre'] },
    { key: 'dailyPrice', label: 'Prix / jour', guess: ['prix de location/vente', 'prix', 'price', 'tarif', 'prix de location', 'rental price', 'prix/jour'] },
    { key: 'costPrice', label: "Prix d'achat / sous-location", guess: ['prix de sous-location/achat', "prix d'achat", 'cost price'] },
    { key: 'replacementValue', label: 'Valeur de remplacement', guess: ['prix neuf', 'valeur de remplacement', 'replacement', 'new price'] },
    { key: 'weight', label: 'Poids (kg)', guess: ['poids', 'weight'] },
    { key: 'barcode', label: "Code-barres de l'article", guess: ['qr codes / rfid', 'code-barres', 'barcode', 'code barre', 'qr'] },
    { key: 'location', label: 'Emplacement', guess: ["emplacement dans l'emplacement de stock par défaut", 'emplacement', 'location in warehouse'] },
    { key: 'notes', label: 'Notes', guess: ['remarque interne', 'notes', 'remarque', 'description', 'memo'] },
    { key: 'tags', label: 'Étiquettes', guess: ['étiquettes', 'etiquettes', 'tags'] },
    { key: 'kind', label: 'Location / vente', guess: ['location / vente', 'location/vente', 'rental / sale'] },
    { key: 'type', label: 'Type (article / combinaison = kit)', guess: ["type d'équipement", 'type', 'equipment type'] },
    { key: 'archived', label: 'Archivé', guess: ['archivé.e.s', 'archivé', 'archived'] },
    { key: 'method', label: 'Suivi (sérialisé / en vrac)', guess: ['méthode de calcul des stocks', 'stock method', 'suivi'] },
    { key: 'extNote', label: 'Remarque externe', guess: ['remarque externe'], note: 'Remarque externe', group: MORE },
    { key: 'length', label: 'Longueur (cm)', guess: ['longueur', 'length'], group: MORE },
    { key: 'width', label: 'Largeur (cm)', guess: ['largeur', 'width'], group: MORE },
    { key: 'height', label: 'Hauteur (cm)', guess: ['hauteur', 'height'], group: MORE },
    { key: 'volume', label: 'Volume transport (m³)', guess: ['volume transport'], note: 'Volume transport (m³)', group: MORE },
    { key: 'power', label: 'Puissance (W)', guess: ['puissance', 'power'], note: 'Puissance (W)', group: MORE },
    { key: 'serial', label: 'Numéro de série', guess: ['afficher nom (numéro de série)', 'numéro de série', 'numero de serie', 'n° de série', 'serial', 'serial number', 'serienummer', 'sn', 's/n'], group: UNIT },
    { key: 'unitBarcode', label: "Code-barres de l'unité", guess: ['qr codes / rfid (numéro de série)'], group: UNIT },
    { key: 'mfrSerial', label: 'N° de série du fabricant', guess: ['numéro de série du fabricant (numéro de série)', 'numéro de série du fabricant'], group: UNIT },
    { key: 'unitActive', label: 'Unité active', guess: ['actif/·ive (numéro de série)'], group: UNIT },
    { key: 'unitLost', label: 'Unité perdue', guess: ['perdu (numéro de série, perdu)'], group: UNIT },
    { key: 'unitNotes', label: 'Remarque', guess: ['remarque (numéro de série)'], group: UNIT },
    { key: 'unitBought', label: "Date d'achat", guess: ["date d'achat (numéro de série)"], group: UNIT },
    { key: 'unitPrice', label: "Prix d'achat", guess: ["prix d'achat (numéro de série)"], group: UNIT },
  ],
  contacts: [
    { key: 'company', label: 'Nom / société *', guess: ['nom', "nom de l'entreprise", 'société', 'societe', 'company', 'name', 'displayname', 'entreprise'] },
    { key: 'rid', label: 'ID Rentman (regroupe les lignes)', guess: ['id'] },
    { key: 'type', label: 'Type (client, lieu, fournisseur…)', guess: ['dossier (dossier)', 'chemin', 'type', 'catégorie', 'category'] },
    { key: 'firstName', label: 'Prénom', guess: ['prénom', 'prenom', 'first name', 'firstname'] },
    { key: 'lastName', label: 'Nom de famille', guess: ['nom de famille', 'last name', 'lastname', 'surname'] },
    { key: 'email', label: 'Email', guess: ['e-mail', 'email', 'mail'] },
    { key: 'phone', label: 'Téléphone', guess: ['téléphone', 'telephone', 'phone', 'tél', 'tel', 'mobile'], alt: ['téléphone 2'] },
    { key: 'street', label: 'Rue', guess: ['rue (adresse de visite)', 'adresse', 'address', 'rue', 'street', 'visit address'], alt: ['rue (adresse postale)', 'rue (adresse de facturation)'] },
    { key: 'houseNumber', label: 'Numéro', guess: ["numéro d'habitation (adresse physique)", "numéro d'habitation", 'house number'], alt: ["numéro d'habitation (adresse postale)", "numéro d'habitation (adresse de facturation)"] },
    { key: 'postalCode', label: 'Code postal', guess: ['code postal (adresse de visite)', 'code postal', 'postal', 'zip', 'cp', 'postalcode'], alt: ['code postal (adresse postale)', 'code postal (adresse de facturation)'] },
    { key: 'city', label: 'Ville', guess: ['ville (adresse de visite)', 'ville', 'city', 'localité'], alt: ['ville (adresse postale)', 'ville (adresse de facturation)'] },
    { key: 'country', label: 'Pays', guess: ['pays (adresse de visite)', 'pays', 'country'], alt: ['pays (adresse postale)'] },
    { key: 'vatNumber', label: 'N° TVA', guess: ['n° de tva', 'tva', 'vat', 'vat number'] },
    { key: 'siret', label: 'N° SIRET', guess: ['numéro siret', 'siret'] },
    { key: 'peppolScheme', label: 'Peppol : schéma', guess: ["schéma d'identification"] },
    { key: 'peppolNumber', label: "Peppol : numéro d'identification", guess: ["numéro d'identification", 'peppol'] },
    { key: 'paymentDays', label: 'Délai de paiement (jours)', guess: ['condition de paiement (condition de paiement)', 'condition de paiement', 'payment term'] },
    { key: 'discountEquipment', label: 'Remise matériel (%)', guess: ['remise sur matériel de location'] },
    { key: 'discountTotal', label: 'Remise sur le total (%)', guess: ['remise prix total'] },
    { key: 'tags', label: 'Étiquettes', guess: ['étiquettes', 'etiquettes', 'tags'] },
    { key: 'notes', label: 'Notes', guess: ['note automatique sur le projet', 'notes', 'remarque', 'description'] },
    { key: 'warning', label: 'Avertissement', guess: ['avertissement'], note: 'Avertissement', group: MORE },
    { key: 'website', label: 'Site internet', guess: ['site internet', 'website', 'site web'], note: 'Site', group: MORE },
    { key: 'email2', label: 'Email 2', guess: ['e-mail 2', 'email 2'], note: 'Email 2', group: MORE },
    { key: 'clientNo', label: 'Numéro de client', guess: ['numéro de client', 'customer number'], note: 'N° client Rentman', group: MORE },
    { key: 'billingStreet', label: 'Adresse de facturation', guess: ['rue (adresse de facturation)'], group: MORE },
    { key: 'pName', label: 'Nom', guess: ['afficher nom (personne de contact)'], group: PERSON },
    { key: 'pFirst', label: 'Prénom', guess: ['prénom (personne de contact)'], group: PERSON },
    { key: 'pLast', label: 'Nom de famille', guess: ['nom de famille (personne de contact)'], group: PERSON },
    { key: 'pRole', label: 'Fonction', guess: ['fonction (personne de contact)'], group: PERSON },
    { key: 'pEmail', label: 'Email', guess: ['e-mail (personne de contact)'], group: PERSON },
    { key: 'pPhone', label: 'Téléphone', guess: ['mobile (personne de contact)'], alt: ['téléphone (personne de contact)'], group: PERSON },
    { key: 'pDept', label: 'Service', guess: ['service (personne de contact)'], group: PERSON },
  ],
  people: [
    { key: 'name', label: 'Nom *', guess: ['nom complet', 'nom', 'name', 'displayname'] },
    { key: 'firstName', label: 'Prénom (si pas de nom complet)', guess: ['prénom', 'prenom', 'first name'] },
    { key: 'lastName', label: 'Nom de famille (si pas de nom complet)', guess: ['nom de famille', 'last name'] },
    { key: 'role', label: 'Fonction', guess: ['fonction', 'function', 'role', 'poste'] },
    { key: 'email', label: 'Email', guess: ['e-mail', 'email', 'mail'] },
    { key: 'phone', label: 'Téléphone', guess: ['téléphone', 'telephone', 'phone', 'mobile'] },
    { key: 'dailyRate', label: 'Tarif facturé / jour', guess: ['tarif', 'rate', 'prix', 'taux'] },
    { key: 'status', label: 'Statut (freelance, salarié…)', guess: ['type de contrat', 'statut', 'contract type'] },
    { key: 'group', label: 'Groupe (dossier)', guess: ['dossier (dossier)', 'dossier', 'groupe'], note: 'Groupe' },
    { key: 'city', label: 'Ville', guess: ['ville', 'city'] },
    { key: 'vatNumber', label: 'N° TVA', guess: ['n° de tva', 'tva', 'vat'] },
    { key: 'notes', label: 'Notes', guess: ['description', 'notes', 'remarque'] },
    { key: 'street', label: 'Rue', guess: ['rue', 'street'], group: MORE },
    { key: 'houseNumber', label: 'Numéro', guess: ["numéro d'habitation"], group: MORE },
    { key: 'postalCode', label: 'Code postal', guess: ['code postal', 'postal code'], group: MORE },
    { key: 'company', label: "Nom de l'entreprise", guess: ["nom de l'entreprise", 'société'], note: 'Société', group: MORE },
    { key: 'birth', label: 'Date de naissance', guess: ['date de naissance', 'birth date'], note: 'Date de naissance', group: MORE },
    { key: 'licence', label: 'Permis de conduire', guess: ['permis de conduire', 'driving licence'], note: 'Permis', group: MORE },
    { key: 'iban', label: 'Compte bancaire', guess: ['numéro de compte bancaire', 'iban'], note: 'Compte', group: MORE },
    { key: 'emergency', label: "Contact d'urgence", guess: ["contact d'urgence", 'emergency contact'], note: "Contact d'urgence", group: MORE },
    { key: 'contractHours', label: 'Heures du contrat', guess: ['heures du contrat'], note: 'Heures du contrat', group: MORE },
    { key: 'rateName', label: 'Nom du tarif', guess: ['nom (tarif membre du personnel)'], group: RATE },
    { key: 'hourCost', label: 'Coût par heure', guess: ['taux de rémunération par heure (tarif membre du personnel)', 'taux horaire', 'hourly rate'], group: RATE },
    { key: 'fixedCost', label: 'Coût fixe (par jour)', guess: ['taux de rémunération fixe (tarif membre du personnel)'], group: RATE },
  ],
  projects: [
    { key: 'number', label: 'Numéro', guess: ['numéro', 'number', 'n°', 'reference', 'référence'] },
    { key: 'name', label: 'Nom du projet *', guess: ['nom', 'name', 'projet', 'project', 'displayname'] },
    { key: 'client', label: 'Client (nom)', guess: ['client (client)', 'client', 'customer', 'contact', 'société'] },
    { key: 'contactPerson', label: 'Personne de contact', guess: ['personne de contact administrative (client)', 'personne de contact (client)', 'personne de contact', 'contact person'] },
    { key: 'type', label: 'Type de projet', guess: ['type de projet (type de projet)', 'type de projet', 'project type'] },
    { key: 'venue', label: 'Lieu', guess: ['lieu (lieu)', 'lieu', 'location', 'venue', 'adresse'] },
    { key: 'start', label: 'Début', guess: ["début de la période d'utilisation", 'début', 'debut', 'start', 'date de début', 'usage start', 'planperiod start'] },
    { key: 'end', label: 'Fin', guess: ["fin de la période d'utilisation", 'fin', 'end', 'date de fin', 'usage end', 'planperiod end'] },
    { key: 'status', label: 'Statut', guess: ['statut du projet', 'statut', 'status', 'état'] },
    { key: 'externalRef', label: 'Référence client (bon de commande)', guess: ['référence externe', 'numéro de commande', 'bon de commande', 'po number'] },
    { key: 'moment', label: 'Moment de facturation', guess: ['nom (moment de facturation)', 'moment de facturation'] },
    { key: 'price', label: 'Prix du projet (HT)', guess: ['prix du projet', 'project total', 'total'], note: 'Prix Rentman (HT)' },
    { key: 'invoiced', label: 'Déjà facturé (marque le projet comme facturé)', guess: ['déjà facturé', 'already invoiced'], note: 'Déjà facturé dans Rentman' },
    { key: 'notes', label: 'Notes', guess: ['remarque', 'notes', 'description'] },
  ],
};

const TARGET_LABELS: Record<Target, string> = { equipment: 'Matériel', contacts: 'Contacts', people: 'Équipe', projects: 'Projets' };

const norm = (s: string) => s.toLowerCase().replace(/[​\s]+/g, ' ').trim();

/** reconnaît un export Rentman à ses colonnes */
function detectTarget(cols: string[]): Target | null {
  const has = (c: string) => cols.some((x) => norm(x) === c);
  if (has('méthode de calcul des stocks') || has('nom (dans la base de données)')) return 'equipment';
  if (has('statut du projet') || has('prix du projet')) return 'projects';
  if (has('nom complet') && (has('type de contrat') || has('employabilité'))) return 'people';
  if (has('afficher nom (personne de contact)') || has('numéro de client')) return 'contacts';
  return null;
}

function guessMap(target: Target, cols: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = () => Object.values(out);
  // d'abord les noms exacts (exports Rentman), ensuite les noms approchants parmi les colonnes restantes
  for (const f of FIELDS[target]) {
    const hit = f.guess.map((g) => cols.find((c) => norm(c) === g)).find((c) => c && !used().includes(c));
    if (hit) out[f.key] = hit;
  }
  for (const f of FIELDS[target]) {
    if (out[f.key] || f.guess.length < 2) continue;
    const sub = !!f.group && f.group !== MORE; // champs d'unité, de personne de contact, de tarif
    const hit = cols.find((c) => !used().includes(c) && (sub || !/\((numéro de série|personne de contact|tarif membre)/i.test(c))
      && f.guess.some((g) => g.length > 2 && norm(c).includes(g)));
    if (hit) out[f.key] = hit;
  }
  return out;
}

function mapStatus(v: string): ProjectStatus {
  // projet à plusieurs sous-projets : « En cours / Confirmé / Annulé » → le premier
  const s = v.split('/')[0].toLowerCase();
  if (/annul|cancel/.test(s)) return 'annule';
  if (/concept|brouillon|draft/.test(s)) return 'brouillon';
  if (/option|attente|pending/.test(s)) return 'option';
  if (/confirm/.test(s)) return 'confirme';
  if (/ex[ée]cution|retourn|returned/.test(s)) return 'execute';
  if (/termin|clôtur|closed|finished/.test(s)) return 'termine';
  if (/cours|prepar|progress|site|route/.test(s)) return 'en_cours';
  return 'demande';
}
function mapContactType(v: string): ContactType {
  const s = v.toLowerCase();
  if (/fourn|supplier/.test(s)) return 'fournisseur';
  if (/sous|subcontract|freelance/.test(s)) return 'soustraitant';
  if (/lieu|location|venue|salle/.test(s)) return 'lieu';
  return 'client';
}
const COUNTRIES: Record<string, string> = {
  belgique: 'BE', belgium: 'BE', 'belgië': 'BE', belgie: 'BE', france: 'FR', 'pays-bas': 'NL', nederland: 'NL', netherlands: 'NL',
  luxembourg: 'LU', allemagne: 'DE', deutschland: 'DE', germany: 'DE', suisse: 'CH', switzerland: 'CH', espagne: 'ES', italie: 'IT',
  'royaume-uni': 'GB', 'united kingdom': 'GB',
};
const country = (v: string) => (v ? COUNTRIES[v.toLowerCase()] || v : undefined);
/** numéro belge exporté comme nombre (470254869) : on remet le 0 */
const phone = (v: string) => (/^[1-9]\d{7,8}$/.test(v) ? '0' + v : v) || undefined;
const yes = (v: string) => /^(1|oui|yes|true|vrai|x)$/i.test(v);
const no = (v: string) => /^(0|non|no|false|faux)$/i.test(v);
/** Rentman exporte les remises en fraction (0,1 = 10 %) */
const pct = (v: string) => { const n = parseNumber(v); return n > 0 && n <= 1 ? Math.round(n * 1000) / 10 : n || undefined; };
const list = (v: string) => { const l = v.split(/[,;]/).map((x) => x.trim()).filter(Boolean); return l.length ? l : undefined; };
const joinLines = (...l: (string | undefined)[]) => l.filter(Boolean).join('\n') || undefined;

export default function ImportPage() {
  const [target, setTarget] = useState<Target>('equipment');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');
  const [detected, setDetected] = useState('');
  const [busy, setBusy] = useState(false);
  /** chemin Rentman « Fabri / Son / Console » : le premier niveau (société, dépôt) n'est pas une catégorie */
  const [skipRoot, setSkipRoot] = useState(true);

  const onFile = (file: File) => {
    setResult('');
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => {
        const c = r.meta.fields || [];
        const d = detectTarget(c);
        const t = d || target;
        if (d) setTarget(d);
        setDetected(d ? `Export ${TARGET_LABELS[d]} de Rentman reconnu.` : '');
        setCols(c);
        setRows(r.data);
        setMap(guessMap(t, c));
      },
    });
  };

  const run = async () => {
    setBusy(true);
    try { setResult(await importRows()); } catch (e) { setResult('Erreur : ' + (e as Error).message); }
    setBusy(false);
    setRows([]);
    setCols([]);
  };

  const importRows = async (): Promise<string> => {
    const byNorm = new Map(cols.map((c) => [norm(c), c]));
    const fields = new Map(FIELDS[target].map((f) => [f.key, f]));
    const get = (row: Record<string, string>, k: string): string => {
      const v = map[k] ? (row[map[k]] ?? '').toString().trim() : '';
      if (v || !map[k]) return v;
      for (const a of fields.get(k)?.alt || []) {
        const c = byNorm.get(a);
        const w = c ? (row[c] ?? '').toString().trim() : '';
        if (w) return w;
      }
      return '';
    };
    /** lignes « Libellé : valeur » des colonnes gardées dans les notes */
    const extra = (row: Record<string, string>) => FIELDS[target]
      .filter((f) => f.note && map[f.key])
      .map((f) => [f.note, get(row, f.key)] as const)
      .filter(([, v]) => v && v !== '0' && !/^0([.,]0+)?$/.test(v))
      .map(([l, v]) => `${l} : ${v}`);
    const t = nowIso();

    if (target === 'equipment') {
      const keyOf = (r: Record<string, string>) => (get(r, 'code') || get(r, 'name')).toLowerCase();
      // par article du fichier : nombre de numéros de série, quantité, méthode de suivi
      const groups = new Map<string, { serials: number; qty: number; serialized: boolean }>();
      for (const r of rows) {
        const k = keyOf(r);
        if (!k) continue;
        const g = groups.get(k) || { serials: 0, qty: parseNumber(get(r, 'quantity')), serialized: /s[ée]ri/i.test(get(r, 'method')) };
        if (get(r, 'serial')) g.serials++;
        groups.set(k, g);
      }
      const cats = await db.categories.toArray();
      /** catégorie (et sous-catégorie) d'une ligne, créées si besoin */
      const categoryOf = async (r: Record<string, string>): Promise<string | undefined> => {
        const path = get(r, 'path');
        const segs = path ? path.split(/\s*[/>›]\s*/).map((x) => x.trim()).filter(Boolean) : [get(r, 'category')].filter(Boolean);
        if (path && skipRoot && segs.length > 1) segs.shift();
        if (!segs.length) return undefined;
        const same = (a: string, b: string) => a.localeCompare(b, 'fr', { sensitivity: 'base' }) === 0;
        const find = (name: string, parentId?: string) => cats.find((c) => same(c.name, name) && (path ? (c.parentId || undefined) === parentId : true));
        const make = async (name: string, parentId?: string) => {
          const c = { id: uid(), name, parentId, letter: parentId ? undefined : suggestCategoryLetter(name, cats.map((x) => x.letter || '')), createdAt: t, updatedAt: t };
          await db.categories.put(c);
          cats.push(c);
          return c;
        };
        const main = find(segs[0]) || await make(segs[0]);
        if (segs.length === 1) return main.id;
        const subName = segs.slice(1).join(' / ');
        return (find(subName, main.id) || await make(subName, main.id)).id;
      };
      // articles déjà connus (base ou lignes précédentes du fichier) : par référence, ou par nom s'il n'y a pas de référence
      const known = await db.equipment.toArray();
      const byCode = new Map(known.filter((e) => e.code).map((e) => [e.code!.toLowerCase(), e]));
      const byName = new Map(known.map((e) => [e.name.toLowerCase(), e]));
      const fresh = new Set<string>();
      const units = await db.units.toArray();
      let created = 0; let existing = 0; let added = 0; let skipped = 0;
      const unitCols = !!map.unitBarcode;
      for (const r of rows) {
        const name = get(r, 'name');
        const code = get(r, 'code');
        const serial = get(r, 'serial');
        if (!name && !code) continue;
        const g = groups.get(keyOf(r))!;
        let e: Equipment | undefined = code ? byCode.get(code.toLowerCase()) : byName.get(name.toLowerCase());
        if (!e) {
          const categoryId = await categoryOf(r);
          // suivi par numéro de série : article sérialisé, ou numéros pour tout le stock
          const tracked = g.serialized || (g.serials > 0 && g.serials >= g.qty);
          const dims = ['length', 'width', 'height'].map((k) => parseNumber(get(r, k)));
          const rowNotes = serial && !unitCols ? undefined : get(r, 'notes');
          e = {
            id: uid(), createdAt: t, updatedAt: t, name: name || code, code: code || undefined, categoryId,
            quantity: tracked ? 0 : map.quantity ? g.qty : 1, dailyPrice: parseNumber(get(r, 'dailyPrice')),
            costPrice: parseNumber(get(r, 'costPrice')) || undefined,
            replacementValue: parseNumber(get(r, 'replacementValue')) || undefined, weight: parseNumber(get(r, 'weight')) || undefined,
            barcode: serial && !unitCols ? undefined : get(r, 'barcode') || undefined,
            location: get(r, 'location') || undefined,
            notes: joinLines(rowNotes, ...extra(r), dims.some(Boolean) ? `Dimensions (L × l × H, cm) : ${dims.join(' × ')}` : undefined),
            isKit: /combin|kit/i.test(get(r, 'type')), kitItems: [], trackSerials: tracked || undefined,
            kind: /vente|sale/i.test(get(r, 'kind')) ? 'vente' : undefined,
            archived: yes(get(r, 'archived')) || undefined, tags: list(get(r, 'tags')),
          };
          await db.equipment.put(e);
          if (e.code) byCode.set(e.code.toLowerCase(), e);
          byName.set(e.name.toLowerCase(), e);
          fresh.add(e.id);
          created++;
        } else if (!fresh.has(e.id)) {
          if (!serial) { existing++; continue; }
          if (!e.trackSerials) { await db.equipment.update(e.id, { trackSerials: true, updatedAt: t }); e.trackSerials = true; }
        }
        if (!serial) continue;
        if (!e.trackSerials) {
          // article en vrac avec quelques numéros : on les garde en note
          e.notes = joinLines(e.notes, `N° de série : ${serial}`);
          await db.equipment.update(e.id, { notes: e.notes });
          continue;
        }
        const mine = units.filter((u) => u.equipmentId === e!.id);
        if (mine.some((u) => u.serial.toLowerCase() === serial.toLowerCase())) { skipped++; continue; }
        const mfr = get(r, 'mfrSerial');
        const bought = parseDate(get(r, 'unitBought'));
        const price = parseNumber(get(r, 'unitPrice'));
        const unit = {
          id: uid(), createdAt: t, updatedAt: t, equipmentId: e.id, serial,
          status: yes(get(r, 'unitLost')) ? 'perdu' as const : no(get(r, 'unitActive')) ? 'hs' as const : 'ok' as const,
          barcode: (unitCols ? get(r, 'unitBarcode') : get(r, 'barcode')) || (e.code ? nextUnitCode(e, mine) : undefined),
          extraCodes: mfr ? [mfr] : undefined,
          notes: joinLines(unitCols ? get(r, 'unitNotes') : get(r, 'notes'), bought ? `Acheté le ${bought.slice(0, 10).split('-').reverse().join('/')}` : undefined, price ? `Prix d'achat : ${price} €` : undefined),
        };
        await db.units.put(unit);
        units.push(unit);
        added++;
      }
      return `${created} article(s) importé(s)` + (added ? `, ${added} numéro(s) de série ajouté(s)` : '')
        + (existing ? `, ${existing} article(s) déjà présent(s) ignoré(s)` : '') + (skipped ? `, ${skipped} numéro(s) déjà connu(s) ignoré(s)` : '') + '.';
    }

    if (target === 'contacts') {
      // une ligne par personne de contact : on regroupe par nom de société
      const all = await db.contacts.toArray();
      const byName = new Map(all.map((c) => [c.company.toLowerCase(), c]));
      const fresh = new Set<string>();
      const touched = new Map<string, Contact>();
      let created = 0; let existing = 0; let persons = 0;
      for (const r of rows) {
        const company = get(r, 'company') || [get(r, 'firstName'), get(r, 'lastName')].filter(Boolean).join(' ');
        if (!company) continue;
        // lignes d'un même contact : même ID Rentman (deux contacts peuvent porter le même nom), sinon même nom
        const key = get(r, 'rid') ? `id:${get(r, 'rid')}` : company.toLowerCase();
        const sameNameCreated = [...touched.values()].some((x) => fresh.has(x.id) && x.company.toLowerCase() === company.toLowerCase());
        let c = touched.get(key) || (sameNameCreated ? undefined : byName.get(company.toLowerCase()));
        if (!c) {
          const scheme = get(r, 'peppolScheme').replace(/:+$/, '');
          const pnum = get(r, 'peppolNumber');
          const street = [get(r, 'street'), get(r, 'houseNumber').replace(/,\s*$/, '')].filter(Boolean).join(' ');
          const billing = map.billingStreet && get(r, 'billingStreet') && get(r, 'billingStreet') !== get(r, 'street') ? `Adresse de facturation : ${get(r, 'billingStreet')}` : undefined;
          const de = pct(get(r, 'discountEquipment')); const dt = pct(get(r, 'discountTotal'));
          c = {
            id: uid(), createdAt: t, updatedAt: t, company, type: mapContactType(get(r, 'type')),
            firstName: get(r, 'firstName') || undefined, lastName: get(r, 'lastName') || undefined, email: get(r, 'email') || undefined,
            phone: phone(get(r, 'phone')), address: street || undefined, postalCode: get(r, 'postalCode') || undefined,
            city: get(r, 'city') || undefined, country: country(get(r, 'country')), vatNumber: get(r, 'vatNumber') || undefined,
            siret: get(r, 'siret') || undefined,
            peppolId: pnum ? (pnum.includes(':') ? pnum : `${scheme || '0208'}:${pnum.replace(/^BE/i, '')}`) : undefined,
            paymentDays: parseNumber(get(r, 'paymentDays')) || undefined,
            discounts: de || dt ? { equipment: de, total: dt } : undefined,
            tags: list(get(r, 'tags')), notes: joinLines(get(r, 'notes'), ...extra(r), billing),
          };
          fresh.add(c.id);
          created++;
        } else if (!fresh.has(c.id) && !touched.has(key)) existing++;
        touched.set(key, c);
        // personne de contact de la ligne, avec son service
        const pname = get(r, 'pName') || [get(r, 'pFirst'), get(r, 'pLast')].filter(Boolean).join(' ');
        if (pname && !(c.persons || []).some((p) => p.name.toLowerCase() === pname.toLowerCase())) {
          const deptName = get(r, 'pDept');
          let dept: Department | undefined;
          if (deptName) {
            dept = (c.departments || []).find((d) => d.name.toLowerCase() === deptName.toLowerCase());
            if (!dept) { dept = { id: uid(), name: deptName }; c.departments = [...(c.departments || []), dept]; }
          }
          const p: ContactPerson = { id: uid(), name: pname, role: get(r, 'pRole') || undefined, email: get(r, 'pEmail') || undefined, phone: phone(get(r, 'pPhone')), departmentId: dept?.id };
          c.persons = [...(c.persons || []), p];
          persons++;
        }
      }
      for (const c of touched.values()) await db.contacts.put({ ...c, updatedAt: t });
      return `${created} contact(s) importé(s)` + (persons ? `, ${persons} personne(s) de contact` : '') + (existing ? `, ${existing} contact(s) déjà présent(s) complété(s)` : '') + '.';
    }

    if (target === 'people') {
      // une ligne par tarif : on regroupe par nom
      const all = await db.people.toArray();
      const byName = new Map(all.map((p) => [p.name.toLowerCase(), p]));
      const touched = new Map<string, Person>();
      let created = 0; let existing = 0;
      for (const r of rows) {
        const name = get(r, 'name') || [get(r, 'firstName'), get(r, 'lastName')].filter(Boolean).join(' ');
        if (!name) continue;
        let p = touched.get(name.toLowerCase());
        if (!p) {
          if (byName.has(name.toLowerCase())) { existing++; continue; }
          const status = get(r, 'status');
          const group = get(r, 'group');
          const street = [get(r, 'street'), get(r, 'houseNumber')].filter(Boolean).join(' ');
          const address = [street, [get(r, 'postalCode'), get(r, 'city')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
          p = {
            id: uid(), createdAt: t, updatedAt: t, name, role: get(r, 'role') || undefined, email: get(r, 'email') || undefined,
            phone: phone(get(r, 'phone')), dailyRate: parseNumber(get(r, 'dailyRate')),
            external: /freelance|ind[ée]pendant|extern|int[ée]rim|intermittent/i.test(`${status} ${group}`),
            status: status || undefined, city: get(r, 'city') || undefined, vatNumber: get(r, 'vatNumber') || undefined,
            notes: joinLines(get(r, 'notes'), street ? `Adresse : ${address}` : undefined, ...extra(r)),
          };
          touched.set(name.toLowerCase(), p);
          created++;
        }
        const rateName = get(r, 'rateName');
        const hour = parseNumber(get(r, 'hourCost'));
        const fixed = parseNumber(get(r, 'fixedCost'));
        if (!hour && !fixed) continue;
        if (!rateName || /default|défaut|standard/i.test(rateName)) {
          if (hour) p.hourlyCost = hour;
          if (fixed) p.costRate = fixed;
        } else {
          const rate: PersonRate = { function: rateName, hourCost: hour || undefined, cost: fixed || undefined };
          p.rates = [...(p.rates || []).filter((x) => x.function !== rateName), rate];
        }
      }
      for (const p of touched.values()) await db.people.put(p);
      return `${created} membre(s) de l'équipe importé(s)` + (existing ? `, ${existing} déjà présent(s) ignoré(s)` : '') + '.';
    }

    // projets
    const contacts = await db.contacts.toArray();
    const byName = new Map(contacts.map((c) => [c.company.toLowerCase().trim(), c]));
    const numbers = new Set((await db.projects.toArray()).map((p) => p.number.toLowerCase()));
    const settings = await getSettings();
    const moments = [...settingsMoments(settings)];
    const types = [...(settings.projectTypes || [])];
    let settingsChanged = false;
    /** moment de facturation Rentman → moment(s) FabEvent, créés s'ils n'existent pas (« 50/50 » = acompte + solde) */
    const momentIds = (name: string): string[] | undefined => {
      if (!name) return undefined;
      const lower = name.toLowerCase();
      const own = moments.filter((m) => m.name.toLowerCase() === lower || m.name.toLowerCase().startsWith(lower + ' ('));
      if (own.length) return own.map((m) => m.id);
      const trig = (s: string): InvoiceMoment['trigger'] => (/avant/.test(s) ? 'avant' : /accord|confirm|commande/.test(s) ? 'accord' : 'fin');
      const split = /(\d+)\s*\/\s*(\d+)/.exec(lower);
      const made: InvoiceMoment[] = split
        ? [{ id: uid(), name: `${name} (${split[1]} % à l'accord)`, percent: +split[1], trigger: 'accord' }, { id: uid(), name: `${name} (${split[2]} % après le projet)`, percent: +split[2], trigger: 'fin' }]
        : [{ id: uid(), name, percent: Math.min(100, parseNumber(/(\d+)\s*%/.exec(lower)?.[1] || '100')), trigger: trig(lower) }];
      moments.push(...made);
      settingsChanged = true;
      return made.map((m) => m.id);
    };
    let created = 0; let existing = 0; let undated = 0;
    for (const r of rows) {
      const name = get(r, 'name');
      if (!name) continue;
      const number = get(r, 'number');
      if (number && numbers.has(number.toLowerCase())) { existing++; continue; }
      const clientName = get(r, 'client');
      let client = clientName ? byName.get(clientName.toLowerCase()) : undefined;
      if (clientName && !client) {
        client = { id: uid(), createdAt: t, updatedAt: t, company: clientName, type: 'client' };
        await db.contacts.put(client);
        byName.set(clientName.toLowerCase(), client);
      }
      const typeName = get(r, 'type');
      if (typeName && !types.some((x) => x.name.toLowerCase() === typeName.toLowerCase())) { types.push({ name: typeName, color: '#64748b' }); settingsChanged = true; }
      const cp = get(r, 'contactPerson');
      const person = cp ? client?.persons?.find((p) => p.name.toLowerCase() === cp.toLowerCase()) : undefined;
      const momentName = get(r, 'moment');
      const price = parseNumber(get(r, 'price'));
      const invoiced = parseNumber(get(r, 'invoiced'));
      if (!get(r, 'start')) undated++;
      const start = parseDate(get(r, 'start')) || parseDate(new Date().toISOString());
      const end = parseDate(get(r, 'end')) || start;
      const status = mapStatus(get(r, 'status'));
      const id = uid();
      await db.projects.put({
        id, createdAt: t, updatedAt: t, number: number || (await nextNumber('P')), name: name.trim(), clientId: client?.id,
        venue: get(r, 'venue') || undefined, status, start, end, discount: 0, typeName: typeName || undefined,
        contactPerson: cp || undefined, contactPersonId: person?.id, externalRef: get(r, 'externalRef') || undefined,
        moments: momentIds(momentName),
        externalInvoiced: price > 0 && invoiced >= price - 0.01 ? true : undefined,
        notes: joinLines(get(r, 'notes'), ...extra(r).map((l) => l.replace(/ : ([\d.]+)$/, (_, n) => ` : ${Math.round(parseFloat(n) * 100) / 100} €`)),
          get(r, 'status').includes('/') ? `Statuts des sous-projets : ${get(r, 'status')}` : undefined),
      });
      await db.subprojects.put({ id: uid(), createdAt: t, updatedAt: t, projectId: id, name: 'Principal', status, start, end, order: 0, venue: get(r, 'venue') || undefined });
      if (number) numbers.add(number.toLowerCase());
      created++;
    }
    if (settingsChanged) await db.settings.put({ ...(await getSettings()), projectTypes: types, invoiceMoments: moments });
    return `${created} projet(s) importé(s)` + (existing ? `, ${existing} déjà présent(s) ignoré(s)` : '')
      + (undated ? ` ; ${undated} sans dates : mis à aujourd'hui, à corriger (ou ajoute les colonnes de période dans l'export Rentman)` : '') + '.';
  };

  const groups = Array.from(new Set(FIELDS[target].map((f) => f.group || '')));
  const mapped = FIELDS[target].filter((f) => map[f.key]);
  const unused = cols.filter((c) => !Object.values(map).includes(c));

  return (
    <>
      <PageHead title="Import des données" />
      <div className="info">
        Dans Rentman, exporte chaque liste (Équipement, Contacts, Membres du personnel, Projets) en <strong>CSV</strong>, puis importe-les ici :
        le type d'export et les colonnes sont reconnus automatiquement, tu peux corriger la correspondance avant de valider.
        Importe les contacts avant les projets pour que les clients et leurs interlocuteurs soient reliés.
        Les lignes répétées sont regroupées : une ligne par numéro de série (matériel), par personne de contact (contacts) ou par tarif (équipe).
        Une fiche déjà présente (même code, même nom ou même numéro) n'est pas recréée.
      </div>
      <div className="card">
        <div className="form">
          <Field label="Que veux-tu importer ?">
            <select value={target} onChange={(e) => { const t = e.target.value as Target; setTarget(t); setMap(guessMap(t, cols)); }}>
              {Object.entries(TARGET_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Fichier CSV">
            <input type="file" accept=".csv,text/csv" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }} />
          </Field>
        </div>
        {detected && cols.length > 0 && <p className="muted">{detected}</p>}
        {result && <p className={'avail ' + (result.startsWith('Erreur') ? 'ko' : 'ok')}>{result}</p>}
      </div>

      {cols.length > 0 && (
        <div className="card">
          <h2>Correspondance des colonnes ({rows.length} lignes)</h2>
          <p className="muted">{mapped.length} champ(s) reliés à une colonne du fichier ; {unused.length} colonne(s) non utilisée(s).</p>
          {target === 'equipment' && map.path && (() => {
            const ex = rows.map((r) => (r[map.path] || '').trim()).find((v) => v.split('/').length > 2) || rows.find((r) => r[map.path])?.[map.path] || '';
            const segs = ex.split(/\s*[/>›]\s*/).filter(Boolean);
            const shown = skipRoot && segs.length > 1 ? segs.slice(1) : segs;
            return (
              <label className="check-row">
                <input type="checkbox" checked={skipRoot} onChange={(e) => setSkipRoot(e.target.checked)} />
                Ignorer le premier niveau du chemin (société, dossier racine)
                {ex && <span className="muted"> : « {ex.trim()} » → {shown[0]}{shown.length > 1 ? ` › ${shown.slice(1).join(' / ')}` : ''}</span>}
              </label>
            );
          })()}
          {groups.map((g) => (
            <div key={g}>
              {g && <h3 style={{ marginTop: 12 }}>{g}</h3>}
              <div className="form">
                {FIELDS[target].filter((f) => (f.group || '') === g).map((f) => (
                  <Field key={f.key} label={f.label}>
                    <select value={map[f.key] || ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}>
                      <option value="">— ignorer —</option>
                      {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                ))}
              </div>
            </div>
          ))}
          {unused.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary className="muted">Colonnes non utilisées ({unused.length})</summary>
              <p className="muted">{unused.join(' · ')}</p>
            </details>
          )}
          <h3 style={{ marginTop: 16 }}>Aperçu</h3>
          <div className="table-wrap">
            <table className="list">
              <thead><tr>{mapped.filter((f) => !f.group).map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>{mapped.filter((f) => !f.group).map((f) => <td key={f.key}>{r[map[f.key]]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions" style={{ display: 'flex', marginTop: 12 }}>
            <button onClick={run} disabled={busy || !map[FIELDS[target].find((f) => f.label.endsWith('*'))!.key]}>{busy ? 'Import en cours…' : `Importer ${rows.length} lignes`}</button>
          </div>
        </div>
      )}
    </>
  );
}
