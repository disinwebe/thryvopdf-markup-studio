import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { writeSavedFile } = require('../electron/fileOps.cjs');

describe('saving locked files', () => {
  it('explains a locked file and preserves the existing contents', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pms-save-lock-'));
    try {
      const file = join(dir, 'drawing.pdf');
      writeFileSync(file, 'original');
      const locked = Object.assign(new Error('resource busy'), { code: 'EBUSY' });
      expect(() => writeSavedFile(file, new Uint8Array([1, 2]), {
        writeFileSync: () => { throw locked; },
      })).toThrow(/locked or in use.*Save As/i);
      expect(readFileSync(file, 'utf8')).toBe('original');
      writeSavedFile(file, new Uint8Array([1, 2]));
      expect(readFileSync(file)).toEqual(Buffer.from([1, 2]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not misrepresent other filesystem errors as locks', () => {
    const denied = Object.assign(new Error('access denied'), { code: 'EACCES' });
    expect(() => writeSavedFile('unused', 'data', { writeFileSync: () => { throw denied; } })).toThrow(denied);
  });
});
