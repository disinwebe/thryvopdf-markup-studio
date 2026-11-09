import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

const { validate, serviceArgs, parseImage, addresses } = createRequire(import.meta.url)('../server-manager/control.cjs');

describe('Windows server manager configuration', () => {
  it('validates paths and ports, encodes elevated arguments, and recovers the owned service configuration', () => {
    const config = { port: 8787, dataDir: 'C:\\Server Data\\team & plans' };
    const app = 'C:\\Program Files\\ThryvoPDF Server Manager\\ThryvoPDF Server Manager.exe';
    const host = 'C:\\Program Files\\ThryvoPDF Server Manager\\resources\\ThryvoServerHost.exe';
    const args = serviceArgs('install', config, app);
    expect(args).toEqual(['manage', 'install', Buffer.from(config.dataDir).toString('base64'), '8787', Buffer.from(app).toString('base64')]);
    expect(parseImage(`"${host}" service 8787 ${args[2]} ${args[4]}`, host)).toEqual({ config, appPath: app });
    expect(parseImage(`"C:\\other.exe" service 8787 ${args[2]} ${args[4]}`, host)).toBeNull();
    expect(() => validate({ ...config, port: 0 })).toThrow();
    expect(() => validate({ ...config, port: 65536 })).toThrow();
    expect(() => validate({ ...config, dataDir: '\\\\server\\share' })).toThrow();
    expect(() => serviceArgs('remove-everything', config, app)).toThrow();
    expect(addresses(8787, { lan: [{ family: 'IPv4', internal: false, address: '192.168.1.5' }], loop: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }] })).toEqual(['http://192.168.1.5:8787']);
  });

  it('starts the real server entry, reports ACL capability and shuts down without logging the initial password', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thryvo-manager-'));
    const socket = createServer();
    await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
    const port = (socket.address() as { port: number }).port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    const child = spawn(process.execPath, [join(process.cwd(), 'server-manager', 'service-entry.cjs')], {
      env: { ...process.env, PMS_SERVICE_PORT: String(port), PMS_SERVICE_DATA: dir }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (data) => { output += data.toString(); });
    child.stderr.on('data', (data) => { output += data.toString(); });
    try {
      let ok = false;
      for (let i = 0; i < 50; i++) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`);
          expect((await response.json()).docsAccess).toBe(true);
          ok = true;
          break;
        } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
      }
      expect(ok).toBe(true);
      const credential = readFileSync(join(dir, 'ADMIN-INITIAL-PASSWORD.txt'), 'utf8');
      const password = /Password: ([^\r\n]+)/.exec(credential)?.[1];
      expect(password).toBeTruthy();
      expect(output).not.toContain(password);
      const exited = new Promise<number | null>((resolve) => child.once('exit', resolve));
      child.stdin.write('stop\n');
      expect(await exited).toBe(0);
    } finally {
      if (child.exitCode === null) child.kill();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses a corrupt users store without overwriting it or logging its contents', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'thryvo-manager-'));
    const file = join(dir, 'users.json');
    writeFileSync(file, '{sensitive-corrupt-data');
    try {
      const child = spawn(process.execPath, [join(process.cwd(), 'server-manager', 'service-entry.cjs')], { env: { ...process.env, PMS_SERVICE_PORT: '8787', PMS_SERVICE_DATA: dir }, stdio: ['pipe', 'pipe', 'pipe'] });
      let output = '';
      child.stderr.on('data', (data) => { output += data.toString(); });
      expect(await new Promise((resolve) => child.once('exit', resolve))).toBe(1);
      expect(readFileSync(file, 'utf8')).toBe('{sensitive-corrupt-data');
      expect(output).not.toContain('sensitive-corrupt-data');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
