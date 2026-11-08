import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { start } = require('../server/server.cjs');
const { createDocs } = require('../server/docs.cjs');
const { createClient } = require('../electron/client.cjs');
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
let dir: string, server: any, base: string, admin: string, ann: string, bob: string, outsider: string;

function faultFs() {
  let fault: ((from: unknown, to: unknown) => void) | undefined;
  return {
    fs: {
      ...fs,
      renameSync(from: unknown, to: unknown) {
        if (fault) fault(from, to);
        return fs.renameSync(from, to);
      },
    },
    setFault(value?: (from: unknown, to: unknown) => void) { fault = value; },
  };
}
const serverFs = faultFs();

async function call(method: string, path: string, token?: string, body?: any, raw?: Buffer) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? {} : { 'Content-Type': 'application/json' }) },
    body: raw as any || (body === undefined ? undefined : JSON.stringify(body)),
  });
  const type = res.headers.get('content-type') || '';
  return type.includes('json') ? { status: res.status, ...await res.json() } : { status: res.status, bytes: Buffer.from(await res.arrayBuffer()) };
}
const rename = (token: string | undefined, project: string, newProject: any) => call('POST', '/api/docs/groups/rename', token, { project, newProject });
const upload = (token: string, project: string, name: string, rel = '', description = '') =>
  call('POST', `/api/docs?name=${encodeURIComponent(name)}&project=${encodeURIComponent(project)}&rel=${encodeURIComponent(rel)}&description=${encodeURIComponent(description)}`, token, undefined, PDF);

