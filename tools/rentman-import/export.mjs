#!/usr/bin/env node
/**
 * Export Rentman → fichier d'import FabEvent.
 *
 *   RENTMAN_TOKEN=… node tools/rentman-import/export.mjs [fichier.json]
 *
 * Lit toutes les collections utiles de l'API Rentman (lecture seule : rien n'est modifié dans Rentman),
 * les convertit (map.mjs) et écrit un fichier à importer dans FabEvent : Paramètres → « Importer depuis Rentman ».
 * La clé n'est jamais écrite dans le fichier ni affichée.
 * Node 18 ou plus récent (fetch intégré), aucune dépendance.
 */
import { writeFileSync } from 'node:fs';
import { mapRentman } from './map.mjs';

const API = (process.env.RENTMAN_API || 'https://api.rentman.net').replace(/\/$/, '');
const TOKEN = (process.env.RENTMAN_TOKEN || '').trim();
const OUT = process.argv[2] || `fabevent-import-rentman-${new Date().toISOString().slice(0, 10)}.json`;
const PAGE = 300;

if (!TOKEN) {
  console.error('Clé API Rentman manquante : définis la variable RENTMAN_TOKEN (Rentman → Configuration → Extensions → API).');
  process.exit(1);
}

/** Collections lues (nom FabEvent de la collection → chemin de l'API). */
const COLLECTIONS = {
  statuses: '/statuses',
  contacts: '/contacts',
  contactpersons: '/contactpersons',
  folders: '/folders',
  equipment: '/equipment',
  equipmentsetscontent: '/equipmentsetscontent',
  serialnumbers: '/serialnumbers',
  crewmembers: '/crewmembers',
  vehicles: '/vehicles',
  projects: '/projects',
  subprojects: '/subprojects',
  projectequipmentgroup: '/projectequipmentgroup',
  projectequipment: '/projectequipment',
  projectfunctions: '/projectfunctions',
  projectcrew: '/projectcrew',
  projectvehicles: '/projectvehicles',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, attempt = 0) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' } });
  if (r.status === 429 && attempt < 6) { await sleep(1500 * (attempt + 1)); return get(url, attempt + 1); } // trop d'appels : on patiente
  if (r.status >= 500 && attempt < 3) { await sleep(2000); return get(url, attempt + 1); }
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* réponse non JSON */ }
  return { status: r.status, json };
}

/** Toutes les pages d'une collection. */
async function all(path) {
  const out = [];
  for (let offset = 0; offset < 1_000_000; offset += PAGE) {
    const { status, json } = await get(`${API}${path}?limit=${PAGE}&offset=${offset}`);
    if (status === 401) throw new Error('Clé API refusée par Rentman (401) : vérifie RENTMAN_TOKEN.');
    if (status === 403 || status === 404) return { rows: out, skipped: `${status}` };
    if (status !== 200 || !json) throw new Error(`Rentman ${path} : erreur ${status}`);
    const rows = Array.isArray(json.data) ? json.data : [];
    out.push(...rows);
    process.stdout.write(`\r  ${path} : ${out.length}`);
    if (rows.length < PAGE) break;
    await sleep(120); // reste sous la limite d'appels de l'API
  }
  process.stdout.write('\n');
  return { rows: out };
}

const rm = {};
const skipped = [];
console.log(`Lecture de Rentman (${API})…`);
for (const [name, path] of Object.entries(COLLECTIONS)) {
  try {
    const { rows, skipped: why } = await all(path);
    rm[name] = rows;
    if (why) { skipped.push(`${path} (${why})`); console.log(`  ${path} : non accessible (${why}), ignoré`); }
  } catch (e) {
    console.error(`\n${e.message}`);
    process.exit(1);
  }
}

const { data, report } = mapRentman(rm);
const file = { app: 'fabevent', kind: 'import', source: 'rentman', version: 1, exportedAt: new Date().toISOString(), report: { ...report, skipped }, data };
writeFileSync(OUT, JSON.stringify(file));
console.log(`\nFichier écrit : ${OUT}`);
for (const [k, n] of Object.entries(report.counts)) console.log(`  ${k.padEnd(20)} ${n}`);
if (skipped.length) console.log(`Collections non accessibles avec cette clé : ${skipped.join(', ')}`);
for (const w of report.warnings) console.log(`  ! ${w}`);
console.log('\nDans FabEvent : Paramètres → « Importer depuis Rentman » → choisir ce fichier.');
