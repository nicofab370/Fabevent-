/**
 * Remplissage automatique des fiches, à partir de sources publiques — jamais de données inventées :
 * - client par son n° de TVA : registre européen VIES (nom officiel et adresse), via api/lookup.php ;
 * - client ou lieu par son nom : OpenStreetMap (Nominatim), adresse et, si connus, téléphone et site ;
 * - équipement : un article semblable (même marque et modèle) déjà dans le catalogue, ou la fiche technique sur le web.
 */
import type { Contact, Equipment } from './types';
import { currentWorkspace } from './db';
import { serverScript } from './mailer';

/* ---------- n° de TVA (VIES) ---------- */

/** « be 0417.497.106 » → { country: 'BE', number: '0417497106' } */
export function splitVat(raw: string): { country: string; number: string } | null {
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const m = s.match(/^([A-Z]{2})([0-9A-Z]{2,12})$/);
  if (m) return { country: m[1] === 'GR' ? 'EL' : m[1], number: m[2] };
  // numéro belge sans préfixe (10 chiffres, ou 9 sans le 0 initial)
  if (/^\d{9,10}$/.test(s)) return { country: 'BE', number: s.padStart(10, '0') };
  return null;
}

export interface VatInfo { valid: boolean; name?: string; address?: string; postalCode?: string; city?: string; country: string; vatNumber: string }

/**
 * Adresse VIES (texte libre, une ou plusieurs lignes) → rue, code postal, ville.
 * Format courant : « Rue de la Loi 16\n1000 Bruxelles » (BE, FR, NL, LU…).
 */
export function parseViesAddress(text: string): { address?: string; postalCode?: string; city?: string } {
  const lines = text.split(/\r?\n|,\s*(?=[A-Z]{0,2}-?\d{4,5}\s)/).map((l) => l.trim()).filter(Boolean);
  const i = lines.findIndex((l) => /^(?:[A-Z]{1,2}-)?\d{4,5}\s+\S/.test(l));
  if (i < 0) return { address: lines.join(', ') || undefined };
  const m = lines[i].match(/^(?:[A-Z]{1,2}-)?(\d{4,5})\s+(.+)$/)!;
  return { address: lines.slice(0, i).join(', ') || undefined, postalCode: m[1], city: titleCase(m[2]) };
}
const titleCase = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) : s);

/** Interroge VIES (par le serveur FabEvent : le registre n'accepte pas les appels directs depuis un navigateur). */
export async function lookupVat(raw: string): Promise<VatInfo> {
  const v = splitVat(raw);
  if (!v) throw new Error('N° de TVA incomplet (ex. BE0417497106).');
  const url = serverScript('lookup.php');
  if (!url) throw new Error('La recherche par n° de TVA passe par le serveur FabEvent (non configuré sur cet appareil).');
  let r: Response;
  try { r = await fetch(`${url}?vat=${v.country}${v.number}&ws=${encodeURIComponent(currentWorkspace())}`, { credentials: 'include', cache: 'no-store' }); }
  catch { throw new Error('Serveur injoignable (hors ligne ?).'); }
  const j = await r.json().catch(() => ({} as Record<string, unknown>));
  if (!r.ok) throw new Error(String(j.detail || (r.status === 401 ? 'Connecte-toi pour utiliser la recherche.' : 'Registre TVA européen (VIES) indisponible pour l’instant.')));
  const name = clean(String(j.name || ''));
  return { valid: !!j.valid, name: name ? titleCase(name) : undefined, ...parseViesAddress(clean(String(j.address || ''))), country: v.country === 'EL' ? 'GR' : v.country, vatNumber: `${v.country}${v.number}` };
}
const clean = (s: string) => (s.trim() === '---' ? '' : s.trim());

/** Champs du contact remplis depuis VIES : nom seulement s'il est vide ; adresse officielle ; Peppol belge (0208:n° BCE). */
export function applyVat<T extends Partial<Contact>>(c: T, v: VatInfo): T {
  return {
    ...c,
    company: c.company?.trim() ? c.company : v.name || c.company,
    address: v.address || c.address, postalCode: v.postalCode || c.postalCode, city: v.city || c.city,
    country: v.country, vatNumber: v.vatNumber,
    peppolId: c.peppolId || (v.country === 'BE' ? `0208:${v.vatNumber.slice(2)}` : c.peppolId),
  };
}

