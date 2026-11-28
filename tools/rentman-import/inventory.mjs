#!/usr/bin/env node
/**
 * Inventaire des fonctions Rentman réellement utilisées (lecture seule).
 *
 *   RENTMAN_TOKEN=… node tools/rentman-import/inventory.mjs [rapport.txt]
 *
 * Pour chaque collection de l'API : nombre de fiches, puis chaque champ avec le nombre de fiches où il est rempli
 * (ni vide, ni 0, ni « false »). Aucune valeur n'est écrite ni affichée : seulement des noms de champs et des nombres.
 * Sert à repérer les petites fonctions de Rentman utilisées dans le compte et à comparer avec FabEvent.
 */
import { writeFileSync } from 'node:fs';

const API = (process.env.RENTMAN_API || 'https://api.rentman.net').replace(/\/$/, '');
const TOKEN = (process.env.RENTMAN_TOKEN || '').trim();
const OUT = process.argv[2] || 'rentman-inventaire.txt';
const PAGE = 300;
if (!TOKEN) { console.error('Clé API Rentman manquante (RENTMAN_TOKEN).'); process.exit(1); }

/** Toutes les collections connues de l'API Rentman (une adresse inconnue répond 404 et est simplement notée). */
const PATHS = [
  'accessories', 'appointmentcrew', 'appointments', 'contactpersons', 'contacts', 'contracts', 'costs', 'crew', 'crewavailability',
  'crewrates', 'crewrates_factors', 'equipment', 'equipmentsetscontent', 'factorgroups', 'factors', 'files', 'folders', 'invoicelines',
  'invoices', 'invoicemoments', 'knowledgebasearticles', 'leavemutation', 'leaverequest', 'leavetypes', 'ledgercodes', 'paymentterms',
  'projectcrew', 'projectequipment', 'projectequipmentgroup', 'projectfunctiongroups', 'projectfunctions', 'projectrequestequipment',
  'projectrequests', 'projects', 'projecttypes', 'projectvehicles', 'quotes', 'quotelines', 'ratefactors', 'repairs', 'serialnumbers',
  'statuses', 'stocklocations', 'stockmovements', 'subprojects', 'subrentalequipment', 'subrentalequipmentgroup', 'subrentals',
  'taxclasses', 'timeregistration', 'timeregistrationactivities', 'vehicles', 'warehouses', 'tags', 'customfields', 'crewskills',
  'skills', 'qualifications', 'availability', 'paymentmethods', 'invoicepayments', 'payments', 'transports', 'checklists',
  'projectchecklists', 'tasks', 'notes', 'emails', 'documents', 'documenttemplates', 'currencies', 'languages', 'users', 'roles',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, attempt = 0) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } });
  if (r.status === 429 && attempt < 6) { await sleep(1500 * (attempt + 1)); return get(url, attempt + 1); }
  if (r.status >= 500 && attempt < 3) { await sleep(2000); return get(url, attempt + 1); }
  let json = null;
  try { json = JSON.parse(await r.text()); } catch { /* non JSON */ }
  return { status: r.status, json };
}

const filled = (v) => !(v == null || v === '' || v === 0 || v === '0' || v === false || (Array.isArray(v) && !v.length)
  || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length));

/** champs d'une fiche, un niveau d'objet imbriqué déplié (custom.custom_3, …) */
function fields(row, prefix = '', out = []) {
  for (const [k, v] of Object.entries(row)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && !prefix) fields(v, `${k}.`, out);
    else out.push([prefix + k, v]);
  }
  return out;
}

const lines = [`Inventaire Rentman — ${new Date().toISOString()}`, 'Format : champ (fiches où il est rempli / total). Aucune valeur n\'est reprise.', ''];
const absent = [], refused = [];
for (const p of PATHS) {
  const rows = [];
  let status = 200;
  for (let offset = 0; offset < 2_000_000; offset += PAGE) {
    const res = await get(`${API}/${p}?limit=${PAGE}&offset=${offset}`);
    status = res.status;
    if (status === 401) { console.error('Clé API refusée (401).'); process.exit(1); }
    if (status !== 200 || !res.json) break;
    const page = Array.isArray(res.json.data) ? res.json.data : [];
    rows.push(...page);
    if (page.length < PAGE) break;
    await sleep(120);
  }
  if (status === 404 || status === 405) { absent.push(p); continue; }
  if (status !== 200) { refused.push(`${p} (${status})`); continue; }
  const stats = new Map();
  for (const r of rows) for (const [k, v] of fields(r)) {
    const s = stats.get(k) || { n: 0, t: new Set() };
    if (filled(v)) s.n++;
    s.t.add(Array.isArray(v) ? 'liste' : v === null ? 'null' : typeof v);
    stats.set(k, s);
  }
  const used = [...stats].filter(([, s]) => s.n).sort((a, b) => b[1].n - a[1].n);
  const unused = [...stats].filter(([, s]) => !s.n).map(([k]) => k);
  lines.push(`== /${p} : ${rows.length} fiche(s)`);
  if (used.length) lines.push('  remplis : ' + used.map(([k, s]) => `${k} (${s.n}/${rows.length})`).join(', '));
  if (unused.length) lines.push('  toujours vides : ' + unused.join(', '));
  lines.push('');
  console.log(`/${p} : ${rows.length}`);
  await sleep(120);
}
lines.push(`Refusées à cette clé : ${refused.join(', ') || 'aucune'}`);
lines.push(`Inexistantes dans l'API : ${absent.join(', ') || 'aucune'}`);
writeFileSync(OUT, lines.join('\n') + '\n');
console.log('\n' + lines.join('\n'));
