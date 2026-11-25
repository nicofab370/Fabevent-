import { currentWorkspace, db, TABLES } from './db';
import { ensureUnitNumbers } from './unitNumbers';
import { ensureSerialCodes } from './autoCodes';

/*
 * Synchronisation automatique entre appareils, hors ligne d'abord :
 * - chaque modification locale est notée (table + id) dans une file d'attente gardée sur l'appareil ;
 * - toutes les 20 s, au retour du réseau et 2 s après une modification, la file est envoyée au serveur
 *   (sync.php sur l'hébergement), puis les changements des autres appareils sont récupérés ;
 * - en cas de conflit sur un même enregistrement, la modification la plus récente l'emporte ;
 * - sans réseau, l'application fonctionne normalement : tout part au retour de la connexion.
 * La base de démonstration n'est jamais synchronisée.
 */

/** Tables synchronisées : tout, sauf le registre (recréé sur chaque appareil). */
export const SYNCED = TABLES.filter((t) => t !== 'log');

const ws = () => currentWorkspace();
const K = {
  url: () => `fab.sync.url`,
  pending: () => `fab.sync.pending.${ws()}`,
  seq: () => `fab.sync.seq.${ws()}`,
  last: () => `fab.sync.last.${ws()}`,
};
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* sans stockage */ } };

export function syncUrl(): string {
  const v = get(K.url());
  if (v !== null) return v;
  // FabEvent servi depuis l'hébergement : le serveur de synchro est à côté
  return location.protocol.startsWith('http') && !/github\.io$|localhost$|127\.0\.0\.1$/.test(location.hostname) ? new URL('api/sync.php', location.href).href : '';
}
export function setSyncUrl(url: string) { set(K.url(), url.trim()); schedule(0); }
export const syncEnabled = () => !!syncUrl() && ws() !== 'demo';

/* ---------- file d'attente des modifications locales ---------- */

type Pending = Record<string, number>; // « table|id » → version locale
let pending: Pending | null = null;
let version = 0;
const loadPending = (): Pending => (pending ??= JSON.parse(get(K.pending()) || '{}'));
const savePending = () => set(K.pending(), JSON.stringify(pending || {}));
export const pendingCount = () => Object.keys(loadPending()).length;

function note(table: string, id: string) {
  if (!syncEnabled()) return;
  loadPending()[`${table}|${id}`] = ++version;
  savePending();
  schedule(2000);
}

/** Transaction d'application des changements reçus : marquée pour ne pas être renvoyée. */
export const isRemote = (tx: unknown) => !!(tx as { __remote?: boolean } | undefined)?.__remote;

for (const t of SYNCED) {
  const table = db.table(t);
  table.hook('creating', (key, obj, tx) => { if (!isRemote(tx)) note(t, String(key ?? (obj as { id?: string }).id)); });
  table.hook('updating', (_m, key, _o, tx) => { if (!isRemote(tx)) note(t, String(key)); });
  table.hook('deleting', (key, _o, tx) => { if (!isRemote(tx)) note(t, String(key)); });
}

/* ---------- état visible ---------- */

export type SyncState = { status: 'off' | 'idle' | 'busy' | 'offline' | 'auth' | 'error'; message?: string; last?: string; pending: number };
let state: SyncState = { status: 'off', pending: 0 };
const listeners = new Set<(s: SyncState) => void>();
function emit(s: Partial<SyncState>) {
  state = { ...state, ...s, pending: pendingCount(), last: get(K.last()) || undefined };
  listeners.forEach((l) => l(state));
}
export function onSync(l: (s: SyncState) => void) { listeners.add(l); l(state); return () => { listeners.delete(l); }; }
export const syncState = () => state;

/* ---------- échanges avec le serveur ---------- */

