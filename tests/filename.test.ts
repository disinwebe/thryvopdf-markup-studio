import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizePdfFilename } from '../src/app/filename';

const require = createRequire(import.meta.url);
const { renamePdfFile } = require('../electron/fileOps.cjs');

describe('PDF filename rename', () => {
  it('keeps a single PDF extension and trims unsafe Windows filename characters', () => {
    expect(normalizePdfFilename('  Plan revised.PDF ')).toBe('Plan revised.pdf');
    expect(normalizePdfFilename('Plan<>A')).toBe('Plan__A.pdf');
    expect(normalizePdfFilename('CON')).toBe('_CON.pdf');
    expect(normalizePdfFilename('... ')).toBeNull();
  });

  it('moves an allowlisted PDF and preserves the file when a target already exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pms-rename-'));
    try {
      const source = join(dir, 'Original.pdf');
      const collision = join(dir, 'Taken.pdf');
      writeFileSync(source, 'original');
      writeFileSync(collision, 'existing');
      const allowed = new Set([source]);
      const renamed = renamePdfFile(source, normalizePdfFilename('Renamed'), allowed);
      expect(renamed).toEqual({ ok: true, path: join(dir, 'Renamed.pdf') });
      expect(readFileSync(join(dir, 'Renamed.pdf'), 'utf8')).toBe('original');
      expect(allowed.has(join(dir, 'Renamed.pdf'))).toBe(true);
      expect(renamePdfFile(join(dir, 'Renamed.pdf'), 'Taken.pdf', allowed).ok).toBe(false);
      expect(readFileSync(collision, 'utf8')).toBe('existing');
      expect(allowed.has(join(dir, 'Renamed.pdf'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
