import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const fs = require('node:fs');
const { start } = require('../server/server.cjs');
const { sendMail } = require('../server/notify.cjs');
const PDF = Buffer.from('%PDF-1.4\n%%EOF\n');
let dir: string, server: any, base: string, admin: string, ann: string, bob: string;
const sent: any[] = [];

async function call(method: string, path: string, token?: string, body?: any, raw?: Buffer) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(raw ? {} : { 'Content-Type': 'application/json' }) },
    body: (raw as any) || (body === undefined ? undefined : JSON.stringify(body)),
  });
  return { status: res.status, ...(await res.json()) };
}
const upload = (token: string, members: string[]) =>
  call('POST', `/api/docs?name=plan.pdf${members.map((m) => '&member=' + encodeURIComponent(m)).join('')}`, token, undefined, PDF);

beforeAll(async () => {
  dir = mkdtempSync(join(process.cwd(), '.notify-test-'));
  fs.writeFileSync(join(dir, 'notify.json'), JSON.stringify({ smtp: { enabled: true, host: 'smtp.test', port: 25, from: 'ThryvoPDF <noreply@example.com>' } }));
  server = await start({ port: 0, host: '127.0.0.1', file: join(dir, 'users.json'), adminPassword: 'InitialAdmin1', sendMail: async (_c: unknown, to: string, subject: string, text: string) => { sent.push({ to, subject, text }); } });
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
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true });
});

describe('assignment notifications', () => {
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
    await sendMail({ host: '127.0.0.1', port, secure: false, user: 'u', password: 'p', from: 'a@example.com' }, 'b@example.com', 'Hi', 'Body');
    srv.close();
    expect(lines).toContain('MAIL FROM:<a@example.com>');
    expect(lines).toContain('RCPT TO:<b@example.com>');
  });
});
