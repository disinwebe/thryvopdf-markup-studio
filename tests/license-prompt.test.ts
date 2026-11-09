import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { verifyLicense } = createRequire(import.meta.url)('../electron/license.cjs');
const prompt = resolve('scripts', 'license-issuer-prompt.cjs');
const issuer = resolve('scripts', 'license-vendor.cjs');
const device = 'a'.repeat(64);

describe('interactive license issuance', () => {
  it.runIf(process.platform === 'win32')('runs the batch wrapper from another directory with an isolated test key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thryvo batch test-'));
    try {
      const scripts = join(dir, 'scripts');
      const electron = join(dir, 'electron');
      mkdirSync(scripts);
      mkdirSync(electron);
      for (const file of ['license-vendor.cjs', 'license-issuer-prompt.cjs']) copyFileSync(resolve('scripts', file), join(scripts, file));
      copyFileSync(resolve('electron', 'license.cjs'), join(electron, 'license.cjs'));
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const keyFile = join(dir, 'test-private.pem');
      writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
      const batch = join(scripts, 'generate-license.bat');
      const original = readFileSync(resolve('scripts', 'generate-license.bat'), 'utf8');
      writeFileSync(batch, original.replace('C:\\Users\\Tito\\ThryvoLicenseKeys\\thryvo-private.pem', keyFile));
      const out = join(dir, 'result.json');
      const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/c', `"${batch}"`], {
        windowsVerbatimArguments: true,
        cwd: tmpdir(), input: `${device}\n${out}\nx\n`, encoding: 'utf8', timeout: 10000,
      });
      expect(result.status, result.stderr + result.stdout).toBe(0);
      const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
      expect(verifyLicense(readFileSync(out, 'utf8'), pem, device).ok).toBe(true);
      expect(result.stdout).not.toContain('PRIVATE KEY');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('issues a valid device-bound license using a temporary test key and never overwrites a file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'thryvo-license-test-'));
    try {
      const { publicKey, privateKey } = generateKeyPairSync('ed25519');
      const keyFile = join(dir, 'test-private.pem');
      writeFileSync(keyFile, privateKey.export({ type: 'pkcs8', format: 'pem' }));
      const out = join(dir, 'license with spaces.json');
      const run = (input: string) => spawnSync(process.execPath, [prompt, issuer], {
        input, encoding: 'utf8', env: { ...process.env, PMS_LICENSE_PRIVATE_KEY: keyFile }, timeout: 10000,
      });
      const created = run(`${device}\n${out}\n`);
      expect(created.status, created.stderr).toBe(0);
      const content = readFileSync(out, 'utf8');
      const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
      expect(verifyLicense(content, pem, device).ok).toBe(true);
      expect(verifyLicense(content, pem, 'b'.repeat(64)).ok).toBe(false);
      expect(created.stdout).not.toContain('PRIVATE KEY');
      const duplicate = run(`${device}\n${out}\n`);
      expect(duplicate.status).not.toBe(0);
      expect(duplicate.stderr).toContain('already exists');
      expect(readFileSync(out, 'utf8')).toBe(content);
      expect(run(`not-a-fingerprint\n${out}\n`).status).not.toBe(0);
      expect(run(`${device}\n`).status).not.toBe(0);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
