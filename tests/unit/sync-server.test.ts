import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/*
 * Serveur réel (PHP + SQLite) avec la connexion propre à FabEvent (auth.php) :
 * aucune dépendance aux pages internes du site. Ignoré si PHP n'est pas installé.
 */
const hasPhp = spawnSync('php', ['-v']).status === 0;
const port = 5600 + Math.floor(Math.random() * 300);
const root = `http://127.0.0.1:${port}`;
let php: ChildProcess;
let data = '';

/** Petit navigateur : garde les cookies reçus (session FabEvent). */
class Agent {
  jar = new Map<string, string>();
  async req(script: string, action: string, body?: unknown, params = '') {
    const r = await fetch(`${root}/${script}?action=${action}${params}`, {
      method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
      headers: { 'Content-Type': 'application/json', Cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ') },
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(';'); const [k, v] = kv.split('=');
      if (v && !/expires=Thu, 01 Jan 1970|Max-Age=0/i.test(c) && !c.includes('=deleted')) this.jar.set(k, v); else this.jar.delete(k);
    }
    return { status: r.status, json: await r.json().catch(() => ({})) };
  }
  sync(action: string, body?: unknown, params = '') { return this.req('sync.php', action, body, params); }
  auth(action: string, body?: unknown, params = '') { return this.req('auth.php', action, body, params); }
}

const salt = 'sel-de-test';
const hash = (p: string, s = salt) => createHash('sha256').update(`${s}:${p}`).digest('hex');
const admin = { id: 'admin-0001', name: 'Nico', email: 'nico@exemple.org', salt, passHash: hash('motdepasse'), role: 'admin', active: true };

/** Code TOTP (même calcul que src/totp.ts). */
function totp(secretB32: string, t = Date.now()) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const ch of secretB32) bits += abc.indexOf(ch).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac('sha1', key).update(msg).digest();
  const o = h[19] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

describe.skipIf(!hasPhp)('serveur FabEvent autonome (auth.php + sync.php)', () => {
  const nico = new Agent();
  const collegue = new Agent();

  beforeAll(async () => {
    data = mkdtempSync(join(tmpdir(), 'fabsync-'));
    php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', resolve('server')], { env: { ...process.env, FABEVENT_DATA: data }, stdio: 'ignore' });
    for (let i = 0; i < 50; i++) { try { await fetch(`${root}/diag.php`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  });
  afterAll(() => { php?.kill(); });

  it('refuse sans connexion', async () => {
    expect((await new Agent().sync('ping', undefined, '&ws=principal')).status).toBe(401);
  });
  it('serveur vierge : le premier compte administrateur se crée librement, une seule fois', async () => {
    const st = await nico.auth('status', undefined, '&ws=principal');
    expect(st.json).toMatchObject({ session: false, users: false, setup: 'open' });
    const r = await nico.auth('setup', { ws: 'principal', user: admin });
    expect(r.status).toBe(200);
    expect((await nico.sync('ping', undefined, '&ws=principal')).json.ok).toBe(true);
    // un second « premier compte » est refusé
    expect((await new Agent().auth('setup', { ws: 'principal', user: { ...admin, id: 'pirate-01', email: 'pirate@exemple.org' } })).status).toBe(409);
  });
  it('connexion : mauvais mot de passe refusé, bon mot de passe = session sur cette base seulement', async () => {
    expect((await collegue.auth('login', { ws: 'principal', email: 'nico@exemple.org', password: 'faux' })).status).toBe(401);
    const ok = await collegue.auth('login', { ws: 'principal', email: 'NICO@exemple.org', password: 'motdepasse' });
    expect(ok.status).toBe(200);
    expect(ok.json.user.passHash).toBe(admin.passHash); // l'appareil garde le compte pour se connecter hors ligne
    expect((await collegue.sync('ping', undefined, '&ws=principal')).status).toBe(200);
    expect((await collegue.sync('ping', undefined, '&ws=autrebase')).status).toBe(401);
  });
  it('un appareil envoie, un autre reçoit ; le plus récent l’emporte', async () => {
    const r1 = await nico.sync('push', { ws: 'principal', changes: [{ t: 'contacts', id: 'c1', d: { id: 'c1', company: 'Ville de Namur', updatedAt: '2026-11-20T10:00:00Z' }, u: '2026-11-20T10:00:00Z' }] });
    expect(r1.json.applied).toBe(1);
    const r2 = await collegue.sync('push', { ws: 'principal', changes: [{ t: 'contacts', id: 'c1', d: { id: 'c1', company: 'Ancien nom', updatedAt: '2026-11-19T10:00:00Z' }, u: '2026-11-19T10:00:00Z' }] });
    expect(r2.json.skipped).toBe(1);
    const p = await collegue.sync('pull', undefined, '&ws=principal&since=0');
    expect(p.json.changes.find((c: { id: string }) => c.id === 'c1').d.company).toBe('Ville de Namur');
    expect((await collegue.sync('pull', undefined, `&ws=principal&since=${p.json.seq}`)).json.changes).toHaveLength(0);
  });
  it('suppression transmise ; tables inconnues refusées', async () => {
    await nico.sync('push', { ws: 'principal', changes: [{ t: 'contacts', id: 'c1', d: null, u: '2026-11-21T10:00:00Z' }, { t: 'pirate', id: 'x', d: {}, u: '2026-11-21T10:00:00Z' }] });
    const p = await nico.sync('pull', undefined, '&ws=principal&since=0');
    expect(p.json.changes.filter((c: { t: string }) => c.t !== 'users')).toEqual([{ t: 'contacts', id: 'c1', d: null, u: '2026-11-21T10:00:00Z' }]);
  });
  it('numéros de facture sans doublon entre appareils', async () => {
    const a = await nico.sync('next', { ws: 'principal', key: 'F-2026', min: 4 });
    const b = await collegue.sync('next', { ws: 'principal', key: 'F-2026', min: 4 });
    expect([a.json.n, b.json.n]).toEqual([4, 5]);
  });
  it('un sous-traitant se connecte mais ne reçoit pas la base', async () => {
    const st = { id: 'sous-0001', name: 'Sam', email: 'sam@exemple.org', salt, passHash: hash('sam123'), role: 'subcontractor', active: true };
    await nico.sync('push', { ws: 'principal', changes: [{ t: 'users', id: st.id, d: { ...st, updatedAt: '2026-11-22T10:00:00Z' }, u: '2026-11-22T10:00:00Z' }] });
    const sam = new Agent();
    expect((await sam.auth('login', { ws: 'principal', email: 'sam@exemple.org', password: 'sam123' })).status).toBe(200);
    expect((await sam.sync('pull', undefined, '&ws=principal&since=0')).status).toBe(403);
  });
  it('MFA : le code est exigé, puis accepté', async () => {
    const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
    await nico.sync('push', { ws: 'principal', changes: [{ t: 'users', id: 'mfa-0001', d: { id: 'mfa-0001', name: 'Léa', email: 'lea@exemple.org', salt, passHash: hash('lea123'), role: 'admin', active: true, totpOn: true, totpSecret: secret, updatedAt: '2026-11-22T10:00:00Z' }, u: '2026-11-22T10:00:00Z' }] });
    const lea = new Agent();
    expect((await lea.auth('login', { ws: 'principal', email: 'lea@exemple.org', password: 'lea123' })).json.error).toBe('mfa');
    expect((await lea.auth('login', { ws: 'principal', email: 'lea@exemple.org', password: 'lea123', code: '000000' === totp(secret) ? '111111' : '000000' })).json.error).toBe('mfa_bad');
    expect((await lea.auth('login', { ws: 'principal', email: 'lea@exemple.org', password: 'lea123', code: totp(secret) })).status).toBe(200);
  });
  it('mot de passe changé ou compte désactivé : les sessions ouvertes sont fermées', async () => {
    await nico.sync('push', { ws: 'principal', changes: [{ t: 'users', id: admin.id, d: { ...admin, passHash: hash('nouveau'), updatedAt: '2030-01-01T10:00:00Z' }, u: '2030-01-01T10:00:00Z' }] });
    expect((await collegue.sync('ping', undefined, '&ws=principal')).status).toBe(401);
    expect((await collegue.auth('login', { ws: 'principal', email: 'nico@exemple.org', password: 'nouveau' })).status).toBe(200);
  });
  it('serveur qui a déjà des données sans compte : premier compte avec le code d’installation', async () => {
    const st = await new Agent().auth('status', undefined, '&ws=autrebase');
    expect(st.json.setup).toBe('code');
    const code = readFileSync(join(data, 'code-installation.txt'), 'utf8').trim();
    const x = new Agent();
    const u = { ...admin, id: 'admin-0002', email: 'autre@exemple.org' };
    expect((await x.auth('setup', { ws: 'autrebase', user: u, code: 'MAUVAIS000' })).status).toBe(401);
    expect((await x.auth('setup', { ws: 'autrebase', user: u, code })).status).toBe(200);
    expect((await x.sync('ping', undefined, '&ws=autrebase')).status).toBe(200);
  });
  it('agenda d’un technicien : abonnement iCal, « [Option] » puis confirmé, annulé et provisoire exclus', async () => {
    const u = '2030-02-01T10:00:00Z';
    const put = (t: string, d: Record<string, unknown>) => ({ t, id: String(d.id), d: { ...d, updatedAt: u }, u });
    await collegue.sync('push', { ws: 'principal', changes: [
      put('settings', { id: 'main', company: { name: 'FABRI' } }),
      put('people', { id: 'tech1', name: 'Sam Agenda', calToken: 'AGENDAtoken12345678' }),
      put('contacts', { id: 'lieu1', company: 'Parc de la Boverie', address: 'Parc de la Boverie 3', postalCode: '4020', city: 'Liège' }),
      put('projects', { id: 'pr1', name: 'Festival', status: 'option', venueId: 'lieu1', travelMinutes: 30 }),
      put('subprojects', { id: 'sp1', projectId: 'pr1', name: 'Grande scène', status: 'option' }),
      put('subprojects', { id: 'sp2', projectId: 'pr1', name: 'Annulée', status: 'annule' }),
      put('crew', { id: 'cr1', projectId: 'pr1', subprojectId: 'sp1', personId: 'tech1', function: 'Régisseur son', start: '2030-07-10T08:00', end: '2030-07-10T23:00', travel: true }),
      put('crew', { id: 'cr2', projectId: 'pr1', subprojectId: 'sp2', personId: 'tech1', function: 'Annulé', start: '2030-07-11T08:00', end: '2030-07-11T18:00' }),
      put('crew', { id: 'cr3', projectId: 'pr1', subprojectId: 'sp1', personId: 'tech1', function: 'Provisoire', final: false, start: '2030-07-12T08:00', end: '2030-07-12T18:00' }),
      put('crew', { id: 'cr4', projectId: 'pr1', subprojectId: 'sp1', personId: 'autre', function: 'Pas à lui', start: '2030-07-10T08:00', end: '2030-07-10T18:00' }),
    ] });
    const get = async () => { const r = await fetch(`${root}/public.php?cal=AGENDAtoken12345678`); return { type: r.headers.get('content-type') || '', text: (await r.text()).replace(/\r\n /g, '') }; };
    let c = await get();
    expect(c.type).toContain('text/calendar');
    expect(c.text).toContain('X-WR-CALNAME:FABRI — Sam Agenda');
    expect(c.text).toContain('SUMMARY:[Option] Régisseur son — Festival');
    expect(c.text).toContain('STATUS:TENTATIVE');
    expect(c.text).toContain('DTSTART;TZID=Europe/Brussels:20300710T073000'); // trajet de 30 min compris
    expect(c.text).toContain('LOCATION:Parc de la Boverie\\, Parc de la Boverie 3\\, 4020\\, Liège');
    expect(c.text.match(/BEGIN:VEVENT/g)).toHaveLength(1); // annulé, provisoire et poste d'un autre exclus
    await collegue.sync('push', { ws: 'principal', changes: [put('subprojects', { id: 'sp1', projectId: 'pr1', name: 'Grande scène', status: 'confirme' })].map((x) => ({ ...x, u: '2030-02-02T10:00:00Z', d: { ...x.d, updatedAt: '2030-02-02T10:00:00Z' } })) });
    c = await get();
    expect(c.text).toContain('SUMMARY:Régisseur son — Festival');
    expect(c.text).toContain('STATUS:CONFIRMED');
    const page = await (await fetch(`${root}/public.php?agenda=AGENDAtoken12345678`)).text();
    expect(page).toContain('calendar.google.com/calendar/r?cid=webcal');
    expect(page).toContain('webcal://');
    expect((await fetch(`${root}/public.php?cal=INCONNUtoken12345678`)).status).toBe(404);
  });
  it('mot de passe oublié avec le code d’installation : appliqué au compte dans toutes les bases', async () => {
    const u = '2030-03-01T10:00:00Z';
    const dup = (id: string) => ({ t: 'users', id, d: { id, name: 'Double', email: 'double@exemple.org', salt, passHash: hash('ancien'), role: 'admin', active: true, updatedAt: u }, u });
    await collegue.sync('push', { ws: 'principal', changes: [dup('dup-0001')] });
    const autre = new Agent();
    expect((await autre.auth('login', { ws: 'autrebase', email: 'autre@exemple.org', password: 'motdepasse' })).status).toBe(200);
    await autre.sync('push', { ws: 'autrebase', changes: [dup('dup-0002')] });
    const x = new Agent();
    expect((await x.auth('recover', { ws: 'principal', email: 'double@exemple.org', code: 'FAUXCODE00', password: 'nouveau1' })).status).toBe(401);
    const code = readFileSync(join(data, 'code-installation.txt'), 'utf8').trim();
    const r = await x.auth('recover', { ws: 'principal', email: 'Double@exemple.org', code, password: 'nouveau1' });
    expect(r.json.accounts).toBe(2);
    expect((await x.auth('login', { ws: 'principal', email: 'double@exemple.org', password: 'nouveau1' })).status).toBe(200);
    expect((await x.auth('login', { ws: 'autrebase', email: 'double@exemple.org', password: 'nouveau1' })).status).toBe(200);
    expect((await x.auth('login', { ws: 'principal', email: 'double@exemple.org', password: 'ancien' })).status).toBe(401);
    expect((await x.auth('recover', { ws: 'principal', email: 'personne@exemple.org', code, password: 'nouveau1' })).status).toBe(404);
  });
  it('déconnexion', async () => {
    await collegue.auth('logout', { ws: 'principal' });
    expect((await collegue.sync('ping', undefined, '&ws=principal')).status).toBe(401);
  });
  it('les scripts n’utilisent rien des pages internes du site', async () => {
    for (const f of ['_fabevent.php', 'auth.php', 'sync.php', 'mail.php', 'public.php', 'oauth.php', 'diag.php']) {
      const src = readFileSync(resolve('server', f), 'utf8');
      expect(src.includes("interne/_lib"), f).toBe(false);
    }
  });
});
