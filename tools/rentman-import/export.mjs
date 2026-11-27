#!/usr/bin/env node
/**
 * Export Rentman → fichier d'import FabEvent.
 *
 *   RENTMAN_TOKEN=… node tools/rentman-import/export.mjs [fichier.json]
 *
 * Avec les fichiers (documents des projets et de l'équipe, photos du matériel), écrits à part dans
 * « <fichier>-fichiers-1.json », « -2 »… (paquets d'environ 40 Mo) : à importer avec le fichier principal.
 * RENTMAN_FILES=0 pour ne pas les télécharger ; RENTMAN_FILE_MAX_MB (25 par défaut) : taille maximale d'un fichier.
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
const WITH_FILES = !/^(0|false|non|no)$/i.test(process.env.RENTMAN_FILES || '1');
const FILE_MAX = (Number(process.env.RENTMAN_FILE_MAX_MB) || 25) * 1024 * 1024;
const CHUNK = 40 * 1024 * 1024;

if (!TOKEN) {
  console.error('Clé API Rentman manquante : définis la variable RENTMAN_TOKEN (Rentman → Configuration → Extensions → API).');
  process.exit(1);
}

/** Collections lues (nom de la collection → chemin de l'API, ou plusieurs chemins essayés dans l'ordre). */
const COLLECTIONS = {
  statuses: '/statuses',
  contacts: '/contacts',
  contactpersons: '/contactpersons',
  folders: '/folders',
  equipment: '/equipment',
  equipmentsetscontent: '/equipmentsetscontent',
  serialnumbers: '/serialnumbers',
  stockmovements: '/stockmovements',
  crewmembers: ['/crew', '/crewmembers'],
  vehicles: '/vehicles',
  accessories: '/accessories',
  projecttypes: '/projecttypes',
  stocklocations: '/stocklocations',
  projects: '/projects',
  subprojects: '/subprojects',
  projectequipmentgroup: '/projectequipmentgroup',
  projectequipment: '/projectequipment',
  projectfunctiongroups: '/projectfunctiongroups',
  projectfunctions: '/projectfunctions',
  projectcrew: '/projectcrew',
  projectvehicles: '/projectvehicles',
  costs: '/costs',
  subrentals: '/subrentals',
  subrentalequipment: '/subrentalequipment',
  repairs: '/repairs',
  crewavailability: ['/crewavailability', '/crewavailabilities'],
  appointments: '/appointments',
  appointmentcrew: '/appointmentcrew',
  quotes: '/quotes',
  invoices: '/invoices',
  files: '/files',
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
for (const [name, paths] of Object.entries(COLLECTIONS)) {
  try {
    let res;
    const tried = [];
    for (const path of [paths].flat()) { res = await all(path); if (!res.skipped) break; tried.push(`${path} (${res.skipped})`); }
    rm[name] = res.rows;
    if (res.skipped) {
      // 404 sur une adresse de repli : on ne garde que les refus utiles (403 = droits de la clé)
      const why = tried.filter((t) => !t.endsWith('(404)')).join(', ') || tried.join(', ');
      skipped.push(why);
      console.log(`  ${why} : non accessible, ignoré`);
    }
  } catch (e) {
    console.error(`\n${e.message}`);
    process.exit(1);
  }
}

/* diagnostic (noms de champs seulement, aucune donnée) : quels champs de quantité Rentman renvoie, et combien ne sont pas à 0 */
for (const [name, list] of [['equipment', rm.equipment], ['projectequipment', rm.projectequipment]]) {
  const seen = {};
  for (const row of list || []) for (const [k, v] of Object.entries(row)) if (/quant|stock|amount/i.test(k) && (typeof v === 'number' || /^-?\d+([.,]\d+)?$/.test(String(v)))) {
    seen[k] ??= [0, 0]; seen[k][0]++; if (Number(String(v).replace(',', '.')) !== 0) seen[k][1]++;
  }
  const txt = Object.entries(seen).map(([k, [n, nz]]) => `${k} (${nz}/${n} non nuls)`).join(', ');
  console.log(`Champs de quantité de /${name} : ${txt || 'aucun'}`);
}

const { data, files, report } = mapRentman(rm);
const exportedAt = new Date().toISOString();

/* ---------- fichiers : téléchargés un par un, écrits par paquets ---------- */
const parts = [];
if (WITH_FILES && files.length) {
  console.log(`\nTéléchargement de ${files.length} fichier(s)…`);
  const apiHost = new URL(API).host;
  let chunk = [], size = 0, ok = 0, tooBig = 0, failed = 0;
  const flush = () => {
    if (!chunk.length) return;
    const name = OUT.replace(/\.json$/i, '') + `-fichiers-${parts.length + 1}.json`;
    writeFileSync(name, JSON.stringify({ app: 'fabevent', kind: 'import', source: 'rentman', part: 'fichiers', version: 1, exportedAt, data: { files: chunk } }));
    parts.push(name); chunk = []; size = 0;
  };
  for (const f of files) {
    if (!f.url) { failed++; continue; }
    if (f.size > FILE_MAX) { tooBig++; continue; }
    try {
      const url = new URL(f.url, API);
      // lien signé : sans la clé ; lien de l'API : avec la clé (jamais envoyée à un autre site)
      let r = await fetch(url);
      if ((r.status === 401 || r.status === 403) && url.host === apiHost) r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
      if (!r.ok) { failed++; continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > FILE_MAX) { tooBig++; continue; }
      const { url: _u, fileId, ...meta } = f;
      chunk.push({ ...meta, id: `rm-file-${fileId}`, type: r.headers.get('content-type')?.split(';')[0] || meta.type, size: buf.length, base64: buf.toString('base64') });
      size += buf.length; ok++;
      process.stdout.write(`\r  ${ok} / ${files.length}`);
      if (size > CHUNK) flush();
    } catch { failed++; }
  }
  flush();
  process.stdout.write('\n');
  if (tooBig) report.warnings.push(`${tooBig} fichier(s) de plus de ${FILE_MAX / 1024 / 1024} Mo non repris (RENTMAN_FILE_MAX_MB pour changer la limite)`);
  if (failed) report.warnings.push(`${failed} fichier(s) n'ont pas pu être téléchargés`);
  report.counts.fichiersTelecharges = ok;
} else if (files.length) report.warnings.push(`${files.length} fichier(s) Rentman non téléchargés (RENTMAN_FILES=0)`);

const file = { app: 'fabevent', kind: 'import', source: 'rentman', version: 1, exportedAt, report: { ...report, skipped }, data, parts: parts.length };
writeFileSync(OUT, JSON.stringify(file));
console.log(`\nFichier écrit : ${OUT}`);
for (const p of parts) console.log(`Fichiers joints : ${p}`);
for (const [k, n] of Object.entries(report.counts)) console.log(`  ${k.padEnd(20)} ${n}`);
if (skipped.length) console.log(`Collections non accessibles avec cette clé : ${skipped.join(', ')}`);
if (skipped.some((x) => /crew.*\(403\)/.test(x))) console.log(
  "\nL'équipe est refusée à cette clé (403) : dans Rentman, la clé API a les droits de l'utilisateur qui l'a créée.\n"
  + "Crée la clé avec un compte administrateur (ou donne à ce compte le droit de voir le personnel), puis relance l'export.\n"
  + 'En attendant, les techniciens des postes sont repris avec leur nom seulement (sans coordonnées).');
for (const w of report.warnings) console.log(`  ! ${w}`);
console.log(`\nDans FabEvent : Paramètres → « Importer depuis Rentman » → choisir ${parts.length ? 'ces fichiers ensemble' : 'ce fichier'}.`);
