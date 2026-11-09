import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { start } = require('../server/server.cjs');
const { createDocs } = require('../server/docs.cjs');
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
const annUser = { email: 'ann@example.com', name: 'Ann', role: 'user' };
let dir: string, server: any, base: string, admin: string, ann: string, bob: string;

function faultFs() {
  let fault: ((operation: string, target: string) => void) | undefined;
  return {
    fs: {
      ...fs,
      renameSync(from: string, to: string) {
        fault?.('rename', String(to));
        return fs.renameSync(from, to);
      },
      rmSync(target: string, options: any) {
        fault?.('rm', String(target));
        return fs.rmSync(target, options);
      },
    },
    setFault(value?: (operation: string, target: string) => void) { fault = value; },
  };
}
const injected = faultFs();

async function call(method: string, path: string, token?: string, body?: any, raw?: Buffer) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(raw ? {} : { 'Content-Type': 'application/json' }) },
    body: raw as any || (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { status: res.status, ...await res.json() };
}
const removeGroup = async (token: string | undefined, project: any) => {
  const list = await call('GET', '/api/docs', token);
  const revision = list.docs?.find((d: any) => d.project === project)?.deleteGroupRevision || '0'.repeat(64);
  return call('POST', '/api/docs/groups/delete', token, { project, revision });
};
const upload = (token: string, project: string) => call('POST', `/api/docs?name=plan.pdf&member=admin&member=ann%40example.com&member=bob%40example.com&project=${encodeURIComponent(project)}`, token, undefined, PDF);

