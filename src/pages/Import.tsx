import Papa from 'papaparse';
import { useState } from 'react';
import { nextUnitCode, suggestCategoryLetter } from '../codegen';
import { Field, PageHead } from '../components/ui';
import { db, nextNumber } from '../db';
import type { ContactType, Equipment, ProjectStatus } from '../types';
import { nowIso, parseDate, parseNumber, uid } from '../utils';

type Target = 'equipment' | 'contacts' | 'people' | 'projects';

/** Champs cibles + noms de colonnes probables (exports Rentman FR/EN). */
const FIELDS: Record<Target, { key: string; label: string; guess: string[] }[]> = {
  equipment: [
    { key: 'name', label: 'Désignation *', guess: ['nom', 'name', 'désignation', 'designation', 'displayname', 'article'] },
    { key: 'code', label: 'Référence', guess: ['code', 'référence', 'reference', 'ref', 'numéro', 'number'] },
    { key: 'category', label: 'Catégorie', guess: ['catégorie', 'categorie', 'category', 'dossier', 'folder', 'groupe'] },
    { key: 'quantity', label: 'Quantité', guess: ['quantité', 'quantite', 'quantity', 'stock', 'qté', 'qty', 'nombre'] },
    { key: 'dailyPrice', label: 'Prix / jour', guess: ['prix', 'price', 'tarif', 'prix de location', 'rental price', 'prix/jour'] },
    { key: 'replacementValue', label: 'Valeur de remplacement', guess: ['valeur', 'replacement', 'valeur de remplacement', 'new price', 'prix achat'] },
    { key: 'weight', label: 'Poids', guess: ['poids', 'weight'] },
    { key: 'serial', label: 'Numéro de série (une ligne par unité)', guess: ['numéro de série', 'numero de serie', 'n° de série', 'serial', 'serial number', 'serienummer', 'sn', 's/n'] },
    { key: 'barcode', label: 'Code-barres', guess: ['code-barres', 'barcode', 'code barre', 'qr'] },
    { key: 'notes', label: 'Notes', guess: ['notes', 'remarque', 'description', 'memo'] },
  ],
  contacts: [
    { key: 'company', label: 'Société / Nom *', guess: ['société', 'societe', 'company', 'nom', 'name', 'displayname', 'entreprise'] },
    { key: 'firstName', label: 'Prénom', guess: ['prénom', 'prenom', 'first name', 'firstname'] },
    { key: 'lastName', label: 'Nom de famille', guess: ['nom de famille', 'last name', 'lastname', 'surname'] },
    { key: 'email', label: 'Email', guess: ['email', 'e-mail', 'mail'] },
    { key: 'phone', label: 'Téléphone', guess: ['téléphone', 'telephone', 'phone', 'tél', 'tel', 'mobile'] },
    { key: 'address', label: 'Adresse', guess: ['adresse', 'address', 'rue', 'street', 'visit address'] },
    { key: 'postalCode', label: 'Code postal', guess: ['code postal', 'postal', 'zip', 'cp', 'postalcode'] },
    { key: 'city', label: 'Ville', guess: ['ville', 'city', 'localité'] },
    { key: 'country', label: 'Pays', guess: ['pays', 'country'] },
    { key: 'vatNumber', label: 'N° TVA', guess: ['tva', 'vat', 'n° tva', 'vat number'] },
    { key: 'type', label: 'Type (client/fournisseur…)', guess: ['type', 'catégorie', 'category'] },
  ],
  people: [
    { key: 'name', label: 'Nom *', guess: ['nom', 'name', 'displayname', 'nom complet'] },
    { key: 'role', label: 'Fonction', guess: ['fonction', 'function', 'role', 'poste'] },
    { key: 'email', label: 'Email', guess: ['email', 'e-mail', 'mail'] },
    { key: 'phone', label: 'Téléphone', guess: ['téléphone', 'telephone', 'phone', 'mobile'] },
    { key: 'dailyRate', label: 'Tarif / jour', guess: ['tarif', 'rate', 'prix', 'taux'] },
  ],
  projects: [
    { key: 'number', label: 'Numéro', guess: ['numéro', 'number', 'n°', 'reference', 'référence'] },
    { key: 'name', label: 'Nom du projet *', guess: ['nom', 'name', 'projet', 'project', 'displayname'] },
    { key: 'client', label: 'Client (nom société)', guess: ['client', 'customer', 'contact', 'société'] },
    { key: 'venue', label: 'Lieu', guess: ['lieu', 'location', 'venue', 'adresse'] },
    { key: 'start', label: 'Début', guess: ['début', 'debut', 'start', 'date de début', 'usage start', 'planperiod start'] },
    { key: 'end', label: 'Fin', guess: ['fin', 'end', 'date de fin', 'usage end', 'planperiod end'] },
    { key: 'status', label: 'Statut', guess: ['statut', 'status', 'état'] },
  ],
};

