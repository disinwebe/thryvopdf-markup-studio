import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupByProject } from '../src/app/upload';
import { canDeleteMarkup } from '../src/core/comments';

const req = createRequire(import.meta.url);
const { start } = req('../server/server.cjs');

const ADMIN_PW = 'InitialAdmin1';
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
let dir: string, srv: any, base: string;
let admin: string, ann: string, bob: string;

const call = async (method: string, p: string, token?: string, body?: any, raw?: Buffer) => {
  const r = await fetch(base + p, {
    method,
    headers: { ...(raw ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: (raw as any) ?? (body ? JSON.stringify(body) : undefined),
  });
  return { code: r.status, ...(await r.json()) } as any;
};
const mk = (id: string, extra: any = {}) => ({ id, type: 'rect', page: 0, points: [{ x: 1, y: 2 }, { x: 30, y: 40 }], color: '#ff0000', width: 2, opacity: 1, author: 'spoof', authorEmail: 'spoof@x', date: '2026-01-01T00:00:00Z', status: 'None', comments: [], ...extra });
const user = async (name: string, email: string) => {
  await call('POST', '/api/register', undefined, { name, email, discipline: 'Structural', password: 'correct horse', confirm: 'correct horse' });
  await call('POST', '/api/admin/update', admin, { email, action: 'approve' });
  return (await call('POST', '/api/login', undefined, { email, password: 'correct horse' })).token as string;
};
const upload = (tok: string, name: string, project = '', description = '') =>
  call('POST', `/api/docs?member=bob%40example.com&member=admin&name=${encodeURIComponent(name)}&project=${encodeURIComponent(project)}&description=${encodeURIComponent(description)}`, tok, undefined, PDF);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'pms-groups-'));
  srv = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'u.json'), adminPassword: ADMIN_PW, now: () => Date.now(), regLimit: 100, pollMs: 150, presenceTtlMs: 1000 });
  base = 'http://127.0.0.1:' + srv.server.address().port;
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

describe('author-only markup deletion', () => {
  it('syncs comment box dimensions and visibility while rejecting invalid sizes', async () => {
    const id = (await upload(ann, 'box.pdf')).doc.id;
    const markup = mk('box1', { calloutSize: { width: 220, height: 110 }, calloutHidden: true });
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [markup] })).code).toBe(200);
    const shared = (await call('GET', `/api/docs/${id}/state`, bob)).markups[0];
    expect(shared.calloutSize).toEqual({ width: 220, height: 110 });
    expect(shared.calloutHidden).toBe(true);
    expect((await call('POST', `/api/docs/${id}/ops`, bob, { upserts: [{ ...shared, calloutSize: { width: -1, height: 110 } }] })).code).toBe(400);
  });
  it('stores per-comment sizes and rejects out-of-range or foreign-author changes', async () => {
    const id = (await upload(ann, 'comment-size.pdf')).doc.id;
    const markup = mk('font-size', { comments: [{ id: 'comment1', author: 'spoof', date: '2026-01-01', text: 'first', fontSize: 14 }] });
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [markup] })).code).toBe(200);
    const shared = (await call('GET', `/api/docs/${id}/state`, bob)).markups[0];
    expect(shared.comments[0]).toMatchObject({ fontSize: 14, author: 'Ann Lee', authorEmail: 'ann@example.com' });
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [{ ...shared, comments: [{ ...shared.comments[0], fontSize: 19 }] }] })).code).toBe(400);
    expect((await call('POST', `/api/docs/${id}/ops`, bob, { upserts: [{ ...shared, comments: [{ ...shared.comments[0], fontSize: 10 }] }] })).code).toBe(403);
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [{ ...shared, comments: [{ ...shared.comments[0], fontSize: 10 }] }] })).code).toBe(200);
    expect((await call('GET', `/api/docs/${id}/state`, bob)).markups[0].comments[0].fontSize).toBe(10);
  });
  it('stamps authorEmail server-side and lets only the author delete', async () => {
    const id = (await upload(ann, 'a.pdf')).doc.id;
    await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [mk('m1')] });
    const m = (await call('GET', `/api/docs/${id}/state`, bob)).markups[0];
    expect([m.author, m.authorEmail]).toEqual(['Ann Lee', 'ann@example.com']);
    for (const tok of [bob, admin]) {
      const r = await call('POST', `/api/docs/${id}/ops`, tok, { deletes: ['m1'] });
      expect(r.code).toBe(403);
      expect(r.forbidden).toBe(true);
    }
    expect((await call('GET', `/api/docs/${id}/state`, bob)).markups).toHaveLength(1);
    expect((await call('POST', `/api/docs/${id}/ops`, ann, { deletes: ['m1'] })).code).toBe(200);
    expect((await call('GET', `/api/docs/${id}/state`, bob)).markups).toHaveLength(0);
  });

  it('keeps the original author when another user edits the markup', async () => {
    const id = (await upload(ann, 'b.pdf')).doc.id;
    await call('POST', `/api/docs/${id}/ops`, ann, { upserts: [mk('m1')] });
    await call('POST', `/api/docs/${id}/ops`, bob, { upserts: [mk('m1', { color: '#00ff00', author: 'Bob Ray', authorEmail: 'bob@example.com' })] });
    const m = (await call('GET', `/api/docs/${id}/state`, ann)).markups[0];
    expect([m.color, m.authorEmail]).toEqual(['#00ff00', 'ann@example.com']);
  });

  it('mirrors the rule in the client helper', () => {
    const m: any = { author: 'Ann Lee', authorEmail: 'ann@example.com' };
    expect(canDeleteMarkup(m, { name: 'Ann Lee', email: 'ann@example.com', role: 'user' } as any)).toBe(true);
    expect(canDeleteMarkup(m, { name: 'Root', email: 'admin', role: 'admin' } as any)).toBe(false);
    expect(canDeleteMarkup({ author: 'Old' } as any, { name: 'Old', email: 'o@x', role: 'user' } as any)).toBe(true);
  });
});

