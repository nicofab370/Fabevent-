/**
 * Tri des tableaux de liste par clic sur le titre d'une colonne : A → Z, puis Z → A au clic suivant.
 * Branché une seule fois (installTableSort) pour tous les tableaux « table.list » de l'application.
 *
 * - nombres et montants (« 1 234,50 € », « 12 kg »), dates (« 27/11/2026 ») et textes (ordre naturel : « 2 » avant « 10 ») ;
 * - les cases vides vont toujours à la fin ;
 * - les lignes rattachées (contenu d'un kit, détail déplié) suivent leur ligne ; les lignes de total restent en bas ;
 * - exclus : tableaux à ordre manuel (.eq-table, .no-sort), colonnes sans titre ou à case à cocher (.no-sort).
 *
 * Les lignes sont réordonnées dans la page ; quand React ajoute ou change des lignes, le tri est réappliqué.
 */

const CHILD = /\b(kid|kit-child|fin-kid|detail-row|sub-row)\b/;
const PINNED = /\b(grand|fin-total|fin-strong|total-row)\b/;
type Dir = 'asc' | 'desc';
interface State { col: number; dir: Dir; observer: MutationObserver }
const states = new WeakMap<HTMLTableSectionElement, State>();

/** Colonne d'une cellule, en tenant compte des colspan. */
function colOf(cell: HTMLTableCellElement): number {
  let i = 0;
  for (let c = cell.previousElementSibling as HTMLTableCellElement | null; c; c = c.previousElementSibling as HTMLTableCellElement | null) i += c.colSpan || 1;
  return i;
}
function cellAt(row: HTMLTableRowElement, col: number): HTMLTableCellElement | undefined {
  let i = 0;
  for (const c of Array.from(row.cells)) { if (i === col) return c; i += c.colSpan || 1; if (i > col) return undefined; }
  return undefined;
}

/** Texte comparable d'une cellule (valeur des champs de saisie compris). */
function cellText(c?: HTMLTableCellElement): string {
  if (!c) return '';
  const field = c.querySelector('input:not([type=checkbox]):not([type=radio]), select, textarea') as HTMLInputElement | HTMLSelectElement | null;
  if (field) {
    if (field instanceof HTMLSelectElement) return field.selectedOptions[0]?.textContent?.trim() || '';
    return field.value.trim();
  }
  return (c.dataset.sort ?? c.textContent ?? '').replace(/\s+/g, ' ').trim();
}

type Key = { kind: 0 | 1 | 2; n: number; s: string }; // 0 nombre / date, 1 texte, 2 vide
/** « 1 234,50 € » → 1234.5 ; « 27/11/2026 14:30 » → horodatage ; sinon texte. */
export function sortKey(t: string): Key {
  const s = t.trim();
  if (!s || s === '—' || s === '-') return { kind: 2, n: 0, s: '' };
  const d = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\D+(\d{1,2})[:h](\d{2}))?/);
  if (d) {
    const y = Number(d[3].length === 2 ? '20' + d[3] : d[3]);
    return { kind: 0, n: new Date(y, Number(d[2]) - 1, Number(d[1]), Number(d[4] || 0), Number(d[5] || 0)).getTime(), s };
  }
  if (/^\d{4}-\d\d-\d\d/.test(s)) return { kind: 0, n: new Date(s).getTime(), s };
  // nombre seul, éventuellement avec unité ou monnaie (pas « Article 12 » ni « F-S-0012 »)
  const m = s.replace(/[\s  ]/g, '').match(/^([-+−]?)(\d+(?:[.,]\d+)*)(%|€|€\/j|€\/pce|kg|m³|L|km|h|j|x|×|pce?s?|unités?)?$/i);
  if (m) {
    let num = m[2];
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(num)) num = num.replace(/\./g, '').replace(',', '.');
    else num = num.replace(',', '.');
    const n = parseFloat(num);
    if (Number.isFinite(n)) return { kind: 0, n: m[1] === '-' || m[1] === '−' ? -n : n, s };
  }
  return { kind: 1, n: 0, s };
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });
export function compareKeys(a: Key, b: Key, dir: Dir): number {
  if (a.kind === 2 || b.kind === 2) return a.kind === b.kind ? 0 : a.kind === 2 ? 1 : -1; // vides à la fin, dans les deux sens
  const sign = dir === 'asc' ? 1 : -1;
  if (a.kind === 0 && b.kind === 0) return sign * (a.n - b.n);
  if (a.kind !== b.kind) return sign * (a.kind - b.kind); // nombres avant textes
  return sign * collator.compare(a.s, b.s);
}