beforeAll(async () => {
  dir = mkdtempSync(join(process.cwd(), '.group-delete-test-'));
  server = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'users.json'), adminPassword: 'InitialAdmin1', docsFs: injected.fs });
  base = `http://127.0.0.1:${server.port}`;
  const login = await call('POST', '/api/login', undefined, { email: 'admin', password: 'InitialAdmin1' });
  admin = login.token;
  expect((await removeGroup(admin, 'Missing')).status).toBe(403);
  await call('POST', '/api/change-password', admin, { current: 'InitialAdmin1', password: 'NewAdminPass1' });
  async function add(email: string) {
    await call('POST', '/api/register', undefined, { name: email, email, discipline: 'Other', password: 'password1' });
    await call('POST', '/api/admin/update', admin, { email, action: 'approve' });
    return (await call('POST', '/api/login', undefined, { email, password: 'password1' })).token;
  }
  ann = await add('ann@example.com');
  bob = await add('bob@example.com');
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('shared group deletion', () => {
  it('requires authentication and validates exact nonempty group names', async () => {
    expect((await removeGroup(undefined, 'Missing')).status).toBe(401);
    for (const name of ['', ' ', '.', '../outside', 'bad/name', '<bad>', 'x'.repeat(81), 123, null, ' Valid ']) {
      expect((await removeGroup(ann, name)).status).toBe(400);
    }
    expect((await removeGroup(ann, 'Missing')).status).toBe(404);
  });

  it('only allows the owner of every document, and updates the per-user listing', async () => {
    const a = (await upload(ann, 'Owned')).doc;
    const b = (await upload(ann, 'Owned')).doc;
    const ungrouped = (await upload(ann, '')).doc;
    for (const [token, allowed] of [[ann, true], [bob, false], [admin, true]] as const) {
      const docs = (await call('GET', '/api/docs', token)).docs;
      expect(docs.find((d: any) => d.id === a.id).canDeleteGroup).toBe(allowed);
      expect(docs.find((d: any) => d.id === b.id).canDeleteGroup).toBe(allowed);
      expect(docs.find((d: any) => d.id === ungrouped.id).canDeleteGroup).toBe(false);
    }
    expect((await removeGroup(bob, 'Owned')).status).toBe(403);
    expect(await removeGroup(ann, 'Owned')).toMatchObject({ status: 200, ok: true, project: 'Owned', count: 2 });
    for (const doc of [a, b]) {
      expect((await call('GET', `/api/docs/${doc.id}/state`, ann)).status).toBe(404);
      expect(existsSync(join(dir, 'docs', doc.id + '.pdf'))).toBe(false);
      expect(existsSync(join(dir, 'docs', doc.id + '.json'))).toBe(false);
    }
    expect((await call('GET', `/api/docs/${ungrouped.id}/state`, ann)).status).toBe(200);
  });

  it('denies both uploaders of a mixed group but allows an administrator', async () => {
    const a = (await upload(ann, 'Mixed')).doc;
    const b = (await upload(bob, 'Mixed')).doc;
    for (const [token, allowed] of [[ann, false], [bob, false], [admin, true]] as const) {
      const docs = (await call('GET', '/api/docs', token)).docs;
      for (const d of [a, b]) expect(docs.find((item: any) => item.id === d.id).canDeleteGroup).toBe(allowed);
    }
    expect((await removeGroup(ann, 'Mixed')).status).toBe(403);
    expect((await removeGroup(bob, 'Mixed')).status).toBe(403);
    for (const d of [a, b]) {
      expect(existsSync(join(dir, 'docs', d.id + '.pdf'))).toBe(true);
      expect(existsSync(join(dir, 'docs', d.id + '.json'))).toBe(true);
    }
    expect(await removeGroup(admin, 'Mixed')).toMatchObject({ status: 200, count: 2 });
    for (const d of [a, b]) {
      expect(existsSync(join(dir, 'docs', d.id + '.pdf'))).toBe(false);
      expect(existsSync(join(dir, 'docs', d.id + '.json'))).toBe(false);
    }
  });

  it('rejects stale confirmations after a group changes', async () => {
    await upload(ann, 'Stale');
    const before = (await call('GET', '/api/docs', ann)).docs.find((d: any) => d.project === 'Stale').deleteGroupRevision;
    await upload(ann, 'Stale');
    expect((await call('POST', '/api/docs/groups/delete', ann, { project: 'Stale', revision: before })).status).toBe(409);
    expect((await call('GET', '/api/docs', ann)).docs.filter((d: any) => d.project === 'Stale')).toHaveLength(2);
  });

  it('does not delete anything when the journal cannot be committed', () => {
    const docsDir = join(dir, 'uncommitted');
    const faults = faultFs();
    const docs = createDocs({ dir: docsDir, fs: faults.fs });
    const doc = docs.upload(annUser, 'a.pdf', PDF, { project: 'Group' })[1].doc;
    faults.setFault((op, target) => {
      if (op === 'rename' && target.endsWith('.group-delete-journal')) throw new Error('injected failure');
    });
    expect(() => docs.deleteGroup(annUser, { project: 'Group', revision: docs.list(annUser)[1].docs[0].deleteGroupRevision })).toThrow();
    expect(docs.isAvailable()).toBe(true);
    expect(readFileSync(join(docsDir, doc.id + '.pdf'))).toEqual(PDF);
    expect(createDocs({ dir: docsDir }).list(annUser)[1].docs).toHaveLength(1);
  });

  it('fails closed after partial deletion and completes recovery before serving after restart', async () => {
    const a = (await upload(ann, 'Failure')).doc;
    const b = (await upload(ann, 'Failure')).doc;
    let removes = 0;
    injected.setFault((op, target) => {
      if (op === 'rm' && (target.endsWith('.pdf') || target.endsWith('.json')) && ++removes === 3) throw new Error('injected failure');
    });
    try {
      expect((await removeGroup(ann, 'Failure')).status).toBe(503);
      expect((await call('GET', '/api/docs', ann)).status).toBe(503);
      expect((await upload(ann, 'Failure')).status).toBe(503);
      expect(existsSync(join(dir, 'docs', '.group-delete-journal'))).toBe(true);
    } finally {
      injected.setFault();
    }
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
    server = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'users.json') });
    base = `http://127.0.0.1:${server.port}`;
    admin = (await call('POST', '/api/login', undefined, { email: 'admin', password: 'NewAdminPass1' })).token;
    expect((await call('GET', '/api/docs', admin)).docs.some((d: any) => [a.id, b.id].includes(d.id))).toBe(false);
    expect(existsSync(join(dir, 'docs', '.group-delete-journal'))).toBe(false);
    for (const d of [a, b]) for (const ext of ['.pdf', '.json']) expect(existsSync(join(dir, 'docs', d.id + ext))).toBe(false);
  });

  it('rejects invalid recovery journals instead of deleting arbitrary paths', () => {
    const docsDir = join(dir, 'invalid');
    const docs = createDocs({ dir: docsDir });
    const doc = docs.upload(annUser, 'a.pdf', PDF, { project: 'Group' })[1].doc;
    writeFileSync(join(docsDir, '.group-delete-journal'), JSON.stringify({ ids: ['../outside'], project: 'Group' }));
    expect(() => createDocs({ dir: docsDir })).toThrow(/Invalid group delete journal/);
    expect(existsSync(join(docsDir, doc.id + '.pdf'))).toBe(true);
  });

  it('wakes active long polls with not found when their document is deleted', async () => {
    const docs = createDocs({ dir: join(dir, 'poll'), pollMs: 30000 });
    const doc = docs.upload(annUser, 'a.pdf', PDF, { project: 'Poll' })[1].doc;
    const state = docs.state(doc.id, annUser)[1];
    const waiting = docs.events(doc.id, annUser, state.version, state.pr);
    expect(docs.deleteGroup(annUser, { project: 'Poll', revision: docs.list(annUser)[1].docs[0].deleteGroupRevision })[0]).toBe(200);
    expect((await waiting)[0]).toBe(404);
  });

  it('fails pending polls closed and retries recovery on subsequent starts', async () => {
    const docsDir = join(dir, 'retry');
    const faults = faultFs();
    const docs = createDocs({ dir: docsDir, fs: faults.fs, pollMs: 30000 });
    const doc = docs.upload(annUser, 'a.pdf', PDF, { project: 'Retry' })[1].doc;
    const state = docs.state(doc.id, annUser)[1];
    const waiting = docs.events(doc.id, annUser, state.version, state.pr);
    faults.setFault((op, target) => {
      if (op === 'rm' && target.endsWith('.json')) throw new Error('injected failure');
    });
    expect(docs.deleteGroup(annUser, { project: 'Retry', revision: docs.list(annUser)[1].docs[0].deleteGroupRevision })[0]).toBe(503);
    expect((await waiting)[0]).toBe(503);
    expect(() => createDocs({ dir: docsDir, fs: faults.fs })).toThrow();
    expect(existsSync(join(docsDir, '.group-delete-journal'))).toBe(true);
    faults.setFault();
    expect(createDocs({ dir: docsDir }).list(annUser)[1].docs).toHaveLength(0);
    expect(existsSync(join(docsDir, '.group-delete-journal'))).toBe(false);
  });
});