/* ---------- recherche d'un lieu ou d'une société sur la carte (OpenStreetMap) ---------- */

export interface Place { label: string; name?: string; address?: string; postalCode?: string; city?: string; country?: string; phone?: string; website?: string }

interface NominatimHit {
  display_name: string; name?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
}

/** Résultat Nominatim → champs d'une fiche. */
export function placeFromNominatim(h: NominatimHit): Place {
  const a = h.address || {};
  const street = [a.road || a.pedestrian || a.square || a.footway, a.house_number].filter(Boolean).join(' ');
  return {
    label: h.display_name,
    name: h.name || undefined,
    address: street || undefined,
    postalCode: a.postcode,
    city: a.city || a.town || a.village || a.municipality,
    country: a.country_code?.toUpperCase(),
    phone: h.extratags?.phone || h.extratags?.['contact:phone'],
    website: h.extratags?.website || h.extratags?.['contact:website'],
  };
}

export async function searchPlaces(q: string): Promise<Place[]> {
  if (!q.trim()) return [];
  if (!navigator.onLine) throw new Error('Pas de connexion internet.');
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&extratags=1&limit=6&q=${encodeURIComponent(q)}`, { headers: { 'Accept-Language': 'fr' } });
  if (!r.ok) throw new Error('Service de cartographie indisponible.');
  return ((await r.json()) as NominatimHit[]).map(placeFromNominatim);
}

/** Champs du contact remplis depuis un lieu trouvé (nom seulement s'il est vide). */
export function applyPlace<T extends Partial<Contact>>(c: T, p: Place): T {
  return {
    ...c,
    company: c.company?.trim() ? c.company : p.name || c.company,
    address: p.address || c.address, postalCode: p.postalCode || c.postalCode, city: p.city || c.city,
    country: p.country || c.country, phone: c.phone || p.phone,
  };
}

/* ---------- équipement ---------- */

const key = (s?: string) => (s || '').trim().toLowerCase().replace(/[\s_-]+/g, '');

/** Articles du catalogue de même marque et modèle (sinon même désignation), du plus complet au moins complet. */
export function similarEquipment(e: Partial<Equipment>, all: Equipment[]): Equipment[] {
  const m = key(e.model), b = key(e.brand);
  /** même modèle (et même marque si les deux sont connues) */
  const sameModel = (x: Equipment) => key(x.model) === m && (!b || !key(x.brand) || key(x.brand) === b);
  /** ancien article sans marque ni modèle séparés : le modèle est un mot de sa désignation, la marque y figure */
  const inName = (x: Equipment) => x.name.split(/[\s()/,;]+/).some((w) => key(w) === m) && (!b || key(x.name).includes(b));
  const same = (x: Equipment) => x.id !== e.id && (m ? (key(x.model) ? sameModel(x) : inName(x)) : !!key(e.name) && key(x.name) === key(e.name));
  const score = (x: Equipment) => FILLABLE.filter((k) => x[k] != null && x[k] !== '').length;
  return all.filter(same).sort((a, b) => score(b) - score(a));
}

/** Infos techniques reprises d'un article semblable — seulement pour les champs encore vides. */
const FILLABLE = ['brand', 'summary', 'weight', 'dims', 'power', 'replacementValue', 'dailyPrice', 'costPrice', 'inspectionMonths', 'categoryId', 'photo', 'notes'] as const;
export function fillFromSimilar<T extends Partial<Equipment>>(e: T, src: Equipment): { value: T; filled: string[] } {
  const out: Partial<Equipment> = { ...e };
  const filled: string[] = [];
  for (const k of FILLABLE) {
    const cur = out[k] as unknown;
    if ((cur == null || cur === '' || cur === 0) && src[k] != null && src[k] !== '' && src[k] !== 0) { (out as Record<string, unknown>)[k] = src[k]; filled.push(k); }
  }
  if (!out.contents?.length && src.contents?.length) { out.contents = src.contents.map((c) => ({ ...c })); filled.push('contents'); }
  return { value: out as T, filled };
}

/* ---------- fiche technique sur internet (par le serveur FabEvent : api/lookup.php?spec=…) ---------- */

export interface SpecHit {
  source: string; url: string; title?: string;
  weight?: number; dims?: { l: number; w: number; h: number }; power?: number;
  price?: { amount: number; currency: string }; images?: string[];
}

/** Ce que l'on cherche : marque + modèle (sinon la désignation). */
export const specQuery = (e: Partial<Equipment>) => [e.brand, e.model || (e.brand ? '' : e.name)].filter(Boolean).join(' ').trim() || (e.name || '').trim();

export async function searchSpecs(q: string): Promise<{ results: SpecHit[]; searched: number }> {
  const url = serverScript('lookup.php');
  if (!url) throw new Error('La recherche sur internet passe par le serveur FabEvent (non configuré sur cet appareil).');
  if (!navigator.onLine) throw new Error('Pas de connexion internet.');
  let r: Response;
  try { r = await fetch(`${url}?spec=${encodeURIComponent(q)}&ws=${encodeURIComponent(currentWorkspace())}`, { credentials: 'include', cache: 'no-store' }); }
  catch { throw new Error('Serveur injoignable (hors ligne ?).'); }
  const j = await r.json().catch(() => ({} as Record<string, unknown>));
  if (!r.ok) throw new Error(String(j.detail || (r.status === 401 ? 'Connecte-toi pour utiliser la recherche.' : 'Recherche indisponible pour l’instant.')));
  return { results: (j.results as SpecHit[]) || [], searched: Number(j.searched) || 0 };
}

/** Adresse d'une image trouvée, relayée par le serveur (lisible par le navigateur pour la réduire). */
export const specImageUrl = (img: string) => `${serverScript('lookup.php')}?img=${encodeURIComponent(img)}&ws=${encodeURIComponent(currentWorkspace())}`;

export type SpecField = 'weight' | 'dims' | 'power' | 'replacementValue' | 'photo';
export interface SpecChoice { field: SpecField; value: number | { l: number; w: number; h: number } | string; label: string; sources: { source: string; url: string }[] }

const fmt = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
export const dimsLabel = (d: { l: number; w: number; h: number }) => `${fmt(d.l)} × ${fmt(d.w)} × ${fmt(d.h)} cm`;
/** volume en litres (dm³) */
export const volumeL = (d?: { l: number; w: number; h: number }) => (d ? (d.l * d.w * d.h) / 1000 : 0);

/**
 * Propositions par champ, regroupées quand plusieurs pages donnent la même valeur (la plus citée en premier).
 * Prix neuf : seulement les prix en euros (les autres monnaies ne sont pas converties).
 */
export function specChoices(hits: SpecHit[]): Record<SpecField, SpecChoice[]> {
  const out: Record<SpecField, SpecChoice[]> = { weight: [], dims: [], power: [], replacementValue: [], photo: [] };
  const add = (field: SpecField, value: SpecChoice['value'], label: string, h: SpecHit) => {
    const k = JSON.stringify(value);
    const cur = out[field].find((c) => JSON.stringify(c.value) === k);
    const src = { source: h.source, url: h.url };
    if (cur) { if (!cur.sources.some((s) => s.url === h.url)) cur.sources.push(src); } else out[field].push({ field, value, label, sources: [src] });
  };
  for (const h of hits) {
    if (h.weight) add('weight', h.weight, `${fmt(h.weight)} kg`, h);
    if (h.dims) add('dims', h.dims, `${dimsLabel(h.dims)} (${fmt(volumeL(h.dims))} L)`, h);
    if (h.power) add('power', h.power, `${fmt(h.power)} W`, h);
    if (h.price && h.price.currency === 'EUR') add('replacementValue', h.price.amount, `${fmt(h.price.amount)} €`, h);
    for (const im of h.images || []) add('photo', im, h.title || h.source, h);
  }
  for (const f of Object.keys(out) as SpecField[]) if (f !== 'photo') out[f].sort((a, b) => b.sources.length - a.sources.length);
  out.photo = out.photo.slice(0, 8);
  return out;
}

/** Recherche web de la fiche technique (poids, dimensions, consommation), dans un nouvel onglet. */
export const specSearchUrl = (e: Partial<Equipment>) =>
  `https://www.google.com/search?q=${encodeURIComponent([e.brand, e.model || e.name, 'poids fiche technique datasheet'].filter(Boolean).join(' '))}`;
