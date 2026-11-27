// Prompt builders and response parsers for the Gemini-powered AI Assistant.
// Kept free of DOM/PDF.js code so it can be unit-tested.
import { DISCIPLINE_LIST, Pt, SheetMeta } from '../core/types';

/** Gemini's native box convention: [ymin, xmin, ymax, xmax] normalised to 0-1000. */
export type Box = [number, number, number, number];

export interface PageInput {
  /** zero-based page index */
  page: number;
  /** sheet number if known, shown to the model as context */
  label?: string;
  text: string;
}

const clip = (s: unknown, max: number) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** Extracts the first JSON value from a model reply, tolerating ```json fences or stray prose. */
export function parseJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(body);
  } catch {
    /* fall through to bracket search */
  }
  const start = body.search(/[[{]/);
  if (start < 0) return null;
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  const end = body.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function validBox(v: unknown): Box | undefined {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return undefined;
  const [y0, x0, y1, x1] = v.map((n) => Math.max(0, Math.min(1000, n)));
  if (y1 - y0 < 2 || x1 - x0 < 2) return undefined;
  return [y0, x0, y1, x1];
}

/** Rectangle (4 corners) in page space for a normalised box, padded so a cloud sits around the area. */
export function boxToPoints(box: Box, pageW: number, pageH: number, pad = 6): Pt[] {
  const [y0, x0, y1, x1] = box;
  const l = Math.max(0, (x0 / 1000) * pageW - pad);
  const t = Math.max(0, (y0 / 1000) * pageH - pad);
  const r = Math.min(pageW, (x1 / 1000) * pageW + pad);
  const b = Math.min(pageH, (y1 / 1000) * pageH + pad);
  return [{ x: l, y: t }, { x: r, y: t }, { x: r, y: b }, { x: l, y: b }];
}

const BOX_RULE = 'When you give a location, use "box": [ymin, xmin, ymax, xmax] with integers 0-1000 relative to the page image (0,0 = top-left). Omit "box" if unsure.';

// ---------------- Sheet index ----------------

const DISCIPLINE_CODES: Record<string, string> = {
  G: 'General', A: 'Architectural', S: 'Structural', C: 'Civil', M: 'Mechanical', I: 'Interior', P: 'Plumbing',
  E: 'Electrical', L: 'Landscape', FP: 'Fire Protection', F: 'Fire Protection', T: 'Communications', IN: 'Instrumentation', PR: 'Process', PI: 'Piping',
};

export function normalizeDiscipline(value: unknown, sheetNumber = ''): string {
  const v = clip(value, 40).toLowerCase();
  const exact = DISCIPLINE_LIST.find((d) => d.toLowerCase() === v);
  if (exact) return exact;
  const stem = v.slice(0, Math.min(v.length, 6));
  const partial = v.length >= 3 && DISCIPLINE_LIST.find((d) => d.toLowerCase().startsWith(stem) || v.startsWith(d.toLowerCase()));
  if (partial) return partial;
  if (/^fire/.test(v)) return 'Fire Protection';
  if (/telecom|comms|data/.test(v)) return 'Communications';
  const code = (v || sheetNumber).toUpperCase().match(/^([A-Z]{1,2})[\s\-.]?\d/)?.[1] ?? (v.length <= 2 ? v.toUpperCase() : '');
  return DISCIPLINE_CODES[code] ?? DISCIPLINE_CODES[code.slice(0, 1)] ?? '';
}

export const SHEET_SYSTEM =
  'You read construction drawing title blocks. Reply with JSON only: {"number": string, "title": string, "discipline": string, "revision": string}. ' +
  `discipline must be one of: ${DISCIPLINE_LIST.join(', ')}, or "" if unclear. revision is the latest revision mark (e.g. "C", "P02", "3"). ` +
  'Use "" for anything you cannot read. Never invent values.';

export function sheetPrompt(text: string): string {
  return `Fill the sheet index for this drawing page. The page image is attached. Text layer (may be empty or jumbled):\n"""\n${text.slice(0, 20000)}\n"""`;
}

export function parseSheet(reply: string): SheetMeta | null {
  const v = parseJson(reply) as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const number = clip(v.number, 40);
  const out: SheetMeta = {
    number,
    title: clip(v.title, 160),
    discipline: normalizeDiscipline(v.discipline, number),
    revision: clip(v.revision, 16),
  };
  return out.number || out.title || out.discipline || out.revision ? out : null;
}

// ---------------- Ask the drawing ----------------

export interface Citation {
  page: number;
  quote: string;
  box?: Box;
}

export interface Answer {
  answer: string;
  citations: Citation[];
}

const words = (s: string) => s.toLowerCase().match(/[a-z0-9][a-z0-9.\-]{1,}/g) ?? [];
const STOP = new Set(['the', 'and', 'for', 'what', 'which', 'where', 'when', 'how', 'are', 'is', 'of', 'to', 'in', 'on', 'this', 'that', 'with', 'there', 'does', 'any', 'all', 'from', 'drawing', 'drawings', 'sheet', 'page']);

/** Pages ordered by how often the question's terms appear in them (best first); pages with no match are dropped. */
export function rankPages(question: string, pages: PageInput[]): PageInput[] {
  const terms = [...new Set(words(question).filter((w) => !STOP.has(w)))];
  return pages
    .map((p) => {
      const t = p.text.toLowerCase();
      return { p, score: terms.reduce((n, w) => n + (t.split(w).length - 1) * (w.length > 4 ? 2 : 1), 0) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.p.page - b.p.page)
    .map((x) => x.p);
}

/** Picks the pages most relevant to a question so the request stays within the text budget. */
export function selectPages(question: string, pages: PageInput[], budgetChars = 250000, maxPages = 60): PageInput[] {
  const total = pages.reduce((n, p) => n + p.text.length, 0);
  if (total <= budgetChars && pages.length <= maxPages) return pages;
  const ranked = rankPages(question, pages);
  const rest = pages.filter((p) => !ranked.includes(p));
  const out: PageInput[] = [];
  let used = 0;
  for (const p of [...ranked, ...rest]) {
    if (out.length >= maxPages) break;
    if (used + p.text.length > budgetChars) continue;
    out.push(p);
    used += p.text.length;
  }
  return out.sort((a, b) => a.page - b.page);
}

export const QA_SYSTEM =
  'You answer questions about a set of construction drawings and specifications using ONLY the supplied pages. ' +
  'Reply with JSON only: {"answer": string, "citations": [{"page": number, "quote": string, "box"?: [ymin,xmin,ymax,xmax]}]}. ' +
  '"page" is the 1-based page number shown in the page header. "quote" is short supporting text copied from that page. ' +
  'If the pages do not contain the answer, say so plainly in "answer" and return no citations. ' + BOX_RULE + ' Only give "box" for pages whose image was attached.';

export function qaPrompt(question: string, pages: PageInput[], imagePages: number[]): string {
  const body = pages
    .map((p) => `=== Page ${p.page + 1}${p.label ? ` (sheet ${p.label})` : ''} ===\n${p.text || '(no text layer)'}`)
    .join('\n\n');
  const images = imagePages.length ? `\nImages attached, in order, for page(s): ${imagePages.map((p) => p + 1).join(', ')}.` : '';
  return `Question: ${question}${images}\n\nDocument pages:\n${body}`;
}

export function parseAnswer(reply: string, pageCount: number): Answer {
  const v = parseJson(reply) as Record<string, unknown> | null;
  if (!v || typeof v !== 'object' || Array.isArray(v) || typeof v.answer !== 'string') return { answer: reply.trim().slice(0, 4000), citations: [] };
  const citations = (Array.isArray(v.citations) ? v.citations : [])
    .map((c: any): Citation | null => {
      const page = Math.round(Number(c?.page)) - 1;
      if (!Number.isInteger(page) || page < 0 || page >= pageCount) return null;
      return { page, quote: clip(c.quote, 300), box: validBox(c.box) };
    })
    .filter((c): c is Citation => !!c)
    .slice(0, 12);
  return { answer: v.answer.trim().slice(0, 4000), citations };
}

// ---------------- Spec / compliance check ----------------

export type Severity = 'high' | 'medium' | 'low';

export interface Issue {
  page: number;
  title: string;
  detail: string;
  severity: Severity;
  box?: Box;
}

export const CHECK_SYSTEM =
  'You are a careful construction drawing checker. Compare the drawing page against the requirements and list real problems only: ' +
  'missing or conflicting information, values that do not meet a requirement, inconsistent references, or unclear notes. ' +
  'Reply with JSON only: {"issues": [{"title": string, "detail": string, "severity": "high"|"medium"|"low", "box"?: [ymin,xmin,ymax,xmax]}]}. ' +
  '"detail" must name the requirement and what the drawing shows. Return {"issues": []} if nothing is wrong. ' + BOX_RULE;

export const DEFAULT_REQUIREMENTS = [
  'Title block is complete: sheet number, title, revision, date, scale, drawn/checked by.',
  'Every dimension needed for construction is shown; no "TBC"/"TBD" left unresolved.',
  'Detail, section and sheet references point to sheets/details that exist.',
  'Notes are consistent with each other and with the drawing.',
  'Units and scales are stated and consistent.',
].join('\n');

export function checkPrompt(requirements: string, text: string, label?: string): string {
  return `Requirements to check against:\n"""\n${requirements.slice(0, 40000)}\n"""\n\nDrawing page${label ? ` (sheet ${label})` : ''} image is attached. Text layer:\n"""\n${text.slice(0, 30000)}\n"""`;
}

const severityOf = (v: unknown): Severity => (v === 'high' || v === 'low' ? v : 'medium');

export function parseIssues(reply: string, page: number): Issue[] {
  const v = parseJson(reply) as any;
  const list = Array.isArray(v) ? v : Array.isArray(v?.issues) ? v.issues : [];
  return list
    .map((i: any): Issue | null => {
      const title = clip(i?.title, 140);
      if (!title) return null;
      return { page, title, detail: clip(i?.detail, 1200), severity: severityOf(i?.severity), box: validBox(i?.box) };
    })
    .filter((i: Issue | null): i is Issue => !!i)
    .slice(0, 30);
}

// ---------------- Compare summary ----------------

export interface Change {
  kind: 'added' | 'removed' | 'modified';
  description: string;
  box?: Box;
}

export interface CompareSummary {
  summary: string;
  changes: Change[];
}

export const COMPARE_SYSTEM =
  'You compare two revisions of the same construction drawing. Image 1 is the OLD revision, image 2 is the NEW revision. ' +
  'Describe meaningful design changes (dimensions, elements, notes, levels, references, revision table) in plain language for a project team. Ignore rendering noise. ' +
  'Reply with JSON only: {"summary": string, "changes": [{"kind": "added"|"removed"|"modified", "description": string, "box"?: [ymin,xmin,ymax,xmax]}]}. ' +
  'Boxes refer to the NEW revision image. ' + BOX_RULE;

export function comparePrompt(oldText: string, newText: string, oldLabel: string, newLabel: string): string {
  return `OLD revision: ${oldLabel}\nText layer:\n"""\n${oldText.slice(0, 30000)}\n"""\n\nNEW revision: ${newLabel}\nText layer:\n"""\n${newText.slice(0, 30000)}\n"""`;
}

export function parseCompare(reply: string): CompareSummary {
  const v = parseJson(reply) as any;
  if (!v || typeof v !== 'object' || typeof v.summary !== 'string') return { summary: reply.trim().slice(0, 4000), changes: [] };
  const changes = (Array.isArray(v.changes) ? v.changes : [])
    .map((c: any): Change | null => {
      const description = clip(c?.description, 600);
      if (!description) return null;
      const kind = c?.kind === 'added' || c?.kind === 'removed' ? c.kind : 'modified';
      return { kind, description, box: validBox(c?.box) };
    })
    .filter((c: Change | null): c is Change => !!c)
    .slice(0, 40);
  return { summary: v.summary.trim().slice(0, 4000), changes };
}

export const AI_SUBJECT = 'AI review';