describe('shared library groups and descriptions', () => {
  it('stores and lists group and description, sanitised and length-limited', async () => {
    const r = await upload(ann, 'g1.pdf', 'Tower A', 'Issued for construction');
    expect(r.doc.project).toBe('Tower A');
    expect(r.doc.description).toBe('Issued for construction');
    const long = await upload(ann, 'g2.pdf', 'Tower A', 'x'.repeat(900));
    expect(long.doc.description).toHaveLength(500);
    const list = (await call('GET', '/api/docs', bob)).docs;
    expect(list.find((d: any) => d.name === 'g1.pdf')).toMatchObject({ project: 'Tower A', description: 'Issued for construction' });
  });

  it('requires authentication', async () => {
    expect((await call('GET', '/api/docs')).code).toBe(401);
    expect((await call('POST', '/api/docs/abc/meta', undefined, { project: 'x' })).code).toBe(401);
  });

  it('lets the uploader or an admin regroup and describe; others are forbidden', async () => {
    const id = (await upload(ann, 'g3.pdf', 'Old', 'first')).doc.id;
    const bad = await call('POST', `/api/docs/${id}/meta`, bob, { project: 'Hijack' });
    expect(bad.code).toBe(403);
    const ok = await call('POST', `/api/docs/${id}/meta`, ann, { project: 'Tower B', description: 'second' });
    expect(ok.doc).toMatchObject({ project: 'Tower B', description: 'second' });
    const adm = await call('POST', `/api/docs/${id}/meta`, admin, { project: 'Tower C/<x>' });
    expect(adm.code).toBe(200);
    expect(adm.doc.project).not.toMatch(/[\/<>]/);
    const seen = (await call('GET', '/api/docs', bob)).docs.find((d: any) => d.id === id);
    expect(seen.description).toBe('second');
    expect((await call('POST', '/api/docs/nope/meta', ann, {})).code).toBe(404);
  });
});

describe('grouping helper for the Project tab', () => {
  it('groups by project with ungrouped last and sorted files', () => {
    const g = groupByProject([
      { name: 'b.pdf', project: 'Z' },
      { name: 'x.pdf' },
      { name: 'a.pdf', project: 'Z' },
      { name: 'c.pdf', project: 'A' },
    ]);
    expect(g.map((x) => x.project)).toEqual(['A', 'Z', '']);
    expect(g[1].docs.map((d) => d.name)).toEqual(['a.pdf', 'b.pdf']);
  });
});
