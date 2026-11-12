import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { createClient } = createRequire(import.meta.url)('../electron/client.cjs');
let dir: string;
let configFile: string;
let sessionFile: string;
const token = 'server-access-token';
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from([...Buffer.from(value)].map((byte) => byte ^ 0xa5)),
  decryptString: (value: Buffer) => Buffer.from([...value].map((byte) => byte ^ 0xa5)).toString(),
};
const fetch = async (url: string, init?: { method?: string }) => {
  if (url.endsWith('/api/health')) return Response.json({ ok: true, hasUsers: true });
  if (url.endsWith('/api/login')) return Response.json({
    ok: true,
    user: { name: 'Ann', email: 'ann@example.test', discipline: 'Other' },
    token,
    expiresAt: Date.now() + 60_000,
  });
  if (url.endsWith('/api/logout')) return Response.json({ ok: true });
  throw new Error(`Unexpected request: ${init?.method || 'GET'} ${url}`);
};

const makeClient = () => createClient({
  configFile,
  localFile: join(dir, 'users.json'),
  sessionFile,
  safeStorage,
  fetch,
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pms-session-'));
  configFile = join(dir, 'server.json');
  sessionFile = join(dir, 'server-session.bin');
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('remembered server sign-in', () => {
  it('encrypts the session, restores it after restart, and clears it on logout', async () => {
    const first = makeClient();
    expect((await first.configure({ mode: 'server', serverUrl: 'server.example.test' })).ok).toBe(true);
    const login = await first.login({ email: 'ann@example.test', password: 'secret' });
    expect(login).toMatchObject({ ok: true, remembered: true });
    expect(readFileSync(sessionFile, 'utf8')).not.toContain(token);

    const restored = makeClient();
    expect(restored.current()?.email).toBe('ann@example.test');
    expect((await restored.status()).remembered).toBe(true);
    expect(await restored.logout()).toEqual({ ok: true });
    expect(existsSync(sessionFile)).toBe(false);
    expect(makeClient().current()).toBeNull();
  });

  it('does not persist temporary-password sessions', async () => {
    const temporaryFetch = async (url: string) => {
      if (url.endsWith('/api/health')) return Response.json({ ok: true, hasUsers: true });
      if (url.endsWith('/api/login')) return Response.json({
        ok: true,
        user: { name: 'Ann', email: 'ann@example.test', discipline: 'Other', mustChange: true },
        token,
        expiresAt: Date.now() + 60_000,
      });
      throw new Error(`Unexpected request: ${url}`);
    };
    const client = createClient({
      configFile,
      localFile: join(dir, 'users.json'),
      sessionFile,
      safeStorage,
      fetch: temporaryFetch,
    });
    await client.configure({ mode: 'server', serverUrl: 'server.example.test' });
    expect(await client.login({ email: 'ann@example.test', password: 'temporary' })).toMatchObject({
      ok: true,
      remembered: false,
      rememberError: 'Change your temporary password before saving this sign-in.',
    });
    expect(existsSync(sessionFile)).toBe(false);
  });
});
