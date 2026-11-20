/**
 * Lecture d'un bon de préparation (PDF, Word .docx, export HTML/.doc, texte collé) pour en faire
 * une checklist libre. Repris de la checklist FABRI.live en production :
 * une ligne de matériel = « quantité  nom  code  total » ; les lignes plus en retrait sont le contenu
 * d'un kit ; les titres courts juste avant des articles sont les catégories ; les « clé : valeur »
 * (client, n° de projet, lieu…) et les périodes (jj-mm-aaaa hh:mm → …) sont gardés.
 */

export interface ImportedLine {
  id: string;
  cat: string;
  parent: string | null;
  qty: number;
  name: string;
  code: string;
}
export interface ImportedList {
  title: string;
  meta: Record<string, string>;
  plan: { label: string; from: string; to: string }[];
  lines: ImportedLine[];
}

interface Row { segs: string[]; x: number | null; kid: boolean | null; cat: boolean }

const KEYS = ['Client', 'N° de projet', 'Numéro du document', 'Lieu de la prestation', 'Adresse', 'Ville', 'Téléphone', 'Gestionnaire de compte', 'Mode de paiement', 'Poids', 'Volume', 'Puissance', 'Créé le'];
const SKIP_KEY = 'Mode de paiement'; // info volontairement non conservée
const KEYRE = new RegExp('^(' + KEYS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\s*(:)?\\s*(.*)$', 'i');
const canonKey = (k: string) => KEYS.find((x) => x.toLowerCase() === k.toLowerCase()) || k;
const ITEMRE = /^\s*(\d+(?:[.,]\d+)?)\s+(.+?)\s+([A-Za-z]{2,}-\d+|\d{2,})\s+(\d+(?:[.,]\d+)?)\s*$/;
const num = (s: string) => parseFloat(String(s).replace(',', '.'));
const clean = (s: unknown) => String(s ?? '').replace(/[ \s]+/g, ' ').trim();
let seq = 0;
const uid = () => Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4) + (seq++).toString(36);

function asItem(row: Row) {
  const t = row.segs.join('\t').replace(/ /g, ' ').replace(/\[[\s]*\]/g, '\t').replace(/[☐□]/g, '\t');
  const m = t.match(ITEMRE);
  if (!m) return null;
  const name = clean(m[2]).replace(/^[[\]\s]+/, '');
  if (!name || /^(nom|total|quantité)$/i.test(name)) return null;
  return { qty: num(m[1]), name, code: m[3], total: num(m[4]) };
}

/** Construit la liste à partir des lignes lues ; thr = retrait (en points) à partir duquel une ligne est le contenu d'un kit. */
export function buildFromRows(rows: Row[], thr: number): ImportedList {
  const cls = rows.map((r) => ({ r, item: asItem(r) }));
  const xs = cls.filter((c) => c.item && c.r.kid == null && c.r.x != null).map((c) => c.r.x as number);
  const minX = xs.length ? Math.min(...xs) : 0;
  const meta: Record<string, string> = {};
  const plan: ImportedList['plan'] = [];
  const lines: ImportedLine[] = [];
  let title = '', cat = 'Matériel', parent: string | null = null;
  const nextIsItem = (i: number) => {
    for (let j = i + 1; j < cls.length; j++) {
      if (cls[j].r.segs.every((s) => !clean(s))) continue;
      return !!cls[j].item;
    }
    return false;
  };
  cls.forEach((c, i) => {
    const r = c.r, segs = r.segs.map(clean).filter(Boolean), joined = segs.join(' ');
    if (c.item) {
      const kid = r.kid != null ? r.kid : r.x != null && r.x > minX + thr;
      const l: ImportedLine = { id: uid(), cat, parent: null, qty: c.item.qty, name: c.item.name, code: c.item.code };
      if (kid && parent) l.parent = parent; else parent = l.id;
      lines.push(l);
      return;
    }
    if (!segs.length) return;
    let m: RegExpMatchArray | null;
    if (!title && (m = joined.match(/^Document et bon\s*:\s*(.+)$/i))) { title = m[1]; return; }
    if (segs.length === 1 || r.cat) {
      const t = segs[0];
      if (r.cat || (t.length <= 40 && !/^\d+\s*\/\s*\d+$/.test(t) && !/^Quantit/i.test(t) && !/:/.test(t) && nextIsItem(i))) { cat = t; parent = null; return; }
    }
    // couples « clé : valeur »
    for (let j = 0; j < segs.length; j++) {
      const km = segs[j].match(KEYRE);
      if (!km) continue;
      let val = km[3];
      let colon = !!km[2];
      if (!colon) {
        if (segs[j + 1] && /^:/.test(segs[j + 1])) { val = segs[j + 1].replace(/^:\s*/, ''); colon = true; j++; } else continue;
      } else if (!val && segs[j + 1] && !KEYRE.test(segs[j + 1])) { val = segs[j + 1]; j++; }
      const k = canonKey(km[1]);
      if (k === SKIP_KEY) continue;
      if (val && !meta[k]) meta[k] = val.trim();
    }
    // planning
    const dts = joined.match(/\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}/g);
    if (dts && dts.length >= 2 && !/Créé le/i.test(joined)) plan.push({ label: clean(joined.split(dts[0])[0]), from: dts[0], to: dts[1] });
  });
  return { title, meta, plan, lines };
}

