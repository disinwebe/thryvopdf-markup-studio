import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { start } = require('../server/server.cjs');
const { sendMail } = require('../server/notify.cjs');
const { createClient } = require('../electron/client.cjs');
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
let dir: string, server: any, base: string, admin: string, ann: string, bob: string, cara: string;
const sent: any[] = [];

async function call(method: string, path: string, token?: string, body?: any, raw?: Buffer) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? {} : { 'Content-Type': 'application/json' }) },
    body: (raw as any) || (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { status: res.status, ...(await res.json()) };
}
const upload = (token: string, members: string[], name = 'plan.pdf') =>
  call('POST', `/api/docs?name=${encodeURIComponent(name)}${members.map((m) => '&member=' + encodeURIComponent(m)).join('')}`, token, undefined, PDF);

beforeAll(async () => {
  dir = mkdtempSync(join(process.cwd(), '.notify-test-'));
  fs.writeFileSync(join(dir, 'notify.json'), JSON.stringify({ smtp: { enabled: true, host: 'smtp.test', port: 25, from: 'ThryvoPDF <noreply@example.com>' } }));
  server = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'users.json'), adminPassword: 'InitialAdmin1', sendMail: async (_c: unknown, to: string, subject: string, text: string, _timeout: unknown, cc: string[] = []) => { sent.push({ to, subject, text, cc }); } });
  base = `http://127.0.0.1:${server.port}`;
  const login = await call('POST', '/api/login', undefined, { email: 'admin', password: 'InitialAdmin1' });
  await call('POST', '/api/change-password', login.token, { current: 'InitialAdmin1', password: 'NewAdminPass1' });
  admin = login.token;
  const add = async (email: string, name: string) => {
    await call('POST', '/api/register', undefined, { name, email, discipline: 'Other', password: 'password1' });
    await call('POST', '/api/admin/update', admin, { email, action: 'approve' });
    return (await call('POST', '/api/login', undefined, { email, password: 'password1' })).token;
  };
  ann = await add('ann@example.com', 'Ann');
  bob = await add('bob@example.com', 'Bob');
  cara = await add('cara@example.com', 'Cara');
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe('assignment notifications', () => {
  it('sends pending registration alerts through the admin inbox', async () => {
    const inbox = await call('GET', '/api/notifications', admin);
    expect(inbox.notifications.some((n: any) => n.type === 'registration' && n.message.includes('Cara'))).toBe(true);
  });

  it('alerts and emails assigned users on upload, not the uploader', async () => {
    const r = await upload(ann, ['ann@example.com', 'bob@example.com']);
    expect(r.status).toBe(201);
    await new Promise((res) => setTimeout(res, 50));
    expect(sent.map((s) => s.to)).toEqual(['bob@example.com']);
    expect(sent[0].subject).toContain('plan.pdf');
    const inbox = await call('GET', '/api/notifications', bob);
    expect(inbox.unread).toBe(1);
    expect(inbox.notifications[0].message).toContain('Ann');
    expect((await call('GET', '/api/notifications', ann)).unread).toBe(0);
    expect((await call('GET', '/api/notifications')).status).toBe(401);
  });

  it('notifies only newly added members and supports mark read', async () => {
    const up = await upload(ann, []);
    sent.length = 0;
    await call('POST', `/api/docs/${up.doc.id}/members`, ann, { members: ['bob@example.com'] });
    await call('POST', `/api/docs/${up.doc.id}/members`, ann, { members: ['bob@example.com', 'admin'] });
    await new Promise((res) => setTimeout(res, 50));
    expect(sent.map((s) => s.to)).toEqual(['bob@example.com']);
    const inbox = await call('GET', '/api/notifications', bob);
    expect(inbox.unread).toBe(2);
    const read = await call('POST', '/api/notifications/read', bob, { ids: [inbox.notifications[0].id] });
    expect(read.unread).toBe(1);
    expect((await call('POST', '/api/notifications/read', bob, { all: true })).unread).toBe(0);
  });

  it('clears only the signed-in user notification inbox', async () => {
    const up = await upload(ann, ['bob@example.com']);
    await new Promise((res) => setTimeout(res, 25));
    expect((await call('POST', '/api/notifications/clear')).status).toBe(401);
    const before = await call('GET', '/api/notifications', bob);
    expect(before.notifications.length).toBeGreaterThan(0);

    await call('POST', '/api/notifications/read', bob, { all: true });
    const cleared = await call('POST', '/api/notifications/clear', bob);
    expect(cleared).toMatchObject({ status: 200, notifications: [], unread: 0 });
    expect((await call('GET', '/api/notifications', bob)).notifications).toEqual([]);
    expect((await call('GET', '/api/notifications', admin)).notifications.length).toBeGreaterThan(0);
    expect((await call('GET', '/api/docs', ann)).docs.some((d: any) => d.id === up.doc.id)).toBe(true);
  });

  it('pushes new notifications to an authenticated client immediately', async () => {
    let resolveInitial: (() => void) | undefined;
    let resolveAssignment: (() => void) | undefined;
    const initial = new Promise<void>((resolve) => { resolveInitial = resolve; });
    const received = new Promise<void>((resolve) => { resolveAssignment = resolve; });
    const client = createClient({
      configFile: join(dir, 'live-client.json'),
      localFile: join(dir, 'live-local.json'),
      onNotifications: (snapshot: any) => {
        resolveInitial?.();
        if (snapshot.notifications.some((n: any) => n.type === 'assignment' && n.docName === 'live-update.pdf')) resolveAssignment?.();
      },
    });
    try {
      expect((await client.configure({ mode: 'server', serverUrl: base })).ok).toBe(true);
      expect((await client.login({ email: 'bob@example.com', password: 'password1' })).ok).toBe(true);
      await initial;
      const up = await upload(ann, ['bob@example.com'], 'live-update.pdf');
      expect(up.status).toBe(201);
      await received;
      const noAuth = await fetch(`${base}/api/notifications/stream`);
      expect(noAuth.status).toBe(401);
    } finally {
      await client.logout();
    }
  });

  it('tracks each assigned reviewer and reopens completion after markup changes', async () => {
    const up = await upload(ann, ['bob@example.com', 'cara@example.com']);
    const id = up.doc.id;
    sent.length = 0;
    expect((await call('GET', '/api/docs', bob)).docs.find((d: any) => d.id === id).reviews).toEqual([
      { email: 'bob@example.com', done: false, updated: null },
      { email: 'cara@example.com', done: false, updated: null },
    ]);

    const marked = await call('POST', `/api/docs/${id}/review`, bob, { done: true });
    expect(marked.status).toBe(200);
    await new Promise((res) => setTimeout(res, 25));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: 'ann@example.com', cc: ['bob@example.com', 'cara@example.com'] });
    expect(sent[0].subject).toContain('Review completed');
    expect(marked.reviews.find((r: any) => r.email === 'bob@example.com').done).toBe(true);
    expect(marked.reviews.find((r: any) => r.email === 'cara@example.com').done).toBe(false);
    const reviewAlert = await call('GET', '/api/notifications', cara);
    expect(reviewAlert.notifications[0].type).toBe('review');
    const ownerAlert = await call('GET', '/api/notifications', ann);
    expect(ownerAlert.notifications[0]).toMatchObject({
      type: 'review',
      by: 'Bob',
      message: 'Bob marked the review done for "plan.pdf".',
    });

    const reopened = await call('POST', `/api/docs/${id}/review`, bob, { done: false });
    expect(reopened.status).toBe(200);
    await new Promise((res) => setTimeout(res, 25));
    expect(sent).toHaveLength(2);
    expect(sent[1]).toMatchObject({ to: 'ann@example.com', cc: ['bob@example.com', 'cara@example.com'] });
    expect(sent[1].subject).toContain('Review reopened');
    expect(sent[1].text).toContain('Bob reopened their review for "plan.pdf".');
    expect((await call('GET', '/api/notifications', ann)).notifications[0]).toMatchObject({
      type: 'review',
      by: 'Bob',
      message: 'Bob reopened the review for "plan.pdf".',
    });

    const markup = {
      id: 'bob-markup',
      page: 0,
      type: 'text',
      points: [{ x: 1, y: 1 }, { x: 20, y: 20 }],
      color: '#ff0000',
      width: 2,
      opacity: 1,
      status: 'None',
      author: 'untrusted',
      date: new Date().toISOString(),
      comments: [],
      text: 'Review note',
    };
    expect((await call('POST', `/api/docs/${id}/ops`, bob, { upserts: [markup], deletes: [] })).status).toBe(200);
    expect((await call('GET', '/api/docs', bob)).docs.find((d: any) => d.id === id).reviews.find((r: any) => r.email === 'bob@example.com').done).toBe(false);
    expect((await call('POST', `/api/docs/${id}/review`, ann, { done: true })).status).toBe(403);

    await call('POST', `/api/docs/${id}/members`, ann, { members: ['cara@example.com'] });
    await call('POST', `/api/docs/${id}/members`, ann, { members: ['bob@example.com', 'cara@example.com'] });
    expect((await call('GET', '/api/docs', bob)).docs.find((d: any) => d.id === id).reviews.find((r: any) => r.email === 'bob@example.com').done).toBe(false);
  });
});