beforeAll(async () => {
  dir = mkdtempSync(join(process.cwd(), '.group-rename-test-'));
  server = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'users.json'), adminPassword: 'InitialAdmin1', docsFs: serverFs.fs });
  base = `http://127.0.0.1:${server.port}`;
  const login = await call('POST', '/api/login', undefined, { email: 'admin', password: 'InitialAdmin1' });
  await call('POST', '/api/change-password', login.token, { current: 'InitialAdmin1', password: 'NewAdminPass1' });
  admin = login.token;
  async function add(email: string, name = email) {
    await call('POST', '/api/register', undefined, { name, email, discipline: 'Other', password: 'password1' });
    await call('POST', '/api/admin/update', admin, { email, action: 'approve' });
    return (await call('POST', '/api/login', undefined, { email, password: 'password1' })).token;
  }
  ann = await add('ann@example.com');
  bob = await add('bob@example.com');
  outsider = await add('other@example.com', 'ann@example.com');
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.server.close(() => resolve()));
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe('shared group rename', () => {
  it('routes the desktop client rename operation to the authenticated server', async () => {
    const client = createClient({ configFile: join(dir, 'client-config.json'), localFile: join(dir, 'local-users.json') });
    expect((await client.configure({ mode: 'server', serverUrl: base })).ok).toBe(true);
    expect((await client.login({ email: 'admin', password: 'NewAdminPass1' })).ok).toBe(true);
    const doc = (await upload(admin, 'Client Group', 'client.pdf')).doc;
    expect(await client.docs({ op: 'rename-group', project: 'Client Group', newProject: 'Client Renamed' })).toMatchObject({ ok: true, count: 1 });
    expect((await client.docs({ op: 'list' })).docs.find((d: any) => d.id === doc.id).project).toBe('Client Renamed');
    await client.logout();
  });

  it('renames every mixed-owner document for a member, preserving metadata, bytes and markups across restart', async () => {
    const a = (await upload(ann, 'Original', 'a.pdf', 'Arch/L1', 'first')).doc;
    const b = (await upload(bob, 'Original', 'b.pdf', 'Struct/L2', 'second')).doc;
    for (const token of [ann, bob, admin, outsider]) {
      const docs = (await call('GET', '/api/docs', token)).docs;
      for (const doc of [a, b]) expect(docs.find((d: any) => d.id === doc.id).canRenameGroup).toBe(token !== outsider);
    }
    const markup = { id: 'm1', type: 'rect', page: 0, points: [], color: 'red', width: 1, opacity: 1, author: '', date: '', status: '', comments: [] };
    expect((await call('POST', `/api/docs/${a.id}/ops`, ann, { upserts: [markup] })).status).toBe(200);
    expect((await rename(undefined, 'Original', 'Renamed')).status).toBe(401);
    expect((await rename(outsider, 'Original', 'Renamed')).status).toBe(403);
    expect(await rename(bob, 'Original', 'Renamed')).toMatchObject({ status: 200, project: 'Original', newProject: 'Renamed', count: 2 });
    const listed = (await call('GET', '/api/docs', ann)).docs;
    expect(listed.find((d: any) => d.id === a.id)).toMatchObject({ project: 'Renamed', description: 'first', rel: 'Arch/L1' });
    expect(listed.find((d: any) => d.id === b.id)).toMatchObject({ project: 'Renamed', description: 'second', rel: 'Struct/L2' });
    expect((await call('GET', `/api/docs/${a.id}/file`, bob)).bytes).toEqual(PDF);
    expect((await call('GET', `/api/docs/${a.id}/state`, bob)).markups[0].id).toBe('m1');
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
    server = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'users.json'), docsFs: serverFs.fs });
    base = `http://127.0.0.1:${server.port}`;
    admin = (await call('POST', '/api/login', undefined, { email: 'admin', password: 'NewAdminPass1' })).token;
    ann = (await call('POST', '/api/login', undefined, { email: 'ann@example.com', password: 'password1' })).token;
    bob = (await call('POST', '/api/login', undefined, { email: 'bob@example.com', password: 'password1' })).token;
    outsider = (await call('POST', '/api/login', undefined, { email: 'other@example.com', password: 'password1' })).token;
    const persisted = (await call('GET', '/api/docs', admin)).docs;
    expect(persisted.find((d: any) => d.id === a.id)).toMatchObject({ project: 'Renamed', description: 'first', rel: 'Arch/L1' });
    expect(persisted.find((d: any) => d.id === b.id)).toMatchObject({ project: 'Renamed', description: 'second', rel: 'Struct/L2' });
    expect((await call('GET', `/api/docs/${a.id}/state`, bob)).markups[0].id).toBe('m1');
    expect((await call('GET', `/api/docs/${b.id}/file`, ann)).bytes).toEqual(PDF);
    expect((await rename(admin, 'Renamed', 'Admin renamed')).status).toBe(200);
  });

  it('rejects invalid names, absent groups, unchanged names and case-insensitive collisions without changing documents', async () => {
    const a = (await upload(ann, 'Validation', 'validation.pdf')).doc;
    await upload(bob, 'Existing', 'existing.pdf');
    for (const name of ['', ' ', '.', '../outside', 'bad/name', '<bad>', 'x'.repeat(81), 123, null]) {
      expect((await rename(ann, 'Validation', name)).status).toBe(400);
    }
    expect((await rename(ann, '', 'New')).status).toBe(400);
    expect((await rename(ann, 'Missing', 'New')).status).toBe(404);
    expect((await rename(ann, 'Validation', 'Validation')).status).toBe(400);
    expect((await rename(ann, 'Validation', 'existing')).status).toBe(409);
    expect((await call('GET', '/api/docs', ann)).docs.find((d: any) => d.id === a.id).project).toBe('Validation');
    expect((await rename(ann, 'Validation', 'validation')).status).toBe(200);
  });

  it('serializes competing uploads and rename with no partially renamed pre-existing documents', async () => {
    const first = (await upload(ann, 'Concurrent', 'first.pdf')).doc;
    const [renamed, uploaded] = await Promise.all([rename(ann, 'Concurrent', 'Concurrent new'), upload(bob, 'Concurrent', 'second.pdf')]);
    expect(renamed.status).toBe(200);
    expect(uploaded.status).toBe(201);
    const docs = (await call('GET', '/api/docs', ann)).docs;
    expect(docs.find((d: any) => d.id === first.id).project).toBe('Concurrent new');
    const second = docs.find((d: any) => d.id === uploaded.doc.id);
    expect(second.project).toBe(renamed.count === 2 ? 'Concurrent new' : 'Concurrent');
  });

  it('recovers a committed rename after a partial disk failure before serving the library', () => {
    const docsDir = join(dir, 'recovery');
    const user = { email: 'a@example.com', name: 'A', role: 'user' };
    const injected = faultFs();
    const docs = createDocs({ dir: docsDir, fs: injected.fs });
    const a = docs.upload(user, 'a.pdf', PDF, { project: 'Old', description: 'keep', rel: 'A/B' })[1].doc;
    const b = docs.upload(user, 'b.pdf', PDF, { project: 'Old', description: 'keep2', rel: 'C/D' })[1].doc;
    let writes = 0;
    injected.setFault((_from, to) => {
      if (String(to).endsWith('.json') && ++writes === 2) throw new Error('injected failure');
    });
    expect(docs.renameGroup(user, { project: 'Old', newProject: 'New' })[0]).toBe(503);
    expect(docs.isAvailable()).toBe(false);
    expect(existsSync(join(docsDir, '.group-rename-journal'))).toBe(true);
    const recovered = createDocs({ dir: docsDir });
    expect(recovered.isAvailable()).toBe(true);
    expect(existsSync(join(docsDir, '.group-rename-journal'))).toBe(false);
    for (const [doc, description, rel] of [[a, 'keep', 'A/B'], [b, 'keep2', 'C/D']]) {
      expect(JSON.parse(readFileSync(join(docsDir, doc.id + '.json'), 'utf8'))).toMatchObject({ project: 'New', description, rel });
      expect(readFileSync(join(docsDir, doc.id + '.pdf'))).toEqual(PDF);
    }
    expect(recovered.list(user)[1].docs.map((d: any) => d.project)).toEqual(['New', 'New']);
  });

  it('does not alter the library if the journal cannot be committed', () => {
    const docsDir = join(dir, 'uncommitted');
    const user = { email: 'a@example.com', name: 'A', role: 'user' };
    const injected = faultFs();
    const docs = createDocs({ dir: docsDir, fs: injected.fs });
    const doc = docs.upload(user, 'a.pdf', PDF, { project: 'Old' })[1].doc;
    injected.setFault((_from, to) => {
      if (String(to).endsWith('.group-rename-journal')) throw new Error('injected failure');
    });
    expect(() => docs.renameGroup(user, { project: 'Old', newProject: 'New' })).toThrow();
    expect(docs.isAvailable()).toBe(true);
    expect(docs.list(user)[1].docs[0].project).toBe('Old');
    expect(JSON.parse(readFileSync(join(docsDir, doc.id + '.json'), 'utf8')).project).toBe('Old');
    expect(createDocs({ dir: docsDir }).list(user)[1].docs[0].project).toBe('Old');
  });

  it('fails closed over HTTP after a partial write and recovers on restart', async () => {
    const a = (await upload(ann, 'Failure', 'fail-a.pdf')).doc;
    const b = (await upload(bob, 'Failure', 'fail-b.pdf')).doc;
    let writes = 0;
    serverFs.setFault((_from, to) => {
      if (String(to).endsWith('.json') && ++writes === 2) throw new Error('injected failure');
    });
    try {
      const independent = createDocs({ dir: join(dir, 'independent') });
      expect(independent.upload({ email: 'independent@example.com', name: 'Independent', role: 'user' }, 'a.pdf', PDF, { project: 'Other' })[0]).toBe(201);
      expect(writes).toBe(0);
      expect((await rename(ann, 'Failure', 'Recovered')).status).toBe(503);
      expect((await call('GET', '/api/docs', ann)).status).toBe(503);
      expect((await upload(ann, 'Failure', 'blocked.pdf')).status).toBe(503);
    } finally {
      serverFs.setFault();
    }
    await new Promise<void>((resolve) => server.server.close(() => resolve()));
    server = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'users.json') });
    base = `http://127.0.0.1:${server.port}`;
    admin = (await call('POST', '/api/login', undefined, { email: 'admin', password: 'NewAdminPass1' })).token;
    const docs = (await call('GET', '/api/docs', admin)).docs;
    expect(docs.find((d: any) => d.id === a.id).project).toBe('Recovered');
    expect(docs.find((d: any) => d.id === b.id).project).toBe('Recovered');
  });
});
