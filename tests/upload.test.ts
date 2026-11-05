import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { groupByProject, runUploads, toRows } from '../src/app/upload';

const items = ['a', 'b', 'c'].map((n) => ({ token: n, name: n + '.pdf', rel: '', size: 1 }));

describe('multi-file upload queue', () => {
  it('uploads sequentially and keeps going after a failure', async () => {
    const seen: string[] = [];
    const rows = toRows(items);
    const patch = (k: string, p: object) => Object.assign(rows.find((r) => r.key === k)!, p);
    const res = await runUploads(
      items,
      async (i) => {
        seen.push(i.token);
        if (i.token === 'b') return { ok: false, error: 'The file is not a PDF.' };
        if (i.token === 'c') throw new Error('offline');
        return { ok: true };
      },
      patch,
    );
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(res).toEqual({ done: 1, failed: 2 });
    expect(rows.map((r) => [r.state, r.error])).toEqual([['done', undefined], ['error', 'The file is not a PDF.'], ['error', 'offline']]);
  });
});

describe('project grouping', () => {
  it('groups by project, unassigned last, folder order within', () => {
    const g = groupByProject([
      { name: 'z.pdf', project: '' },
      { name: 'b.pdf', project: 'Tower', rel: 'Struct' },
      { name: 'a.pdf', project: 'Tower', rel: 'Arch' },
      { name: 'c.pdf', project: 'Annex' },
    ]);
    expect(g.map((x) => x.project)).toEqual(['Annex', 'Tower', '']);
    expect(g[1].docs.map((d) => d.name)).toEqual(['a.pdf', 'b.pdf']);
  });
});

describe('older server without shared documents', () => {
  it('explains the 404 instead of a bare "Not found."', async () => {
    const { createClient } = createRequire(import.meta.url)('../electron/client.cjs');
    const dir = mkdtempSync(join(tmpdir(), 'pms-old-'));
    const json = (code: number, body: object) => ({ status: code, ok: code < 400, headers: new Headers(), json: async () => body });
    const fake = async (url: string) => {
      const p = new URL(url).pathname;
      if (p === '/api/health') return json(200, { ok: true, hasUsers: true });
      if (p === '/api/login') return json(200, { ok: true, token: 't', expiresAt: Date.now() + 1e6, user: { name: 'A', email: 'a@x', status: 'active' } });
      return json(404, { ok: false, error: 'Not found.' });
    };
    const c = createClient({ configFile: join(dir, 'c.json'), localFile: join(dir, 'l.json'), fetch: fake });
    await c.configure({ mode: 'server', serverUrl: 'http://old:8787' });
    await c.login({ email: 'a@x', password: 'p' });
    const r = await c.docs({ op: 'upload', name: 'a.pdf', bytes: Buffer.from('%PDF-1.4'), project: 'P', rel: 'x' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/older server version/);
    rmSync(dir, { recursive: true, force: true });
  });
});