/* --- PDF --- */
async function rowsFromPdf(buf: ArrayBuffer): Promise<ImportedList> {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buf) }).promise;
  const rows: Row[] = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const its = (tc.items as { str?: string; transform: number[]; width: number }[])
      .filter((i) => i.str && i.str.trim() !== '').map((i) => ({ s: i.str!, x: i.transform[4], y: i.transform[5], w: i.width }));
    its.sort((a, b) => b.y - a.y || a.x - b.x);
    const groups: { y: number; items: typeof its }[] = [];
    for (const it of its) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g.y - it.y) <= 3) g.items.push(it); else groups.push({ y: it.y, items: [it] });
    }
    for (const g of groups) {
      g.items.sort((a, b) => a.x - b.x);
      let txt = '', px: number | null = null;
      for (const it of g.items) {
        if (px != null) { const gap = it.x - px; txt += gap > 14 ? '\t' : gap > 1 ? ' ' : ''; }
        txt += it.s;
        px = it.x + it.w;
      }
      rows.push({ segs: txt.split('\t'), x: g.items[0].x, kid: null, cat: false });
    }
  }
  return buildFromRows(rows, 4);
}

/* --- HTML (export Rentman .doc / .html) --- */
export function rowsFromHtml(text: string): ImportedList {
  const doc = new DOMParser().parseFromString(text, 'text/html');
  doc.querySelectorAll('style,script').forEach((e) => e.remove());
  const rows: Row[] = [];
  doc.body.querySelectorAll('h1,h2,tr').forEach((el) => {
    if (el.tagName === 'TR') {
      if (el.querySelector('tr')) return;
      const cells = [...el.children].filter((c) => /^t[dh]$/i.test(c.tagName)) as HTMLElement[];
      const segs = cells.map((c) => clean(c.textContent));
      const cls = el.className || '';
      let kid: boolean | null = null;
      if (/\bsetcontent\b/.test(cls)) kid = true;
      else if (/\b(set|item)\b/.test(cls)) kid = false;
      else {
        const nameTd = cells.find((c) => /column_naam/.test(c.className)) || cells[3];
        const pad = nameTd && (nameTd.getAttribute('style') || '').match(/padding-left:\s*(\d+)/);
        if (pad) kid = +pad[1] > 0;
      }
      rows.push({ segs, x: null, kid, cat: /materialgroupheader/.test(cls) });
      if (/materialgroupheader/.test(cls)) rows[rows.length - 1].segs = [segs.filter(Boolean).pop() || ''];
    } else if (!el.closest('table')) rows.push({ segs: [clean(el.textContent)], x: null, kid: null, cat: false });
  });
  return buildFromRows(rows, 1);
}

/* --- Word .docx --- */
async function rowsFromDocx(buf: ArrayBuffer): Promise<ImportedList> {
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(buf);
  const f = zip.file('word/document.xml');
  if (!f) throw new Error('Document Word illisible.');
  const doc = new DOMParser().parseFromString(await f.async('text'), 'text/xml');
  const body = doc.getElementsByTagName('w:body')[0];
  const txt = (e: Element) => [...e.getElementsByTagName('w:t')].map((x) => x.textContent).join('');
  const ind = (e: Element) => { const n = e.getElementsByTagName('w:ind')[0]; return n ? +(n.getAttribute('w:left') || n.getAttribute('w:start') || 0) : 0; };
  const rows: Row[] = [];
  let anyInd = false;
  for (const el of [...body.children]) {
    if (el.localName === 'p') { const t = txt(el); if (clean(t)) rows.push({ segs: [t], x: null, kid: null, cat: false }); }
    else if (el.localName === 'tbl') {
      for (const tr of [...el.getElementsByTagName('w:tr')]) {
        const cells = [...tr.children].filter((c) => c.localName === 'tc');
        const indent = Math.max(0, ...cells.map(ind));
        if (indent >= 100) anyInd = true;
        rows.push({ segs: cells.map(txt), x: null, kid: indent >= 100, cat: false });
      }
    }
  }
  if (!anyInd) rows.forEach((r) => { r.kid = null; });
  return buildFromRows(rows, 1);
}

/* --- texte collé --- */
export function rowsFromText(text: string): ImportedList {
  const rows: Row[] = text.split(/\r?\n/).filter((l) => l.trim())
    .map((l) => ({ segs: l.replace(/^\s+/, '').split(/\t| {3,}/), x: l.match(/^\s*/)![0].length, kid: null, cat: false }));
  return buildFromRows(rows, 1);
}

function sniff(buf: ArrayBuffer): 'pdf' | 'docx' | 'olddoc' | 'text' {
  const b = new Uint8Array(buf.slice(0, 8));
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'docx';
  if (b[0] === 0xd0 && b[1] === 0xcf) return 'olddoc';
  return 'text';
}

/** Lit un fichier (PDF, Word, HTML, texte) et renvoie la liste reconnue. */
export async function importFile(file: File): Promise<ImportedList> {
  const buf = await file.arrayBuffer();
  const kind = sniff(buf);
  let r: ImportedList;
  if (kind === 'pdf') r = await rowsFromPdf(buf);
  else if (kind === 'docx') r = await rowsFromDocx(buf);
  else if (kind === 'olddoc') throw new Error('Ancien format Word (.doc binaire) non lisible : réenregistre-le en .docx ou en PDF.');
  else {
    const text = new TextDecoder('utf-8').decode(buf);
    r = /<html|<!doctype|<table/i.test(text.slice(0, 4000)) || /<tr[\s>]/i.test(text) ? rowsFromHtml(text) : rowsFromText(text);
  }
  if (!r.lines.length) throw new Error(`Aucune ligne de matériel reconnue dans « ${file.name} ».`);
  if (!r.title) r.title = file.name.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').trim();
  return r;
}
