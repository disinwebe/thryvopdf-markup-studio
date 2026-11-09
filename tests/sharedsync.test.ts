import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyOps, diffMarkups, syncedOf } from '../src/app/shared';

const req = createRequire(import.meta.url);
const { start } = req('../server/server.cjs');
const { createClient } = req('../electron/client.cjs');

const mk = (id: string, extra: any = {}): any => ({ id, type: 'rect', page: 0, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }], color: '#f00', width: 2, opacity: 1, author: 'T', date: '2026-01-01T00:00:00Z', status: 'None', comments: [], ...extra });

describe('sync logic', () => {
  it('detects local upserts and deletes against the server baseline', () => {
    const synced = syncedOf([mk('a'), mk('b')]);
    const d = diffMarkups([mk('a', { color: '#0f0' }), mk('c')], synced);
    expect(d.upserts.map((m) => m.id)).toEqual(['a', 'c']);
    expect(d.deletes).toEqual(['b']);
    expect(diffMarkups([mk('a'), mk('b')], synced)).toEqual({ upserts: [], deletes: [] });
  });

  it('applies remote ops, but own ops only advance the baseline', () => {
    const local = [mk('a', { color: '#local' })];
    const synced = syncedOf([mk('a')]);
    const r = applyOps(local, synced, [
      { v: 1, cid: 'me', upserts: [mk('a', { color: '#mine' })], deletes: [] },
      { v: 2, cid: 'other', upserts: [mk('n')], deletes: [] },
    ], 'me');
    expect(r.markups.map((m) => [m.id, m.color])).toEqual([['a', '#local'], ['n', '#f00']]);
    expect(diffMarkups(r.markups, r.synced).upserts.map((m) => m.id)).toEqual(['a']);
    const d = applyOps(r.markups, r.synced, [{ v: 3, cid: 'other', upserts: [], deletes: ['n'] }], 'me');
    expect(d.markups.map((m) => m.id)).toEqual(['a']);
  });
});

describe('client shared docs', () => {
  let dir: string, srv: any;
  const PDF = new Uint8Array(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF\n'));
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pms-cl-'));
    srv = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'u.json'), adminPassword: 'InitialAdmin1', regLimit: 100, pollMs: 100 });
  });
  afterAll(() => {
    srv.server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('upload on one profile, open and sync from another, local mode refused', async () => {
    const url = `127.0.0.1:${srv.port}`;
    const admin = createClient({ configFile: join(dir, 'ad.json'), localFile: join(dir, 'adl.json') });
    await admin.configure({ mode: 'server', serverUrl: url });
    await admin.login({ email: 'admin', password: 'InitialAdmin1' });
    await admin.changePassword({ current: 'InitialAdmin1', password: 'NewAdminPass1', confirm: 'NewAdminPass1' });
    await admin.login({ email: 'admin', password: 'NewAdminPass1' });
    const mkUser = async (n: string, email: string) => {
      const c = createClient({ configFile: join(dir, n + '.json'), localFile: join(dir, n + 'l.json') });
      await c.configure({ mode: 'server', serverUrl: url });
      await c.register({ name: n, email, discipline: 'Civil', password: 'correct horse', confirm: 'correct horse' });
      await admin.adminAction({ email, action: 'approve' });
      expect((await c.login({ email, password: 'correct horse' })).ok).toBe(true);
      return c;
    };
    const a = await mkUser('Ann', 'ann@example.com');
    const b = await mkUser('Bob', 'bob@example.com');
    const up = await a.docs({ op: 'upload', name: 'plan.pdf', bytes: PDF, members: ['bob@example.com'] });
    expect(up.ok).toBe(true);
    const id = up.doc.id;
    const open = await b.docs({ op: 'open', id });
    expect(open.ok).toBe(true);
    expect(Buffer.from(open.bytes).equals(Buffer.from(PDF))).toBe(true);
    await a.docs({ op: 'open', id });
    const joined = await a.docs({ op: 'open', id });
    const waiting = b.docs({ op: 'poll', id, since: joined.version, pr: joined.pr });
    await a.docs({ op: 'ops', id, upserts: [mk('x1')], cid: 'A' });
    const ev = await waiting;
    expect(ev.ops[0]).toMatchObject({ by: 'Ann', cid: 'A' });
    expect(ev.presence.map((p: any) => p.name).sort()).toEqual(['Ann', 'Bob']);

    const local = createClient({ configFile: join(dir, 'loc.json'), localFile: join(dir, 'locl.json') });
    await local.configure({ mode: 'local' });
    expect((await local.docs({ op: 'list' })).ok).toBe(false);
    await a.logout();
    expect((await a.docs({ op: 'list' })).ok).toBe(false);
  });
});
