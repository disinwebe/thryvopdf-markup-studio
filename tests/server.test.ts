import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const { start } = req('../server/server.cjs');
const { createClient } = req('../electron/client.cjs');

const good = { name: 'Ann Lee', email: 'Ann@Example.com', discipline: 'Structural', password: 'correct horse', confirm: 'correct horse' };
let dir: string, srv: any, base: string, clock: number;
const post = (p: string, body: any, token?: string) =>
  fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) }).then(async (r) => ({ code: r.status, ...(await r.json()) }));
const get = (p: string, headers: any = {}) => fetch(base + p, { headers }).then(async (r) => ({ code: r.status, ...(await r.json()) }));

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pms-srv-'));
  clock = Date.now();
  srv = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'u.json'), adminToken: 'adm', maxFails: 3, sessionTtlMs: 1000, now: () => clock, regLimit: 100 });
  base = 'http://127.0.0.1:' + srv.port;
});
afterAll(() => {
  srv.server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('auth server', () => {
  it('health reports no users, then register creates account + session', async () => {
    expect((await get('/api/health')).hasUsers).toBe(false);
    const r = await post('/api/register', good);
    expect(r).toMatchObject({ code: 201, ok: true, user: { name: 'Ann Lee', email: 'ann@example.com' } });
    expect(r.token).toHaveLength(64);
    expect((await get('/api/health')).hasUsers).toBe(true);
  });

  it('stores only salted scrypt hashes', () => {
    const raw = readFileSync(join(dir, 'u.json'), 'utf8');
    expect(raw).not.toContain('correct horse');
    expect(JSON.parse(raw).users[0]).toMatchObject({ salt: expect.any(String), hash: expect.any(String) });
  });

  it('validates input and rejects duplicate emails', async () => {
    expect((await post('/api/register', { ...good, email: 'x' })).code).toBe(400);
    expect((await post('/api/register', { ...good, email: 'n@e.com', password: 'short' })).code).toBe(400);
    expect((await post('/api/register', { ...good, name: '' })).code).toBe(400);
    expect((await post('/api/register', { ...good, email: 'ANN@example.com' })).code).toBe(409);
  });

  it('logs in, validates session, logs out', async () => {
    const l = await post('/api/login', { email: 'ann@example.com', password: 'correct horse' });
    expect(l.ok).toBe(true);
    expect((await get('/api/session', { Authorization: 'Bearer ' + l.token })).user.email).toBe('ann@example.com');
    await post('/api/logout', {}, l.token);
    expect((await get('/api/session', { Authorization: 'Bearer ' + l.token })).code).toBe(401);
  });

  it('expires sessions', async () => {
    const l = await post('/api/login', { email: 'ann@example.com', password: 'correct horse' });
    clock += 2000;
    expect((await get('/api/session', { Authorization: 'Bearer ' + l.token })).code).toBe(401);
  });

  it('locks out after repeated failures, even for the right password', async () => {
    for (let i = 0; i < 3; i++) expect((await post('/api/login', { email: 'ann@example.com', password: 'bad pass word' })).code).toBe(401);
    expect((await post('/api/login', { email: 'ann@example.com', password: 'correct horse' })).code).toBe(429);
    clock += 16 * 60 * 1000;
    expect((await post('/api/login', { email: 'ann@example.com', password: 'correct horse' })).code).toBe(200);
  });

  it('user list needs the admin token and hides secrets', async () => {
    expect((await get('/api/users')).code).toBe(401);
    const r = await get('/api/users', { 'X-Admin-Token': 'adm' });
    expect(r.users).toHaveLength(1);
    expect(JSON.stringify(r)).not.toMatch(/hash|salt/);
  });
});

describe('electron client against server', () => {
  const mk = (n: string) => createClient({ configFile: join(dir, n + '-cfg.json'), localFile: join(dir, n + '-local.json') });

  it('registers on one profile and logs in from another', async () => {
    const a = mk('a');
    const b = mk('b');
    expect((await a.status()).configured).toBe(false);
    expect(await a.configure({ mode: 'server', serverUrl: `127.0.0.1:${srv.port}/` })).toEqual({ ok: true });
    const r = await a.register({ ...good, email: 'bob@example.com', name: 'Bob' });
    expect(r.ok).toBe(true);
    expect(a.current().name).toBe('Bob');
    await b.configure({ mode: 'server', serverUrl: base });
    expect(await b.login({ email: 'bob@example.com', password: 'wrong password' })).toMatchObject({ ok: false });
    expect(b.current()).toBeNull();
    expect((await b.login({ email: 'bob@example.com', password: 'correct horse' })).ok).toBe(true);
    await b.logout();
    expect(b.current()).toBeNull();
  });

  it('persists the server address', async () => {
    const c = createClient({ configFile: join(dir, 'a-cfg.json'), localFile: join(dir, 'a-local.json') });
    expect((await c.status())).toMatchObject({ mode: 'server', serverUrl: base, online: true, hasUsers: true });
  });

  it('reports a clear error when the server is offline and does not save it', async () => {
    const c = mk('c');
    const r = await c.configure({ mode: 'server', serverUrl: '127.0.0.1:1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Cannot reach the server/);
    expect((await c.status()).configured).toBe(false);
  });

  it('local mode is an explicit fallback', async () => {
    const c = mk('d');
    await c.configure({ mode: 'local' });
    expect((await c.register({ ...good, email: 'loc@example.com' })).ok).toBe(true);
    expect(c.current().email).toBe('loc@example.com');
  });
});
