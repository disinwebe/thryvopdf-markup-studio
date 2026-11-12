const path = require('node:path');
const nspell = require('nspell');
const fs = require('node:fs/promises');

const DICTIONARIES = {
  'en-US': 'dictionary-en',
  'en-GB': 'dictionary-en-gb',
};

const SUPPLEMENTAL_WORDS = [
  'recalibrate',
  'recalibrates',
  'recalibrated',
  'recalibrating',
  'recalibration',
  'recalibrations',
  'uploader',
  'uploaders',
  'untick',
  'unticks',
  'unticked',
  'unticking',
  'callout',
  'cmd',
  'ctrl',
  'dropdown',
  'entra',
  'gmail',
  'https',
  'js',
  'json',
  'macos',
  'outdent',
  'pagedown',
  'pageup',
  'pdf',
  'pdfs',
  'pngs',
  'polylength',
  'polyline',
  'repositioned',
  'selectable',
  'smtp',
  'stackable',
  'subfolder',
  'thryvopdf',
  'tooltips',
  'uncalibrated',
  'uncheck',
  'ungroup',
  'libunao',
];

function isSupportedLanguage(language) {
  return Object.hasOwn(DICTIONARIES, language);
}

function normalizeWord(word) {
  if (typeof word !== 'string') throw new Error('Choose a valid word.');
  const normalized = word.trim().toLocaleLowerCase('en');
  if (!normalized || normalized.length > 64 || /\s/.test(normalized)) {
    throw new Error('Choose a single word of 64 characters or fewer.');
  }
  return normalized;
}

async function createSpellChecker(userDataDir) {
  const settingsPath = path.join(userDataDir, 'spellcheck.json');
  let settings = { language: 'en-US', words: [] };
  try {
    const saved = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    if (saved && typeof saved === 'object') {
      if (isSupportedLanguage(saved.language)) settings.language = saved.language;
      if (Array.isArray(saved.words)) settings.words = saved.words.filter((word) => typeof word === 'string');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Could not read spell-check settings: ${error.message}`);
  }

  const checkers = new Map();
  for (const [language, packageName] of Object.entries(DICTIONARIES)) {
    const { default: dictionary } = await import(packageName);
    checkers.set(language, nspell(dictionary));
  }
  for (const checker of checkers.values()) {
    for (const word of SUPPLEMENTAL_WORDS) checker.add(word);
  }
  const personalWords = new Set(settings.words.map((word) => normalizeWord(word)));
  for (const checker of checkers.values()) {
    for (const word of personalWords) checker.add(word);
  }

  let language = settings.language;
  const save = async () => {
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify({ language, words: [...personalWords] }, null, 2), 'utf8');
  };

  return {
    getLanguage: () => language,
    setLanguage: async (nextLanguage) => {
      if (!isSupportedLanguage(nextLanguage)) throw new Error('Choose English (US) or English (UK).');
      if (nextLanguage === language) return language;
      const previousLanguage = language;
      language = nextLanguage;
      try {
        await save();
      } catch (error) {
        language = previousLanguage;
        throw new Error(`Could not save spell-check settings: ${error.message}`);
      }
      return language;
    },
    suggestions: (word) => checkers.get(language).suggest(word).slice(0, 6),
    checkWords: (words) => {
      const checker = checkers.get(language);
      return words.filter((word) => {
        if (typeof word !== 'string' || !word.trim()) return false;
        if (word.length > 1 && word === word.toLocaleUpperCase('en') && /\p{L}/u.test(word)) return false;
        return !personalWords.has(normalizeWord(word)) && !checker.correct(word);
      }).map((word) => ({ word, suggestions: checker.suggest(word).slice(0, 6) }));
    },
    addWord: async (word) => {
      const normalized = normalizeWord(word);
      if (personalWords.has(normalized)) return;
      personalWords.add(normalized);
      for (const checker of checkers.values()) checker.add(normalized);
      try {
        await save();
      } catch (error) {
        personalWords.delete(normalized);
        for (const checker of checkers.values()) checker.remove(normalized);
        throw new Error(`Could not save the personal dictionary: ${error.message}`);
      }
    },
  };
}

module.exports = { createSpellChecker, isSupportedLanguage };
