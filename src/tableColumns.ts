/**
 * Colonnes des listes au choix (« Affichages » de Rentman) : clic droit (ou appui long) sur un titre de colonne
 * → cases à cocher des colonnes. Le choix est retenu par page et par tableau, sur cet appareil.
 * Les colonnes masquées le sont par une feuille de style (rien n'est retiré du tableau).
 */
const STORE = 'fab.columns';
type Hidden = Record<string, number[]>;
const load = (): Hidden => { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } };
const store = (h: Hidden) => { try { localStorage.setItem(STORE, JSON.stringify(h)); } catch { /* sans stockage */ } };

const pageKey = () => (location.hash.split('?')[0] || '#/').replace(/\/[0-9a-z]{8,}(?=\/|$)/gi, '/:id');
function tableKey(t: HTMLTableElement): string {
  const all = Array.from(document.querySelectorAll('table.list'));
  return `${pageKey()}#${all.indexOf(t)}`;
}

let styleEl: HTMLStyleElement | null = null;
function applyStyles() {
  const h = load();
  if (!styleEl) { styleEl = document.createElement('style'); styleEl.id = 'fab-columns'; document.head.appendChild(styleEl); }
  const tables = Array.from(document.querySelectorAll<HTMLTableElement>('table.list'));
  const rules: string[] = [];
  tables.forEach((t) => {
    const k = tableKey(t);
    const cols = h[k];
    if (!cols?.length) { if (t.dataset.colkey) delete t.dataset.colkey; return; }
    const id = 'c' + Math.abs([...k].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);
    t.dataset.colkey = id;
    for (const n of cols) rules.push(`table[data-colkey="${id}"] > * > tr > :nth-child(${n + 1}):not([colspan]){display:none}`);
  });
  styleEl.textContent = rules.join('\n');
}

let pop: HTMLDivElement | null = null;
function closePop() { pop?.remove(); pop = null; }

function openChooser(t: HTMLTableElement, x: number, y: number) {
  closePop();
  const ths = Array.from(t.tHead?.rows[0]?.cells || []);
  const k = tableKey(t);
  const h = load();
  const hidden = new Set(h[k] || []);
  pop = document.createElement('div');
  pop.className = 'col-chooser';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Colonnes affichées');
  const title = document.createElement('strong');
  title.textContent = 'Colonnes affichées';
  pop.appendChild(title);
  ths.forEach((th, i) => {
    const label = th.textContent?.trim();
    if (!label) return;
    const row = document.createElement('label');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !hidden.has(i);
    cb.addEventListener('change', () => {
      const cur = new Set(load()[k] || []);
      if (cb.checked) cur.delete(i); else cur.add(i);
      const all = load();
      if (cur.size) all[k] = [...cur].sort((a, b) => a - b); else delete all[k];
      store(all);
      applyStyles();
    });
    row.append(cb, ' ', label);
    pop!.appendChild(row);
  });
  const reset = document.createElement('button');
  reset.type = 'button';
  reset.className = 'secondary small';
  reset.textContent = 'Toutes les colonnes';
  reset.addEventListener('click', () => { const all = load(); delete all[k]; store(all); applyStyles(); closePop(); });
  pop.appendChild(reset);
  document.body.appendChild(pop);
  const r = pop.getBoundingClientRect();
  pop.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  pop.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
}

let installed = false;
export function installTableColumns() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('contextmenu', (e) => {
    const th = (e.target as HTMLElement | null)?.closest?.('table.list thead th');
    if (!th) return;
    const t = th.closest('table') as HTMLTableElement;
    if ((t.tHead?.rows[0]?.cells.length || 0) < 3) return;
    e.preventDefault();
    openChooser(t, e.clientX, e.clientY);
  });
  document.addEventListener('mousedown', (e) => { if (pop && !pop.contains(e.target as Node)) closePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePop(); });
  // tableaux ajoutés ou page changée : styles réappliqués
  let t: number | undefined;
  new MutationObserver(() => { clearTimeout(t); t = window.setTimeout(applyStyles, 120); }).observe(document.body, { childList: true, subtree: true });
  addEventListener('hashchange', () => { closePop(); applyStyles(); });
}
