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
