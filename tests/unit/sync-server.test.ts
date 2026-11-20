import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/* Serveur de synchro réel (PHP + SQLite), avec une connexion simulée. Ignoré si PHP n'est pas installé. */
const hasPhp = spawnSync('php', ['-v']).status === 0;
const port = 5600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}/sync.php`;
let php: ChildProcess;

const call = async (action: string, user: string | null, body?: unknown, params = '') => {
  const r = await fetch(`${base}?action=${action}${params}`, {
    method: body ? 'POST' : 'GET', body: body ? JSON.stringify(body) : undefined,
    headers: { 'Content-Type': 'application/json', ...(user ? { 'X-Test-User': user } : {}) },
  });
  return { status: r.status, json: await r.json() };
};

describe.skipIf(!hasPhp)('serveur de synchronisation (sync.php)', () => {
  beforeAll(async () => {
    const data = mkdtempSync(join(tmpdir(), 'fabsync-'));
    php = spawn('php', ['-S', `127.0.0.1:${port}`, '-t', resolve('server')], {
      env: { ...process.env, FABEVENT_AUTH: resolve('tests/server/auth-stub.php'), FABEVENT_DATA: data }, stdio: 'ignore',
    });
    for (let i = 0; i < 50; i++) { try { await fetch(base); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  });
  afterAll(() => { php?.kill(); });

  it('refuse sans connexion', async () => {
    expect((await call('ping', null)).status).toBe(401);
  });
  it('un appareil envoie, un autre reçoit ; le plus récent l’emporte', async () => {
    const r1 = await call('push', 'nico', { ws: 'principal', changes: [{ t: 'contacts', id: 'c1', d: { id: 'c1', company: 'Ville de Namur', updatedAt: '2026-11-20T10:00:00Z' }, u: '2026-11-20T10:00:00Z' }] });
    expect(r1.json.applied).toBe(1);
    // modification plus ancienne (appareil resté hors ligne) : ignorée
    const r2 = await call('push', 'collegue', { ws: 'principal', changes: [{ t: 'contacts', id: 'c1', d: { id: 'c1', company: 'Ancien nom', updatedAt: '2026-11-19T10:00:00Z' }, u: '2026-11-19T10:00:00Z' }] });
    expect(r2.json.skipped).toBe(1);
    const p = await call('pull', 'collegue', undefined, '&ws=principal&since=0');
    expect(p.json.changes).toHaveLength(1);
    expect(p.json.changes[0].d.company).toBe('Ville de Namur');
    // rien de neuf depuis le dernier numéro reçu
    expect((await call('pull', 'collegue', undefined, `&ws=principal&since=${p.json.seq}`)).json.changes).toHaveLength(0);
  });
  it('suppression transmise ; tables inconnues refusées', async () => {
    await call('push', 'nico', { ws: 'principal', changes: [{ t: 'contacts', id: 'c1', d: null, u: '2026-11-21T10:00:00Z' }, { t: 'pirate', id: 'x', d: {}, u: '2026-11-21T10:00:00Z' }] });
    const p = await call('pull', 'nico', undefined, '&ws=principal&since=0');
    expect(p.json.changes).toEqual([{ t: 'contacts', id: 'c1', d: null, u: '2026-11-21T10:00:00Z' }]);
  });
  it('espaces séparés : un compte sans accès commun ne voit pas les données', async () => {
    expect((await call('pull', 'externe', undefined, '&ws=principal&since=0')).json.changes).toHaveLength(0);
  });
  it('numéros de facture sans doublon entre appareils', async () => {
    const a = await call('next', 'nico', { ws: 'principal', key: 'F-2026', min: 4 });
    const b = await call('next', 'collegue', { ws: 'principal', key: 'F-2026', min: 4 });
    expect([a.json.n, b.json.n]).toEqual([4, 5]);
  });
});
