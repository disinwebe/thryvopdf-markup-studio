import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const { start } = req('../server/server.cjs');
const { validMarkup } = req('../server/docs.cjs');

const ADMIN_PW = 'InitialAdmin1';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
let dir: string, srv: any, base: string, clock: number;
let admin: string, ann: string, bob: string;

const call = async (method: string, p: string, token?: string, body?: any, raw?: Buffer) => {
  const r = await fetch(base + p, {
    method,
    headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: (raw as any) ?? (body ? JSON.stringify(body) : undefined),
  });
  const type = r.headers.get('content-type') || '';
  if (type.includes('json')) return { code: r.status, ...(await r.json()) };
  return { code: r.status, bytes: Buffer.from(await r.arrayBuffer()) } as any;
};
const mk = (id: string, extra: any = {}) => ({ id, type: 'rect', page: 0, points: [{ x: 1, y: 2 }, { x: 30, y: 40 }], color: '#ff0000', width: 2, opacity: 1, author: 'T', date: '2026-01-01T00:00:00Z', status: 'None', comments: [], ...extra });

const user = async (name: string, email: string) => {
  await call('POST', '/api/register', undefined, { name, email, discipline: 'Structural', password: 'correct horse', confirm: 'correct horse' });
  await call('POST', '/api/admin/update', admin, { email, action: 'approve' });
  return (await call('POST', '/api/login', undefined, { email, password: 'correct horse' })).token as string;
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pms-shared-'));
  clock = Date.now();
  srv = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'u.json'), adminPassword: ADMIN_PW, now: () => clock, regLimit: 100, pollMs: 150, presenceTtlMs: 1000 });
  base = 'http://127.0.0.1:' + srv.port;
  const l = await call('POST', '/api/login', undefined, { email: 'admin', password: ADMIN_PW });
  await call('POST', '/api/change-password', l.token, { current: ADMIN_PW, password: 'NewAdminPass1' });
  admin = (await call('POST', '/api/login', undefined, { email: 'admin', password: 'NewAdminPass1' })).token;
  ann = await user('Ann Lee', 'ann@example.com');
  bob = await user('Bob Ray', 'bob@example.com');
});
afterAll(() => {
  srv.server.close();
  rmSync(dir, { recursive: true, force: true });
});


describe('comment callouts: authorization and sync', () => {
  let id: string;
  const cm = (cid: string, text: string) => ({ id: cid, author: 'spoof', authorEmail: 'spoof@x', date: '2026-01-02T00:00:00Z', text });
  const ops = (tok: string, b: any) => call('POST', '/api/docs/' + id + '/ops', tok, b);
  const state = async (tok: string) => (await call('GET', '/api/docs/' + id + '/state', tok)).markups;

  beforeAll(async () => {
    id = (await call('POST', '/api/docs?name=c.pdf', ann, undefined, PDF)).doc.id;
    await ops(ann, { upserts: [mk('m1', { callout: { x: 100, y: 50 }, comments: [cm('c1', 'Ann says')] })] });
    await ops(bob, { upserts: [mk('m1', { callout: { x: 100, y: 50 }, comments: [cm('c1', 'Ann says'), cm('c2', 'Bob says')] })] });
  });

  it('stamps comment author and email from the session, not the client', async () => {
    const m = (await state(bob)).find((x: any) => x.id === 'm1');
    expect(m.comments.map((c: any) => [c.author, c.authorEmail])).toEqual([['Ann Lee', 'ann@example.com'], ['Bob Ray', 'bob@example.com']]);
  });

  it('persists and syncs the moved callout box position', async () => {
    const m = (await state(ann)).find((x: any) => x.id === 'm1');
    const r = await ops(bob, { upserts: [{ ...m, callout: { x: 222, y: 33 } }] });
    expect(r.code).toBe(200);
    expect((await state(ann)).find((x: any) => x.id === 'm1').callout).toEqual({ x: 222, y: 33 });
    expect((await call('POST', '/api/docs/' + id + '/ops', ann, { upserts: [mk('m1', { callout: { x: 'a', y: 1 } })] })).code).toBe(400);
  });

  it('lets the author edit their comment and marks it edited', async () => {
    const m = (await state(ann)).find((x: any) => x.id === 'm1');
    const r = await ops(ann, { upserts: [{ ...m, comments: m.comments.map((c: any) => (c.id === 'c1' ? { ...c, text: 'Ann fixed' } : c)) }] });
    expect(r.code).toBe(200);
    const c1 = (await state(bob)).find((x: any) => x.id === 'm1').comments.find((c: any) => c.id === 'c1');
    expect(c1.text).toBe('Ann fixed');
    expect(c1.edited).toBeTruthy();
  });

  it('forbids editing another user\'s comment, including an administrator', async () => {
    for (const tok of [bob, admin]) {
      const m = (await state(ann)).find((x: any) => x.id === 'm1');
      const r = await ops(tok, { upserts: [{ ...m, comments: m.comments.map((c: any) => (c.id === 'c1' ? { ...c, text: 'hijack' } : c)) }] });
      expect(r.code).toBe(403);
      expect(r.forbidden).toBe(true);
      expect(r.current[0].comments.find((c: any) => c.id === 'c1').text).toBe('Ann fixed');
    }
  });

  it('forbids deleting another user\'s comment or a markup carrying it, enforced server-side', async () => {
    const m = (await state(ann)).find((x: any) => x.id === 'm1');
    const r = await ops(bob, { upserts: [{ ...m, comments: m.comments.filter((c: any) => c.id !== 'c1') }] });
    expect(r.code).toBe(403);
    expect((await ops(bob, { deletes: ['m1'] })).code).toBe(403);
    expect((await state(ann)).find((x: any) => x.id === 'm1').comments).toHaveLength(2);
  });

  it('lets an author delete their own comment; only the markup author may delete the markup (admin cannot)', async () => {
    let m = (await state(bob)).find((x: any) => x.id === 'm1');
    expect((await ops(bob, { upserts: [{ ...m, comments: m.comments.filter((c: any) => c.id !== 'c2') }] })).code).toBe(200);
    m = (await state(ann)).find((x: any) => x.id === 'm1');
    expect(m.comments.map((c: any) => c.id)).toEqual(['c1']);
    expect((await ops(bob, { deletes: ['m1'] })).code).toBe(403);
    const denied = await ops(admin, { deletes: ['m1'] });
    expect(denied.code).toBe(403);
    expect(denied.current[0].id).toBe('m1');
    expect((await ops(ann, { deletes: ['m1'] })).code).toBe(200);
    expect(await state(ann)).toHaveLength(0);
  });
});
