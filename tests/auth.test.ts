import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const { createAuth } = createRequire(import.meta.url)('../electron/auth.cjs');

const good = { name: ' Ann Lee ', email: 'Ann@Example.com ', discipline: 'Structural', password: 'correct horse', confirm: 'correct horse' };
let dir: string, file: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pms-auth-'));
  file = join(dir, 'users.json');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('local auth', () => {
  it('starts with no users and registers the first one (signed in)', () => {
    const a = createAuth(file);
    expect(a.status()).toEqual({ hasUsers: false, user: null });
    const r = a.register(good);
    expect(r).toEqual({ ok: true, user: { name: 'Ann Lee', email: 'ann@example.com', discipline: 'Structural' } });
    expect(a.status().hasUsers).toBe(true);
    expect(a.current()?.name).toBe('Ann Lee');
  });

  it('never stores the plaintext password and uses a per-user salt', () => {
    const a = createAuth(file);
    a.register(good);
    a.register({ ...good, email: 'b@example.com' });
    const raw = readFileSync(file, 'utf8');
    expect(raw).not.toContain('correct horse');
    const [u1, u2] = JSON.parse(raw).users;
    expect(u1.salt).not.toBe(u2.salt);
    expect(u1.hash).not.toBe(u2.hash);
  });

  it('validates fields', () => {
    const a = createAuth(file);
    expect(a.register({ ...good, name: ' ' }).ok).toBe(false);
    expect(a.register({ ...good, email: 'nope' }).ok).toBe(false);
    expect(a.register({ ...good, discipline: '' }).ok).toBe(false);
    expect(a.register({ ...good, password: 'short', confirm: 'short' }).ok).toBe(false);
    expect(a.register({ ...good, confirm: 'different pass' })).toMatchObject({ ok: false, error: 'Passwords do not match.' });
    expect(a.status().hasUsers).toBe(false);
  });

  it('rejects duplicate emails case-insensitively', () => {
    const a = createAuth(file);
    a.register(good);
    expect(a.register({ ...good, email: 'ANN@example.com' })).toMatchObject({ ok: false });
  });

  it('logs in, rejects bad credentials, and logs out; persists across instances', () => {
    createAuth(file).register(good);
    const a = createAuth(file);
    expect(a.status()).toEqual({ hasUsers: true, user: null });
    expect(a.login({ email: 'ann@example.com', password: 'wrong password' }).ok).toBe(false);
    expect(a.login({ email: 'nobody@example.com', password: 'correct horse' }).ok).toBe(false);
    expect(a.current()).toBeNull();
    expect(a.login({ email: ' ANN@example.com', password: 'correct horse' }).ok).toBe(true);
    expect(a.current()?.email).toBe('ann@example.com');
    a.logout();
    expect(a.current()).toBeNull();
  });

  it('does not expose hash or salt to the renderer', () => {
    const r = createAuth(file).register(good);
    expect(JSON.stringify(r)).not.toMatch(/hash|salt/);
  });

  it('treats a corrupt store as empty', () => {
    writeFileSync(file, '{broken');
    expect(createAuth(file).status().hasUsers).toBe(false);
  });
});