/** Lignes regroupées : une ligne principale et ses lignes rattachées. */
function groups(tbody: HTMLTableSectionElement): { main: HTMLTableRowElement; rows: HTMLTableRowElement[] }[] {
  const out: { main: HTMLTableRowElement; rows: HTMLTableRowElement[] }[] = [];
  const width = (r: HTMLTableRowElement) => Array.from(r.cells).reduce((a, c) => a + (c.colSpan || 1), 0);
  for (const r of Array.from(tbody.rows)) {
    const attached = CHILD.test(r.className) || (r.cells.length === 1 && (r.cells[0].colSpan || 1) > 1 && width(r) > 1);
    if (attached && out.length) out[out.length - 1].rows.push(r);
    else out.push({ main: r, rows: [r] });
  }
  return out;
}

function apply(tbody: HTMLTableSectionElement) {
  const st = states.get(tbody);
  if (!st) return;
  const gs = groups(tbody);
  const pinned = gs.filter((g) => PINNED.test(g.main.className));
  const sortable = gs.filter((g) => !PINNED.test(g.main.className));
  const keyed = sortable.map((g, i) => ({ g, i, k: sortKey(cellText(cellAt(g.main, st.col))) }));
  keyed.sort((a, b) => compareKeys(a.k, b.k, st.dir) || a.i - b.i);
  const order = [...keyed.map((x) => x.g), ...pinned].flatMap((g) => g.rows);
  const current = Array.from(tbody.rows);
  if (order.every((r, i) => r === current[i])) return;
  st.observer.disconnect();
  for (const r of order) tbody.appendChild(r);
  st.observer.observe(tbody, { childList: true });
}

function sortable(th: HTMLTableCellElement): boolean {
  const table = th.closest('table');
  if (!table || !table.classList.contains('list') || table.matches('.eq-table, .no-sort') || th.classList.contains('no-sort')) return false;
  if (!th.closest('thead') || th.querySelector('input, button, select')) return false;
  return !!th.textContent?.trim();
}

function onClick(e: MouseEvent) {
  const th = (e.target as HTMLElement | null)?.closest?.('th') as HTMLTableCellElement | null;
  if (!th || !sortable(th) || (e.target as HTMLElement).closest('a, button, input, select, label')) return;
  const table = th.closest('table') as HTMLTableElement;
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const col = colOf(th);
  const prev = states.get(tbody);
  const dir: Dir = prev && prev.col === col && prev.dir === 'asc' ? 'desc' : 'asc';
  prev?.observer.disconnect();
  const observer = new MutationObserver(() => apply(tbody));
  states.set(tbody, { col, dir, observer });
  table.querySelectorAll('thead th.sort-asc, thead th.sort-desc').forEach((x) => x.classList.remove('sort-asc', 'sort-desc'));
  th.classList.add(dir === 'asc' ? 'sort-asc' : 'sort-desc');
  th.setAttribute('aria-sort', dir === 'asc' ? 'ascending' : 'descending');
  apply(tbody);
  observer.observe(tbody, { childList: true });
}

/** Survol : curseur et info-bulle sur les titres triables. */
function onOver(e: MouseEvent) {
  const th = (e.target as HTMLElement | null)?.closest?.('th') as HTMLTableCellElement | null;
  if (!th || th.dataset.sortable) return;
  if (sortable(th)) { th.dataset.sortable = '1'; if (!th.title) th.title = 'Trier : A → Z, puis Z → A'; }
  else th.dataset.sortable = '0';
}

let installed = false;
export function installTableSort() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener('click', onClick);
  document.addEventListener('mouseover', onOver);
}
