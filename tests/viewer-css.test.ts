import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('viewer input layer', () => {
  it('sizes the capture overlay to the page so pointer events reach it (pan and markup tools)', () => {
    const css = readFileSync('src/styles.css', 'utf8');
    const rule = /(?:^|\n)\.capture\s*\{([^}]*)\}/.exec(css);
    expect(rule, '.capture rule').not.toBeNull();
    expect(rule![1]).toMatch(/width:\s*100%/);
    expect(rule![1]).toMatch(/height:\s*100%/);
    expect(css).toMatch(/\.page[^{]*\.capture[^{]*\{[^}]*position:\s*absolute/);
  });
});