const TARGET_LABELS: Record<Target, string> = { equipment: 'Matériel', contacts: 'Contacts', people: 'Équipe', projects: 'Projets' };

function guessMap(target: Target, cols: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const norm = (s: string) => s.toLowerCase().trim();
  for (const f of FIELDS[target]) {
    const exact = cols.find((c) => f.guess.includes(norm(c)));
    const partial = cols.find((c) => f.guess.some((g) => norm(c).includes(g)));
    const hit = exact || partial;
    if (hit && !Object.values(out).includes(hit)) out[f.key] = hit;
  }
  return out;
}

function mapStatus(v: string): ProjectStatus {
  const s = v.toLowerCase();
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
  if (/lieu|location|venue/.test(s)) return 'lieu';
  return 'client';
}

export default function ImportPage() {
  const [target, setTarget] = useState<Target>('equipment');
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [cols, setCols] = useState<string[]>([]);
  const [map, setMap] = useState<Record<string, string>>({});
  const [result, setResult] = useState('');

  const onFile = (file: File) => {
    setResult('');
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (r) => {
        const c = r.meta.fields || [];
        setCols(c);
        setRows(r.data);
        setMap(guessMap(target, c));
      },
    });
  };

  const run = async () => {
    const get = (row: Record<string, string>, k: string) => (map[k] ? (row[map[k]] ?? '').toString().trim() : '');
    const t = nowIso();
    let n = 0;
    if (target === 'equipment') {
      const cats = await db.categories.toArray();
      const catByName = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
      // articles déjà connus (base ou lignes précédentes du fichier), retrouvés par référence ou par nom
      const known = await db.equipment.toArray();
      const byCode = new Map(known.filter((e) => e.code).map((e) => [e.code!.toLowerCase(), e]));
      const byName = new Map(known.map((e) => [e.name.toLowerCase(), e]));
      const units = await db.units.toArray();
      let created = 0; let added = 0; let skipped = 0;
      for (const r of rows) {
        const name = get(r, 'name');
        const code = get(r, 'code');
        const serial = get(r, 'serial');
        if (!name && !(serial && code)) continue;
        let e: Equipment | undefined = serial ? (code ? byCode.get(code.toLowerCase()) : undefined) ?? (name ? byName.get(name.toLowerCase()) : undefined) : undefined;
        if (!e) {
          const catName = get(r, 'category');
          let categoryId: string | undefined;
          if (catName) {
            categoryId = catByName.get(catName.toLowerCase());
            if (!categoryId) {
              categoryId = uid();
              await db.categories.put({ id: categoryId, name: catName, letter: suggestCategoryLetter(catName, (await db.categories.toArray()).map((c) => c.letter || '')), createdAt: t, updatedAt: t });
              catByName.set(catName.toLowerCase(), categoryId);
            }
          }
          e = {
            id: uid(), createdAt: t, updatedAt: t, name: name || code, code: code || undefined, categoryId,
            quantity: serial ? 0 : map.quantity ? parseNumber(get(r, 'quantity')) : 1, dailyPrice: parseNumber(get(r, 'dailyPrice')),
            replacementValue: parseNumber(get(r, 'replacementValue')) || undefined, weight: parseNumber(get(r, 'weight')) || undefined,
            barcode: serial ? undefined : get(r, 'barcode') || undefined, notes: serial ? undefined : get(r, 'notes') || undefined,
            isKit: false, kitItems: [], trackSerials: serial ? true : undefined,
          };
          await db.equipment.put(e);
          if (e.code) byCode.set(e.code.toLowerCase(), e);
          byName.set(e.name.toLowerCase(), e);
          created++;
        } else if (!e.trackSerials) {
          await db.equipment.update(e.id, { trackSerials: true, updatedAt: t });
          e.trackSerials = true;
        }
        if (!serial) continue;
        const mine = units.filter((u) => u.equipmentId === e!.id);
        if (mine.some((u) => u.serial.toLowerCase() === serial.toLowerCase())) { skipped++; continue; }
        const unit = {
          id: uid(), createdAt: t, updatedAt: t, equipmentId: e.id, serial, status: 'ok' as const,
          barcode: get(r, 'barcode') || (e.code ? nextUnitCode(e, mine) : undefined), notes: get(r, 'notes') || undefined,
        };
        await db.units.put(unit);
        units.push(unit);
        added++;
      }
      setResult(`${created} article(s) créé(s)` + (added ? `, ${added} numéro(s) de série ajouté(s)` : '') + (skipped ? `, ${skipped} numéro(s) déjà connu(s) ignoré(s)` : '') + '.');
      setRows([]); setCols([]);
      return;
    } else if (target === 'contacts') {
      for (const r of rows) {
        const company = get(r, 'company') || [get(r, 'firstName'), get(r, 'lastName')].filter(Boolean).join(' ');
        if (!company) continue;
        await db.contacts.put({
          id: uid(), createdAt: t, updatedAt: t, company, type: mapContactType(get(r, 'type')),
          firstName: get(r, 'firstName') || undefined, lastName: get(r, 'lastName') || undefined, email: get(r, 'email') || undefined,
          phone: get(r, 'phone') || undefined, address: get(r, 'address') || undefined, postalCode: get(r, 'postalCode') || undefined,
          city: get(r, 'city') || undefined, country: get(r, 'country') || undefined, vatNumber: get(r, 'vatNumber') || undefined,
        });
        n++;
      }
    } else if (target === 'people') {
      for (const r of rows) {
        const name = get(r, 'name');
        if (!name) continue;
        await db.people.put({ id: uid(), createdAt: t, updatedAt: t, name, role: get(r, 'role') || undefined, email: get(r, 'email') || undefined, phone: get(r, 'phone') || undefined, dailyRate: parseNumber(get(r, 'dailyRate')), external: false });
        n++;
      }
    } else {
      const contacts = await db.contacts.toArray();
      const byName = new Map(contacts.map((c) => [c.company.toLowerCase(), c.id]));
      for (const r of rows) {
        const name = get(r, 'name');
        if (!name) continue;
        const clientName = get(r, 'client');
        let clientId = clientName ? byName.get(clientName.toLowerCase()) : undefined;
        if (clientName && !clientId) {
          clientId = uid();
          await db.contacts.put({ id: clientId, createdAt: t, updatedAt: t, company: clientName, type: 'client' });
          byName.set(clientName.toLowerCase(), clientId);
        }
        const start = parseDate(get(r, 'start')) || parseDate(new Date().toISOString());
        const end = parseDate(get(r, 'end')) || start;
        const status = mapStatus(get(r, 'status'));
        const id = uid();
        await db.projects.put({ id, createdAt: t, updatedAt: t, number: get(r, 'number') || (await nextNumber('P')), name, clientId, venue: get(r, 'venue') || undefined, status, start, end, discount: 0 });
        await db.subprojects.put({ id: uid(), createdAt: t, updatedAt: t, projectId: id, name: 'Principal', status, start, end, order: 0, venue: get(r, 'venue') || undefined });
        n++;
      }
    }
    setResult(`${n} ${TARGET_LABELS[target].toLowerCase()} importé(s).`);
    setRows([]);
    setCols([]);
  };

  return (
    <>
      <PageHead title="Import des données" />
      <div className="info">
        Dans Rentman, exporte chaque liste (Matériel, Contacts, Équipe, Projets) en <strong>CSV</strong>, puis importe-les ici.
        Les colonnes sont reconnues automatiquement ; tu peux corriger la correspondance avant de valider.
        Conseil : importe les contacts avant les projets pour que les clients soient reliés.
        Matériel suivi par numéro de série : une ligne par unité, avec la même désignation (ou référence) ; les lignes sont regroupées
        en un seul article et chaque numéro de série devient une unité (le code-barres de la ligne va à l'unité). Un article déjà
        existant reçoit les nouveaux numéros.
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
        {result && <p className="avail ok">{result}</p>}
      </div>

      {cols.length > 0 && (
        <div className="card">
          <h2>Correspondance des colonnes ({rows.length} lignes)</h2>
          <div className="form">
            {FIELDS[target].map((f) => (
              <Field key={f.key} label={f.label}>
                <select value={map[f.key] || ''} onChange={(e) => setMap({ ...map, [f.key]: e.target.value })}>
                  <option value="">— ignorer —</option>
                  {cols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
            ))}
          </div>
          <h3 style={{ marginTop: 16 }}>Aperçu</h3>
          <div className="table-wrap">
            <table className="list">
              <thead><tr>{FIELDS[target].filter((f) => map[f.key]).map((f) => <th key={f.key}>{f.label}</th>)}</tr></thead>
              <tbody>
                {rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>{FIELDS[target].filter((f) => map[f.key]).map((f) => <td key={f.key}>{r[map[f.key]]}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="form-actions" style={{ display: 'flex', marginTop: 12 }}>
            <button onClick={run} disabled={!map[FIELDS[target][0].key]}>Importer {rows.length} lignes</button>
          </div>
        </div>
      )}
    </>
  );
}
