import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { verifyLicense, createLicenseStore } = require('../electron/license.cjs');
const device = 'a'.repeat(64);
const keys = generateKeyPairSync('ed25519');
const pub = keys.publicKey.export({ type: 'spki', format: 'pem' });
const envelope = (overrides = {}) => {
  const payload = Buffer.from(JSON.stringify({ version: 1, product: 'ThryvoPDF Markup Studio', kind: 'perpetual', device, id: 'b'.repeat(32), issuedAt: '2020-01-01T00:00:00Z', ...overrides }));
  return JSON.stringify({ payload: payload.toString('base64url'), signature: sign(null, payload, keys.privateKey).toString('base64url') });
};

describe('offline license', () => {
  it('accepts a signed perpetual license for its own device without expiry', () => {
    expect(verifyLicense(envelope(), pub, device).ok).toBe(true);
    expect(verifyLicense(envelope({ issuedAt: '1900-01-01T00:00:00Z' }), pub, device).ok).toBe(true);
    expect(verifyLicense(envelope({ expiresAt: '2099-01-01T00:00:00Z' }), pub, device).ok).toBe(false);
    expect(verifyLicense(envelope({ kind: 'trial' }), pub, device).ok).toBe(false);
  });
  it('rejects tampering, malformed, wrong key and different device', () => {
    const raw = JSON.parse(envelope());
    raw.payload = Buffer.from('{"device":"x"}').toString('base64url');
    expect(verifyLicense(JSON.stringify(raw), pub, device).ok).toBe(false);
    expect(verifyLicense(envelope(), pub, 'c'.repeat(64)).ok).toBe(false);
    expect(verifyLicense(envelope(), generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }), device).ok).toBe(false);
    expect(verifyLicense('not json', pub, device).ok).toBe(false);
  });
  it('persists valid activation and fails closed for missing verification key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'license-test-'));
    try {
      const file = join(dir, 'license.json');
      const publicKeyFile = join(dir, 'public.pem');
      const store = createLicenseStore({ file, publicKeyFile, getDevice: () => device });
      expect(store.status().ok).toBe(false);
      writeFileSync(publicKeyFile, pub);
      expect(store.activate(envelope()).ok).toBe(true);
      expect(createLicenseStore({ file, publicKeyFile, getDevice: () => device }).status().ok).toBe(true);
      expect(createLicenseStore({ file, publicKeyFile, getDevice: () => 'c'.repeat(64) }).status().ok).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('vendor CLI generates external keys and issues a valid license', () => {
    const dir = mkdtempSync(join(tmpdir(), 'license-cli-'));
    try {
      const script = resolve('scripts', 'license-vendor.cjs');
      const privateFile = join(dir, 'private.pem');
      const publicFile = join(dir, 'public.pem');
      const out = join(dir, 'license.json');
      execFileSync(process.execPath, [script, 'keygen', privateFile, publicFile]);
      execFileSync(process.execPath, [script, 'issue', device, out], { env: { ...process.env, PMS_LICENSE_PRIVATE_KEY: privateFile } });
      expect(verifyLicense(readFileSync(out, 'utf8'), readFileSync(publicFile, 'utf8'), device).ok).toBe(true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