async function call(action: string, body?: unknown, params: Record<string, string> = {}) {
  const u = new URL(syncUrl(), location.href);
  u.searchParams.set('action', action);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u.href, {
    method: body ? 'POST' : 'GET', credentials: 'include', cache: 'no-store',
    headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 401) throw Object.assign(new Error('Connexion requise'), { auth: true });
  // le serveur renvoie la page de l'app (réécriture SPA) : l'API n'est pas au bon endroit
  if ((r.headers.get('content-type') || '').includes('text/html'))
    throw Object.assign(new Error('API non atteinte (la page de l’application est renvoyée) : déposer le dossier api/ à côté de l’application (ex. /fabevent/api/) — voir docs/deploiement-fabri.md'), { api: true });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Erreur ${r.status}`);
  return j;
}

/** Les fichiers joints (Blob) voyagent en texte (data URL). */
async function encode(table: string, rec: Record<string, unknown>) {
  if (table === 'files' && rec.blob instanceof Blob) {
    const dataUrl = await new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = rej; fr.readAsDataURL(rec.blob as Blob); });
    return { ...rec, blob: { dataUrl } };
  }
  return rec;
}
function decode(table: string, rec: Record<string, unknown>) {
  const b = rec.blob as { dataUrl?: string } | undefined;
  if (table === 'files' && b?.dataUrl) {
    const [head, data] = b.dataUrl.split(',');
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { ...rec, blob: new Blob([bytes], { type: head.match(/data:([^;]+)/)?.[1] || '' }) };
  }
  return rec;
}
const stamp = (rec?: Record<string, unknown>) => String(rec?.updatedAt || rec?.at || '');

async function push() {
  const p = loadPending();
  const keys = Object.keys(p).slice(0, 200);
  if (!keys.length) return 0;
  const sent: Pending = {};
  const changes = [];
  for (const k of keys) {
    const [table, id] = k.split('|');
    sent[k] = p[k];
    const rec = await db.table(table).get(id);
    changes.push(rec ? { t: table, id, d: await encode(table, rec), u: stamp(rec) || new Date().toISOString() } : { t: table, id, d: null, u: new Date().toISOString() });
  }
  await call('push', { ws: ws(), changes });
  // on retire de la file ce qui est parti (sauf si c'est été modifié entre-temps)
  const now = loadPending();
  for (const [k, v] of Object.entries(sent)) if (now[k] === v) delete now[k];
  savePending();
  return keys.length;
}

async function pull() {
  let more = true;
  let n = 0;
  while (more) {
    const since = get(K.seq()) || '0';
    const j = await call('pull', undefined, { ws: ws(), since });
    const changes: { t: string; id: string; d: Record<string, unknown> | null; u: string }[] = j.changes || [];
    if (changes.length) {
      const p = loadPending();
      const tables = Array.from(new Set(changes.map((c) => c.t))).filter((t) => (SYNCED as readonly string[]).includes(t));
      await db.transaction('rw', tables.map((t) => db.table(t)), async (tx) => {
        (tx as unknown as { __remote: boolean }).__remote = true;
        for (const c of changes) {
          if (!tables.includes(c.t)) continue;
          const local = await db.table(c.t).get(c.id);
          // modification locale plus récente, pas encore envoyée : elle l'emporte
          if (p[`${c.t}|${c.id}`] && local && stamp(local) > c.u) continue;
          if (c.d) await db.table(c.t).put(decode(c.t, c.d));
          else if (local) await db.table(c.t).delete(c.id);
          n++;
        }
      });
    }
    set(K.seq(), String(j.seq ?? since));
    more = !!j.more;
  }
  return n;
}

let running = false;
let timer = 0;
/** Lance une synchronisation (dans `ms` millisecondes). */
export function schedule(ms = 0) {
  clearTimeout(timer);
  timer = window.setTimeout(() => { syncNow().catch(() => {}); }, ms);
}

export async function syncNow(): Promise<SyncState> {
  if (!syncEnabled()) { emit({ status: 'off', message: undefined }); return state; }
  if (!navigator.onLine) { emit({ status: 'offline' }); return state; }
  if (running) return state;
  running = true;
  emit({ status: 'busy' });
  try {
    while (await push()) { /* par lots de 200 */ }
    // unités reçues sans numéro #x (appareil pas encore à jour) : numérotées ici
    if (await pull()) { await ensureUnitNumbers().catch(() => 0); await ensureSerialCodes().catch(() => 0); }
    set(K.last(), new Date().toISOString());
    emit({ status: 'idle', message: undefined });
  } catch (e) {
    const err = e as Error & { auth?: boolean };
    emit(err.auth ? { status: 'auth', message: 'Connecte-toi aux pages internes pour synchroniser.' } : { status: navigator.onLine ? 'error' : 'offline', message: err.message });
  } finally {
    running = false;
  }
  return state;
}

/** Première mise en route sur un appareil qui a déjà des données : tout est envoyé une fois. */
export async function pushEverything() {
  for (const t of SYNCED) for (const id of await db.table(t).toCollection().primaryKeys()) loadPending()[`${t}|${String(id)}`] = ++version;
  savePending();
  return syncNow();
}

/**
 * Numéro suivant demandé au serveur (factures sans doublon entre appareils).
 * Renvoie null hors ligne ou sans synchro : la numérotation locale prend alors le relais.
 */
export async function serverNumber(key: string, localNext: number): Promise<number | null> {
  if (!syncEnabled() || !navigator.onLine) return null;
  try {
    const j = await call('next', { ws: ws(), key, min: localNext });
    return typeof j.n === 'number' ? j.n : null;
  } catch { return null; }
}

export function startSync() {
  if (!syncEnabled()) { emit({ status: 'off' }); return; }
  window.addEventListener('online', () => schedule(500));
  window.addEventListener('offline', () => emit({ status: 'offline' }));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') schedule(300); });
  setInterval(() => schedule(0), 20000);
  schedule(300);
}
