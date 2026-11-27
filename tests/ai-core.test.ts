import { describe, expect, it } from 'vitest';
import {
  boxToPoints, normalizeDiscipline, rankPages, parseAnswer, parseCompare, parseIssues, parseJson, parseSheet, selectPages, validBox,
} from '../src/ai/core';

describe('AI response parsing', () => {
  it('reads JSON wrapped in code fences or prose', () => {
    expect(parseJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJson('Here you go: {"a":[1,2]} thanks')).toEqual({ a: [1, 2] });
    expect(parseJson('no json here')).toBeNull();
  });

  it('validates and clamps boxes', () => {
    expect(validBox([10, 20, 300, 400])).toEqual([10, 20, 300, 400]);
    expect(validBox([-5, 0, 1200, 500])).toEqual([0, 0, 1000, 500]);
    expect(validBox([10, 10, 10, 50])).toBeUndefined();
    expect(validBox([1, 2, 3])).toBeUndefined();
    expect(validBox('x')).toBeUndefined();
  });

  it('maps a normalised box onto page space with padding, clamped to the page', () => {
    const pts = boxToPoints([100, 200, 500, 600], 1000, 800, 5);
    expect(pts).toEqual([{ x: 195, y: 75 }, { x: 605, y: 75 }, { x: 605, y: 405 }, { x: 195, y: 405 }]);
    const edge = boxToPoints([0, 0, 1000, 1000], 100, 100, 5);
    expect(edge[0]).toEqual({ x: 0, y: 0 });
    expect(edge[2]).toEqual({ x: 100, y: 100 });
  });

  it('normalises disciplines from names and sheet-number prefixes', () => {
    expect(normalizeDiscipline('structural')).toBe('Structural');
    expect(normalizeDiscipline('Architecture')).toBe('Architectural');
    expect(normalizeDiscipline('', 'S-101')).toBe('Structural');
    expect(normalizeDiscipline('', 'FP-201')).toBe('Fire Protection');
    expect(normalizeDiscipline('E')).toBe('Electrical');
    expect(normalizeDiscipline('weird')).toBe('');
  });

  it('parses a sheet and rejects empty results', () => {
    expect(parseSheet('{"number":" A-101 ","title":"Ground floor plan","discipline":"arch","revision":"C"}'))
      .toEqual({ number: 'A-101', title: 'Ground floor plan', discipline: 'Architectural', revision: 'C' });
    expect(parseSheet('{"number":"","title":"","discipline":"","revision":""}')).toBeNull();
    expect(parseSheet('[1,2]')).toBeNull();
  });

  it('parses answers and drops citations to pages that do not exist', () => {
    const a = parseAnswer('{"answer":"300 mm","citations":[{"page":2,"quote":"SLAB 300","box":[1,1,50,50]},{"page":9,"quote":"x"}]}', 3);
    expect(a.answer).toBe('300 mm');
    expect(a.citations).toEqual([{ page: 1, quote: 'SLAB 300', box: [1, 1, 50, 50] }]);
    expect(parseAnswer('plain text answer', 3)).toEqual({ answer: 'plain text answer', citations: [] });
  });

  it('parses issues with default severity and skips untitled ones', () => {
    const list = parseIssues('{"issues":[{"title":"Missing scale","detail":"Req 5","severity":"high","box":[0,0,100,100]},{"title":"Note","severity":"bogus"},{"detail":"no title"}]}', 4);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ page: 4, severity: 'high', box: [0, 0, 100, 100] });
    expect(list[1]).toMatchObject({ severity: 'medium', box: undefined });
  });

  it('parses a compare summary', () => {
    const r = parseCompare('{"summary":"Door moved","changes":[{"kind":"added","description":"New door D3","box":[10,10,40,40]},{"kind":"other","description":"Note text"}]}');
    expect(r.summary).toBe('Door moved');
    expect(r.changes.map((c) => c.kind)).toEqual(['added', 'modified']);
  });

  it('keeps all pages under budget and picks relevant pages over it', () => {
    const pages = [
      { page: 0, text: 'general notes '.repeat(50) },
      { page: 1, text: 'foundation slab thickness 300mm footing' },
      { page: 2, text: 'roof plan '.repeat(50) },
    ];
    expect(selectPages('foundation thickness', pages)).toHaveLength(3);
    const picked = selectPages('foundation thickness', pages, 600);
    expect(picked.map((p) => p.page)).toContain(1);
    expect(picked.reduce((n, p) => n + p.text.length, 0)).toBeLessThanOrEqual(600);
    expect(rankPages('foundation thickness', pages).map((p) => p.page)).toEqual([1]);
  });
});
