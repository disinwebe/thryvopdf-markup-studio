import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createSpellChecker, isSupportedLanguage } = require('../electron/spellcheck.cjs');
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createTemporarySpellChecker() {
  const directory = await mkdtemp(path.join(tmpdir(), 'thryvopdf-spellcheck-'));
  temporaryDirectories.push(directory);
  return { directory, checker: await createSpellChecker(directory) };
}

describe('PDF spell-check service', () => {
  it('checks words and offers suggestions from the selected English dictionary', async () => {
    const { checker } = await createTemporarySpellChecker();
    expect(checker.getLanguage()).toBe('en-US');
    expect(checker.suggestions('mispeling')).toContain('misspelling');
    expect(checker.checkWords(['review', 'Measurements', 'mispeling']).map((issue: { word: string }) => issue.word)).toEqual(['mispeling']);
    expect(isSupportedLanguage('en-GB')).toBe(true);
    expect(isSupportedLanguage('fr-FR')).toBe(false);
  });

  it('accepts standard English words missing from the bundled dictionaries', async () => {
    const { checker } = await createTemporarySpellChecker();
    const standardWords = [
      'Recalibrate',
      'recalibrates',
      'recalibrated',
      'recalibrating',
      'recalibration',
      'uploader',
      'uploaders',
      'Untick',
      'unticks',
      'unticked',
      'unticking',
      'Callout',
      'Cmd',
      'Ctrl',
      'dropdown',
      'Entra',
      'Gmail',
      'https',
      'js',
      'json',
      'macOS',
      'outdent',
      'PageDown',
      'PageUp',
      'pdf',
      'PDFs',
      'PNGs',
      'PolyLength',
      'Polyline',
      'repositioned',
      'selectable',
      'smtp',
      'stackable',
      'subfolder',
      'ThryvoPDF',
      'tooltips',
      'Uncalibrated',
      'uncheck',
      'Ungroup',
      'Libunao',
    ];
    expect(checker.checkWords(standardWords)).toEqual([]);
    await checker.setLanguage('en-GB');
    expect(checker.checkWords(standardWords)).toEqual([]);
    expect(checker.checkWords(['recalibrat', 'uploder', 'untik']).map((issue: { word: string }) => issue.word)).toEqual([
      'recalibrat',
      'uploder',
      'untik',
    ]);
  });

  it('persists the selected language across restarts', async () => {
    const { directory, checker } = await createTemporarySpellChecker();
    await checker.setLanguage('en-GB');
    expect(checker.getLanguage()).toBe('en-GB');
    await expect(checker.setLanguage('fr-FR')).rejects.toThrow('English (US) or English (UK)');

    const settings = JSON.parse(await readFile(path.join(directory, 'spellcheck.json'), 'utf8'));
    expect(settings).toEqual({ language: 'en-GB', words: [] });
    const restored = await createSpellChecker(directory);
    expect(restored.getLanguage()).toBe('en-GB');
  });

  it('persists words added to the personal dictionary', async () => {
    const { directory, checker } = await createTemporarySpellChecker();
    await checker.addWord('ThryvoPDF');
    expect(checker.checkWords(['ThryvoPDF'])).toEqual([]);
    const restored = await createSpellChecker(directory);
    expect(restored.checkWords(['ThryvoPDF'])).toEqual([]);
  });
});
