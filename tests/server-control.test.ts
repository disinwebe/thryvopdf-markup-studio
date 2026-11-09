import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const { createServerControl } = createRequire(import.meta.url)('../electron/server-control.cjs');

describe('local server control', () => {
  it('starts a real server, persists settings, restarts, and stops it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pms-control-'));
    const configFile = join(dir, 'config.json');
    const dataDir = join(dir, 'data');
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>((resolve) => probe.close(() => resolve()));
    const ctl = createServerControl({ configFile, defaultDir: dataDir, interfaces: () => ({ lan: [{ family: 'IPv4', internal: false, address: '192.168.1.20' }] }) });
    try {
      const start = await ctl.perform('start', { port, dataDir });
      expect(start.running).toBe(true);
      expect(start.addresses).toEqual([`http://192.168.1.20:${port}`]);
      expect(start.initialPasswordFile).toBe(join(dataDir, 'ADMIN-INITIAL-PASSWORD.txt'));
      expect(JSON.stringify(start)).not.toContain('password":');
      expect((await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()).docsAccess).toBe(true);
      expect(JSON.parse(readFileSync(configFile, 'utf8'))).toEqual({ port, dataDir });
      expect((await ctl.perform('restart', { port, dataDir })).running).toBe(true);
      expect((await ctl.perform('stop')).running).toBe(false);
      expect(createServerControl({ configFile, defaultDir: join(dir, 'other') }).status().config).toEqual({ port, dataDir });
    } finally {
      await ctl.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports invalid settings, occupied ports and corrupt user stores without overwriting them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pms-control-'));
    const dataDir = join(dir, 'data');
    const occupied = createServer();
    await new Promise<void>((resolve) => occupied.listen(0, '0.0.0.0', resolve));
    const port = (occupied.address() as { port: number }).port;
    const ctl = createServerControl({ configFile: join(dir, 'config.json'), defaultDir: dataDir });
    try {
      expect((await ctl.perform('start', { port: 0, dataDir })).error).toMatch(/port between/i);
      expect((await ctl.perform('start', { port, dataDir })).error).toMatch(/EADDRINUSE|address already in use/i);
      const file = join(dataDir, 'users.json');
      writeFileSync(file, '{invalid');
      expect((await ctl.perform('start', { port, dataDir })).running).toBe(false);
      expect(readFileSync(file, 'utf8')).toBe('{invalid');
    } finally {
      await ctl.stop();
      await new Promise<void>((resolve) => occupied.close(() => resolve()));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
