import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const req = createRequire(import.meta.url);
const { start } = req('../server/server.cjs');
const { createDocs, validMarkup } = req('../server/docs.cjs');

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

describe('shared documents', () => {
  let id: string;

  it('requires authentication', async () => {
    expect((await call('GET', '/api/docs')).code).toBe(401);
    expect((await call('POST', '/api/docs?name=a.pdf', undefined, undefined, PDF)).code).toBe(401);
  });

  it('uploads a PDF and another user opens identical bytes', async () => {
    const up = await call('POST', '/api/docs?member=bob%40example.com&name=' + encodeURIComponent('..\\Plan A'), ann, undefined, PDF);
    expect(up.code).toBe(201);
    expect(up.doc).toMatchObject({ name: 'Plan A.pdf', owner: 'Ann Lee' });
    id = up.doc.id;
    const list = await call('GET', '/api/docs', bob);
    expect(list.docs.map((d: any) => d.id)).toContain(id);
    const f = await call('GET', `/api/docs/${id}/file`, bob);
    expect(f.code).toBe(200);
    expect(Buffer.compare(f.bytes, PDF)).toBe(0);
  });

  it('rejects non-PDF uploads and unknown ids', async () => {
    expect((await call('POST', '/api/docs?name=x.pdf', ann, undefined, Buffer.from('hello world, not a pdf'))).code).toBe(400);
    expect((await call('GET', '/api/docs/nope/state', ann)).code).toBe(404);
  });

  it('restricts new uploads and all document routes to explicitly selected users', async () => {
    const up = await call('POST', '/api/docs?name=private.pdf', ann, undefined, PDF);
    const privateId = up.doc.id;
    expect((await call('GET', '/api/docs', bob)).docs.map((d: any) => d.id)).not.toContain(privateId);
    for (const [method, suffix] of [['GET', 'file'], ['GET', 'state'], ['GET', 'events?since=0&pr=0'], ['POST', 'ops'], ['POST', 'leave'], ['POST', 'meta'], ['DELETE', '']]) {
      expect((await call(method, `/api/docs/${privateId}${suffix ? '/' + suffix : ''}`, bob, method === 'POST' ? {} : undefined)).code).toBe(403);
    }
    expect((await call('GET', `/api/docs/${privateId}/file`, admin)).code).toBe(403);
    expect((await call('POST', `/api/docs/${privateId}/members`, bob, { members: ['bob@example.com'] })).code).toBe(403);
    expect((await call('POST', `/api/docs/${privateId}/members`, ann, { members: ['missing@example.com'] })).code).toBe(400);
    expect((await call('POST', `/api/docs/${privateId}/members`, ann, { members: ['bob@example.com'] })).code).toBe(200);
    expect((await call('GET', `/api/docs/${privateId}/file`, bob)).bytes).toEqual(PDF);
    const state = await call('GET', `/api/docs/${privateId}/state`, bob);
    const waiting = call('GET', `/api/docs/${privateId}/events?since=${state.version}&pr=${state.pr}`, bob);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect((await call('POST', `/api/docs/${privateId}/members`, ann, { members: [] })).code).toBe(200);
    expect((await waiting).code).toBe(403);
    expect((await call('GET', `/api/docs/${privateId}/state`, bob)).code).toBe(403);
    await call('DELETE', `/api/docs/${privateId}`, ann);
  });

  it('restricts legacy documents to their uploader until access is granted', () => {
    const docsDir = join(dir, 'legacy-access');
    const owner = { email: 'ann@example.com', name: 'Ann Lee', role: 'user' };
    const other = { email: 'bob@example.com', name: 'Bob Ray', role: 'user' };
    const store = createDocs({ dir: docsDir });
    const doc = store.upload(owner, 'legacy.pdf', PDF)[1].doc;
    const file = join(docsDir, doc.id + '.json');
    const record = JSON.parse(readFileSync(file, 'utf8'));
    delete record.members;
    writeFileSync(file, JSON.stringify(record));
    const legacy = createDocs({ dir: docsDir });
    expect(legacy.file(doc.id, other)[0]).toBe(403);
    expect(legacy.setMembers(doc.id, owner, ['bob@example.com'])[0]).toBe(200);
    expect(createDocs({ dir: docsDir }).file(doc.id, other)[0]).toBe(200);
  });

  it('persists markups with author attribution and validates input', async () => {
    const r = await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [mk('m1')] });
    expect(r.version).toBe(1);
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [{ ...mk('m2'), type: 'evil' }] })).code).toBe(400);
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [mk('bad id!')] })).code).toBe(400);
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [mk('m3', { points: [{ x: NaN, y: 1 }] })] })).code).toBe(400);
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [{ ...mk('m7'), comments: undefined }] })).code).toBe(400);
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [mk('line-drawing', { type: 'line' })] })).code).toBe(200);
    expect((await call('POST', `/api/docs/${id}/ops`, ann, {
      upserts: [mk('line-comment', { type: 'line', comments: [{ id: 'c1', author: 'A', date: '2026-01-01', text: 'not review' }] })],
    })).code).toBe(400);
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { deletes: ['line-drawing'] })).code).toBe(200);
    const s = await call('GET', `/api/docs/${id}/state`, bob);
    expect(s.markups).toHaveLength(1);
    expect(s.version).toBe(3);
    expect(validMarkup(mk('ok'))).toBeFalsy();
  });

  it('syncs ops between two clients, serialized by version', async () => {
    const a = await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [mk('m4')], deletes: ['m1'] });
    const b = await call('POST', `/api/docs/${id}/ops`, bob, { upserts: [mk('m5')] });
    expect(b.version).toBe(a.version + 1);
    const ev = await call('GET', `/api/docs/${id}/events?since=${a.version - 1}&pr=0`, ann);
    expect(ev.ops.map((o: any) => [o.v, o.by])).toEqual([[a.version, 'Ann Lee'], [b.version, 'Bob Ray']]);
    expect(ev.ops[0].deletes).toEqual(['m1']);
    const st = await call('GET', `/api/docs/${id}/state`, ann);
    expect(st.markups.map((m: any) => m.id).sort()).toEqual(['m4', 'm5']);
  });

  it('long poll wakes on a remote change', async () => {
    const cur = await call('GET', `/api/docs/${id}/state`, ann);
    const waiting = call('GET', `/api/docs/${id}/events?since=${cur.version}&pr=${cur.pr}`, ann);
    await new Promise((r) => setTimeout(r, 30));
    await call('POST', `/api/docs/${id}/ops`, bob, { upserts: [mk('m6')] });
    const ev = await waiting;
    expect(ev.ops[0].upserts[0].id).toBe('m6');
  });

  it('sends a reset with full state when the client version is unknown', async () => {
    const ev = await call('GET', `/api/docs/${id}/events?since=9999&pr=0`, ann);
    expect(ev.reset).toBe(true);
    expect(ev.markups.length).toBeGreaterThan(0);
  });

  it('tracks presence: join, leave and expiry', async () => {
    clock += 5000; // earlier activity expires
    const s1 = await call('GET', `/api/docs/${id}/state`, ann);
    expect(s1.presence.map((p: any) => p.email)).toEqual(['ann@example.com']);
    const s2 = await call('GET', `/api/docs/${id}/state`, bob);
    expect(s2.presence.map((p: any) => p.name).sort()).toEqual(['Ann Lee', 'Bob Ray']);
    expect(s2.presence[0]).toHaveProperty('discipline');
    await call('POST', `/api/docs/${id}/leave`, bob);
    const s3 = await call('GET', `/api/docs/${id}/events?since=${s2.version}&pr=0`, ann);
    expect(s3.presence.map((p: any) => p.email)).toEqual(['ann@example.com']);
    clock += 5000; // Ann stops heartbeating
    const s4 = await call('GET', `/api/docs/${id}/state`, bob);
    expect(s4.presence.map((p: any) => p.email)).toEqual(['bob@example.com']);
  });

  it('persists across a server restart', async () => {
    srv.server.closeAllConnections();
    srv.server.close();
    srv = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'u.json'), now: () => clock, regLimit: 100, pollMs: 150, presenceTtlMs: 1000 });
    base = 'http://127.0.0.1:' + srv.port;
    // sessions are in memory, so log in again
    const t = (await call('POST', '/api/login', undefined, { email: 'bob@example.com', password: 'correct horse' })).token;
    const st = await call('GET', `/api/docs/${id}/state`, t);
    expect(st.markups.map((m: any) => m.id).sort()).toEqual(['m4', 'm5', 'm6']);
    expect(Buffer.compare((await call('GET', `/api/docs/${id}/file`, t)).bytes, PDF)).toBe(0);
    bob = t;
    ann = (await call('POST', '/api/login', undefined, { email: 'ann@example.com', password: 'correct horse' })).token;
    admin = (await call('POST', '/api/login', undefined, { email: 'admin', password: 'NewAdminPass1' })).token;
  });

  it('stamps authorship from the session, ignoring client-supplied authors', async () => {
    const forged = mk('au1', { author: 'Forged', comments: [{ id: 'c1', author: 'Forged', date: 'x', text: 'hi' }] });
    await call('POST', `/api/docs/${id}/ops`, bob, { upserts: [forged] });
    let st = await call('GET', `/api/docs/${id}/state`, ann);
    let m = st.markups.find((x: any) => x.id === 'au1');
    expect(m.author).toBe('Bob Ray');
    expect(m.comments[0].author).toBe('Bob Ray');
    // Another user cannot edit this markup or rewrite its comment authors.
    const edit = { ...m, author: 'Ann Lee', color: '#00ff00', comments: [{ ...m.comments[0], author: 'Ann Lee' }, { id: 'c2', author: 'Zed', date: 'x', text: 'yo' }] };
    const denied = await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [edit] });
    expect(denied.code).toBe(403);
    st = await call('GET', `/api/docs/${id}/state`, bob);
    m = st.markups.find((x: any) => x.id === 'au1');
    expect([m.author, m.color]).toEqual(['Bob Ray', '#ff0000']);
    expect(m.comments.map((c: any) => c.author)).toEqual(['Bob Ray']);
    await call('POST', `/api/docs/${id}/ops`, bob, { deletes: ['au1'] });
  });

  it('groups uploads into projects with sanitized relative folders', async () => {
    const up = async (name: string, project: string, rel: string) =>
      call('POST', `/api/docs?member=bob%40example.com&name=${encodeURIComponent(name)}&project=${encodeURIComponent(project)}&rel=${encodeURIComponent(rel)}`, ann, undefined, PDF);
    const a = await up('A-101.pdf', 'Tower B', 'Arch/Level 1');
    const b = await up('S-201.pdf', 'Tower B', '..\\..\\Struct//L2');
    const c = await up('M-1.pdf', '<script>x', '');
    expect(a.doc).toMatchObject({ project: 'Tower B', rel: 'Arch/Level 1' });
    expect(b.doc.rel).toBe('Struct/L2');
    expect(c.doc.project).toBe('_script_x');
    const list = await call('GET', '/api/docs', bob);
    expect(list.docs.filter((d: any) => d.project === 'Tower B')).toHaveLength(2);
    expect((await call('POST', '/api/docs?name=bad.pdf&project=Tower%20B', ann, undefined, Buffer.from('not a pdf at all'))).code).toBe(400);
    expect((await call('POST', '/api/docs?name=n.pdf&project=P', undefined, undefined, PDF)).code).toBe(401);
    for (const x of [a, b, c]) await call('DELETE', `/api/docs/${x.doc.id}`, ann);
  });

  it('accepts a large markup batch (more than the old 16 KB limit)', async () => {
    const up = await call('POST', '/api/docs?member=bob%40example.com&name=big.pdf', ann, undefined, PDF);
    const many = Array.from({ length: 400 }, (_, i) => mk('big' + i, { text: 'x'.repeat(100) }));
    const r = await call('POST', `/api/docs/${up.doc.id}/ops`, ann, { upserts: many });
    expect(r.ok).toBe(true);
    expect((await call('GET', `/api/docs/${up.doc.id}/state`, bob)).markups).toHaveLength(400);
    await call('DELETE', `/api/docs/${up.doc.id}`, ann);
  });

  it('upload route accepts every query shape the client sends (regression: "Not found.")', async () => {
    const name = 'NAR-FPS-ST-DWG-0001.001.pdf';
    const qs = [
      `name=${encodeURIComponent(name)}&project=&rel=`,
      `name=${encodeURIComponent(name)}&project=${encodeURIComponent('NAR FPS')}&rel=${encodeURIComponent('Struct/L1')}`,
      `name=${encodeURIComponent(name)}`,
    ];
    for (const q of qs) {
      const r = await call('POST', '/api/docs?' + q, ann, undefined, PDF);
      expect(r.code).toBe(201);
      expect(r.doc.name).toBe(name);
      await call('DELETE', `/api/docs/${r.doc.id}`, ann);
    }
    expect((await call('GET', '/api/health')).docs).toBe(true);
  });

  it("rejects a collaborator changing another author's markup or comments", async () => {
    const up = await call('POST', '/api/docs?member=bob%40example.com&name=ids.pdf', ann, undefined, PDF);
    const base = mk('stable-1', { comments: [{ id: 'cm1', author: 'x', date: 'd', text: 'one' }] });
    await call('POST', `/api/docs/${up.doc.id}/ops`, ann, { upserts: [base] });
    const seen = (await call('GET', `/api/docs/${up.doc.id}/state`, bob)).markups[0];
    const changed = await call('POST', `/api/docs/${up.doc.id}/ops`, bob, { upserts: [{ ...seen, comments: [...seen.comments, { id: 'cm2', author: 'y', date: 'd', text: 'two' }] }] });
    expect(changed.code).toBe(403);
    const m = (await call('GET', `/api/docs/${up.doc.id}/state`, ann)).markups;
    expect(m).toHaveLength(1);
    expect(m[0].id).toBe('stable-1');
    expect(m[0].comments.map((c: any) => [c.id, c.author])).toEqual([['cm1', 'Ann Lee']]);
    await call('DELETE', `/api/docs/${up.doc.id}`, ann);
  });

  it('only the owner or an admin can delete', async () => {
    expect((await call('DELETE', `/api/docs/${id}`, bob)).code).toBe(403);
    expect((await call('DELETE', `/api/docs/${id}`, ann)).ok).toBe(true);
    expect((await call('GET', `/api/docs/${id}/state`, ann)).code).toBe(404);
    const up = await call('POST', '/api/docs?member=admin&name=b.pdf', bob, undefined, PDF);
    expect((await call('DELETE', `/api/docs/${up.doc.id}`, admin)).ok).toBe(true);
  });

  it('blocks pending users from shared documents', async () => {
    await call('POST', '/api/register', undefined, { name: 'Cy', email: 'cy@example.com', discipline: 'Other', password: 'correct horse', confirm: 'correct horse' });
    expect((await call('POST', '/api/login', undefined, { email: 'cy@example.com', password: 'correct horse' })).token).toBeUndefined();
  });
});
