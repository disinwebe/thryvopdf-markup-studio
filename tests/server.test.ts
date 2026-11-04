import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const { start, createApp } = req('../server/server.cjs');
const { createClient } = req('../electron/client.cjs');

const good = { name: 'Ann Lee', email: 'Ann@Example.com', discipline: 'Structural', password: 'correct horse', confirm: 'correct horse' };
const ADMIN_PW = 'InitialAdmin1';
let dir: string, srv: any, base: string, clock: number;
const call = (method: string, p: string, body?: any, token?: string) =>
  fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ code: r.status, ...(await r.json()) }));
const post = (p: string, body: any, token?: string) => call('POST', p, body, token);
const get = (p: string, token?: string) => call('GET', p, undefined, token);

let adminToken: string;
const adminLogin = async () => {
  const l = await post('/api/login', { email: 'admin', password: ADMIN_PW });
  expect(l.user.mustChange).toBe(true);
  const c = await post('/api/change-password', { current: ADMIN_PW, password: 'NewAdminPass1' }, l.token);
  expect(c.ok).toBe(true);
  return l.token as string;
};
const act = (email: string, action: string, role?: string) => post('/api/admin/update', { email, action, role }, adminToken);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pms-srv-'));
  clock = Date.now();
  srv = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'u.json'), adminPassword: ADMIN_PW, maxFails: 3, sessionTtlMs: 5000, now: () => clock, regLimit: 100 });
  base = 'http://127.0.0.1:' + srv.port;
});
afterAll(() => {
  srv.server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('default admin seeding', () => {
  it('seeds admin from PMS_ADMIN_PASSWORD, forces change, no plaintext stored', () => {
    expect(srv.seeded).toMatchObject({ email: 'admin', generated: false });
    const raw = readFileSync(join(dir, 'u.json'), 'utf8');
    expect(raw).not.toContain(ADMIN_PW);
    expect(JSON.parse(raw).users[0]).toMatchObject({ email: 'admin', role: 'admin', status: 'active', mustChange: true });
  });

  it('generates a random password and writes a file when none is given; does not reseed', () => {
    const d2 = mkdtempSync(join(tmpdir(), 'pms-seed-'));
    const f = join(d2, 'u.json');
    const a = createApp({ file: f });
    expect(a.seeded.generated).toBe(true);
    expect(a.seeded.password).toHaveLength(16);
    expect(existsSync(a.seeded.file)).toBe(true);
    expect(readFileSync(a.seeded.file, 'utf8')).toContain(a.seeded.password);
    expect(createApp({ file: f }).seeded).toBeNull();
    expect(() => createApp({ file: join(d2, 'x.json'), adminPassword: 'short' })).toThrow();
    rmSync(d2, { recursive: true, force: true });
  });

  it('forced password change gates admin actions until changed', async () => {
    const l = await post('/api/login', { email: 'admin', password: ADMIN_PW });
    expect((await get('/api/admin/users', l.token)).code).toBe(403);
    expect((await post('/api/change-password', { current: 'wrong', password: 'NewAdminPass1' }, l.token)).code).toBe(401);
    expect((await post('/api/change-password', { current: ADMIN_PW, password: 'short' }, l.token)).code).toBe(400);
    adminToken = await adminLogin().catch(async () => {
      // already satisfied above: login again with the new password
      return '';
    });
    const again = await post('/api/login', { email: 'admin', password: 'NewAdminPass1' });
    expect(again.user.mustChange).toBe(false);
    adminToken = again.token;
    expect((await post('/api/login', { email: 'admin', password: ADMIN_PW })).code).toBe(401);
    expect((await get('/api/admin/users', adminToken)).ok).toBe(true);
  });
});

describe('approval workflow', () => {
  it('registration is pending and cannot log in until approved', async () => {
    const r = await post('/api/register', good);
    expect(r).toMatchObject({ code: 201, ok: true, pending: true });
    expect(r.token).toBeUndefined();
    const l = await post('/api/login', { email: 'ann@example.com', password: 'correct horse' });
    expect(l).toMatchObject({ code: 403, status: 'pending' });
    expect(l.error).toMatch(/awaiting administrator approval/);
    expect((await post('/api/login', { email: 'ann@example.com', password: 'wrong wrong' })).code).toBe(401);
  });

  it('validates input and rejects duplicate emails', async () => {
    expect((await post('/api/register', { ...good, email: 'x' })).code).toBe(400);
    expect((await post('/api/register', { ...good, email: 'n@e.com', password: 'short' })).code).toBe(400);
    expect((await post('/api/register', { ...good, name: '' })).code).toBe(400);
    expect((await post('/api/register', { ...good, email: 'ANN@example.com' })).code).toBe(409);
    expect((await post('/api/register', { ...good, email: 'admin' })).code).toBe(400);
  });

  it('approve -> login works; disable -> blocked and session killed; enable -> works', async () => {
    expect((await act('ann@example.com', 'approve')).ok).toBe(true);
    const l = await post('/api/login', { email: 'ann@example.com', password: 'correct horse' });
    expect(l).toMatchObject({ code: 200, user: { role: 'user', status: 'active' } });
    expect((await get('/api/session', l.token)).ok).toBe(true);
    expect((await act('ann@example.com', 'disable')).ok).toBe(true);
    expect((await get('/api/session', l.token)).code).toBe(401);
    expect((await post('/api/login', { email: 'ann@example.com', password: 'correct horse' })).error).toMatch(/disabled/);
    expect((await act('ann@example.com', 'enable')).ok).toBe(true);
    expect((await post('/api/login', { email: 'ann@example.com', password: 'correct horse' })).code).toBe(200);
  });

  it('reject blocks login with a clear message', async () => {
    await post('/api/register', { ...good, email: 'rej@example.com' });
    expect((await act('rej@example.com', 'reject')).ok).toBe(true);
    expect((await post('/api/login', { email: 'rej@example.com', password: 'correct horse' })).error).toMatch(/rejected/);
  });
});

describe('role enforcement', () => {
  it('non-admins and anonymous callers cannot use admin endpoints', async () => {
    const u = await post('/api/login', { email: 'ann@example.com', password: 'correct horse' });
    expect((await get('/api/admin/users', u.token)).code).toBe(403);
    expect((await post('/api/admin/update', { email: 'rej@example.com', action: 'approve' }, u.token)).code).toBe(403);
    expect((await get('/api/admin/users')).code).toBe(401);
  });

  it('list shows status and never secrets', async () => {
    const r = await get('/api/admin/users', adminToken);
    expect(r.users.map((x: any) => x.status).sort()).toContain('rejected');
    expect(JSON.stringify(r)).not.toMatch(/hash|salt/);
  });

  it('role changes apply immediately; last admin and self are protected', async () => {
    const u = await post('/api/login', { email: 'ann@example.com', password: 'correct horse' });
    expect((await act('ann@example.com', 'role', 'admin')).ok).toBe(true);
    expect((await get('/api/admin/users', u.token)).ok).toBe(true);
    expect((await act('ann@example.com', 'role', 'user')).ok).toBe(true);
    expect((await get('/api/admin/users', u.token)).code).toBe(403);
    expect((await act('admin', 'disable')).code).toBe(400);
    expect((await act('admin', 'delete')).code).toBe(400);
    expect((await act('admin', 'role', 'user')).code).toBe(400);
    expect((await act('ann@example.com', 'role', 'root')).code).toBe(400);
    expect((await act('nobody@example.com', 'approve')).code).toBe(404);
  });

  it('reset gives a temporary password that must be changed; delete removes the user', async () => {
    const old = await post('/api/login', { email: 'ann@example.com', password: 'correct horse' });
    const r = await act('ann@example.com', 'reset');
    expect(r.tempPassword).toBeTruthy();
    expect((await get('/api/session', old.token)).code).toBe(401);
    expect((await post('/api/login', { email: 'ann@example.com', password: 'correct horse' })).code).toBe(401);
    const l = await post('/api/login', { email: 'ann@example.com', password: r.tempPassword });
    expect(l.user.mustChange).toBe(true);
    expect((await post('/api/change-password', { current: r.tempPassword, password: 'ann new pass 1' }, l.token)).user.mustChange).toBe(false);
    expect((await act('ann@example.com', 'delete')).ok).toBe(true);
    expect((await post('/api/login', { email: 'ann@example.com', password: 'ann new pass 1' })).code).toBe(401);
  });
});

describe('sessions and lockout', () => {
  it('expires sessions and logs out', async () => {
    const l = await post('/api/login', { email: 'admin', password: 'NewAdminPass1' });
    await post('/api/logout', {}, l.token);
    expect((await get('/api/session', l.token)).code).toBe(401);
    const l2 = await post('/api/login', { email: 'admin', password: 'NewAdminPass1' });
    clock += 6000;
    expect((await get('/api/session', l2.token)).code).toBe(401);
  });

  it('locks out after repeated failures, even for the right password, then recovers', async () => {
    for (let i = 0; i < 3; i++) expect((await post('/api/login', { email: 'admin', password: 'bad pass word' })).code).toBe(401);
    expect((await post('/api/login', { email: 'admin', password: 'NewAdminPass1' })).code).toBe(429);
    clock += 16 * 60 * 1000;
    expect((await post('/api/login', { email: 'admin', password: 'NewAdminPass1' })).code).toBe(200);
  });
});

describe('electron client against server', () => {
  const mk = (n: string) => createClient({ configFile: join(dir, n + '-cfg.json'), localFile: join(dir, n + '-local.json') });

  it('register (pending) on one profile, admin approves, login from another profile', async () => {
    const a = mk('a'), adm = mk('adm'), b = mk('b');
    await a.configure({ mode: 'server', serverUrl: `127.0.0.1:${srv.port}/` });
    const r = await a.register({ ...good, email: 'bob@example.com', name: 'Bob' });
    expect(r).toMatchObject({ ok: true, pending: true });
    expect(a.current()).toBeNull();
    expect((await a.login({ email: 'bob@example.com', password: 'correct horse' })).error).toMatch(/awaiting/);

    await adm.configure({ mode: 'server', serverUrl: base });
    expect((await adm.login({ email: 'admin', password: 'NewAdminPass1' })).ok).toBe(true);
    const list = await adm.adminList();
    expect(list.users.find((u: any) => u.email === 'bob@example.com').status).toBe('pending');
    expect((await adm.adminAction({ email: 'bob@example.com', action: 'approve' })).ok).toBe(true);

    await b.configure({ mode: 'server', serverUrl: base });
    expect((await b.login({ email: 'bob@example.com', password: 'correct horse' })).ok).toBe(true);
    expect(b.current().role).toBe('user');
    expect((await b.adminList()).ok).toBe(false);
  });

  it('forces password change in the client: gated until changed', async () => {
    const c = mk('c');
    await c.configure({ mode: 'server', serverUrl: base });
    const fresh = (await post('/api/login', { email: 'admin', password: 'NewAdminPass1' })).token;
    await post('/api/admin/update', { email: 'bob@example.com', action: 'reset' }, fresh).then(async (t: any) => {
      const l = await c.login({ email: 'bob@example.com', password: t.tempPassword });
      expect(l.user.mustChange).toBe(true);
      expect(c.current()).toBeNull();
      expect((await c.changePassword({ current: t.tempPassword, password: 'bob new pass 1', confirm: 'nope nope' })).ok).toBe(false);
      const ch = await c.changePassword({ current: t.tempPassword, password: 'bob new pass 1', confirm: 'bob new pass 1' });
      expect(ch.error).toBeUndefined();
      expect(ch.ok).toBe(true);
      expect(c.current().email).toBe('bob@example.com');
    });
  });

  it('reports a clear error when the server is offline and does not save it', async () => {
    const c = mk('off');
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