describe('graph client', () => {
  it('gets a token then posts sendMail', async () => {
    const calls: any[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/oauth2/v2.0/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      return new Response(null, { status: 202 });
    }) as any;
    try {
      const cfg = { provider: 'graph', tenantId: 'contoso.onmicrosoft.com', clientId: '11111111-1111-1111-1111-111111111111', clientSecret: 's', from: 'noreply@contoso.com' };
      await sendMail(cfg, 'b@example.com', 'Hi', 'Body', 20000, ['c@example.com']);
      expect(calls[0].url).toContain('contoso.onmicrosoft.com/oauth2/v2.0/token');
      expect(calls[1].url).toContain('/users/noreply%40contoso.com/sendMail');
      expect(calls[1].init.headers.Authorization).toBe('Bearer tok');
      expect(JSON.parse(calls[1].init.body).message.toRecipients[0].emailAddress.address).toBe('b@example.com');
      expect(JSON.parse(calls[1].init.body).message.ccRecipients).toEqual([{ emailAddress: { address: 'c@example.com' } }]);
    } finally { globalThis.fetch = real; }
  });
});

describe('smtp client', () => {
  it('speaks SMTP to a server', async () => {
    const lines: string[] = [];
    const srv = createServer((s) => {
      let data = false;
      s.write('220 hi\r\n');
      s.on('data', (d) => {
        for (const l of d.toString().split('\r\n').filter(Boolean)) {
          lines.push(l);
          if (data) { if (l === '.') { data = false; s.write('250 ok\r\n'); } continue; }
          if (/^EHLO/.test(l)) s.write('250-x\r\n250 AUTH PLAIN\r\n');
          else if (/^AUTH/.test(l)) s.write('235 ok\r\n');
          else if (/^DATA/.test(l)) { data = true; s.write('354 go\r\n'); }
          else if (/^QUIT/.test(l)) s.end('221 bye\r\n');
          else s.write('250 ok\r\n');
        }
      });
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const port = (srv.address() as any).port;
    await sendMail({ host: '127.0.0.1', port, secure: false, user: 'u', password: 'p', from: 'a@example.com' }, 'b@example.com', 'Hi', 'Body', 20000, ['c@example.com']);
    srv.close();
    expect(lines).toContain('MAIL FROM:<a@example.com>');
    expect(lines).toContain('RCPT TO:<b@example.com>');
    expect(lines).toContain('RCPT TO:<c@example.com>');
    expect(lines).toContain('Cc: c@example.com');
  });
});
