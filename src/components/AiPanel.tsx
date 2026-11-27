import { useEffect, useRef, useState } from 'react';
import { Doc, defaultStyle, makeMarkup } from '../app/model';
import { Markup, SheetMeta, uid } from '../core/types';
import {
  AI_SUBJECT, Answer, Box, CHECK_SYSTEM, COMPARE_SYSTEM, CompareSummary, DEFAULT_REQUIREMENTS, Issue, PageInput, QA_SYSTEM, SHEET_SYSTEM,
  boxToPoints, checkPrompt, comparePrompt, parseAnswer, parseCompare, parseIssues, parseSheet, qaPrompt, rankPages, selectPages, sheetPrompt,
} from '../ai/core';
import { ask, cachedText, eachPage, pageImage } from '../ai/client';

export type AiTab = 'ask' | 'sheets' | 'check' | 'compare' | 'settings';

const MAX_CHECK_PAGES = 25;
const REQUIREMENTS_KEY = 'pms.ai.requirements';
const SEVERITY_COLOR = { high: '#e02424', medium: '#d97706', low: '#2563eb' } as const;
const CHANGE_COLOR = { added: '#186eeb', removed: '#e22626', modified: '#d97706' } as const;

const loadRequirements = () => {
  try { return localStorage.getItem(REQUIREMENTS_KEY) || DEFAULT_REQUIREMENTS; } catch { return DEFAULT_REQUIREMENTS; }
};
const saveRequirements = (v: string) => {
  try { localStorage.setItem(REQUIREMENTS_KEY, v); } catch { /* session only */ }
};
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Builds a cloud markup carrying the AI finding as its first comment. */
function aiCloud(page: number, box: Box, pageW: number, pageH: number, color: string, text: string, author: string): Markup {
  const date = new Date().toISOString();
  return makeMarkup('cloud', page, boxToPoints(box, pageW, pageH), { ...defaultStyle('cloud'), color }, author, {
    subject: AI_SUBJECT,
    comments: [{ id: uid(), author: `${author} (AI)`, date, text }],
  });
}

export function AiPanel({
  doc,
  docs,
  author,
  readOnly,
  initialTab = 'ask',
  onApplySheets,
  onAddMarkups,
  onGoto,
  onMessage,
}: {
  doc: Doc;
  docs: Doc[];
  author: string;
  readOnly: boolean;
  initialTab?: AiTab;
  onApplySheets(docId: string, sheets: Record<number, Partial<SheetMeta>>): void;
  onAddMarkups(docId: string, markups: Markup[]): void;
  onGoto(docId: string, page: number): void;
  onMessage(msg: string): void;
}) {
  const [tab, setTab] = useState<AiTab>(initialTab);
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const cancel = useRef(false);

  useEffect(() => {
    let live = true;
    window.api?.aiStatus().then((s) => {
      if (!live) return;
      setStatus(s);
      if (!s.configured) setTab('settings');
    }).catch((e) => live && setError(errorText(e)));
    return () => { live = false; cancel.current = true; };
  }, []);

  /** Wraps a long-running AI job with busy/error state and cancellation. */
  const run = async (label: string, job: () => Promise<void>) => {
    cancel.current = false;
    setError('');
    setBusy(label);
    try {
      await job();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy('');
    }
  };

  const tabs: [AiTab, string][] = [['ask', 'Ask'], ['sheets', 'Sheet index'], ['check', 'Spec check'], ['compare', 'Compare summary'], ['settings', 'Settings']];
  return (
    <div className="panel-body ai-panel">
      <div className="row ai-tabs">
        {tabs.map(([id, label]) => (
          <button key={id} className={tab === id ? 'on' : ''} disabled={!!busy || (id !== 'settings' && !status?.configured)} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {busy && (
        <div className="row ai-busy"><span className="grow">{busy}</span><button onClick={() => { cancel.current = true; }}>Stop</button></div>
      )}
      {error && <p className="ai-error">{error}</p>}
      {tab === 'settings' && <AiSettings status={status} onStatus={setStatus} onMessage={onMessage} />}
      {tab === 'ask' && <AskTab doc={doc} busy={!!busy} run={run} author={author} readOnly={readOnly} onGoto={onGoto} onAddMarkups={onAddMarkups} />}
      {tab === 'sheets' && <SheetsTab doc={doc} busy={!!busy} run={run} cancel={cancel} readOnly={readOnly} onApply={onApplySheets} onGoto={onGoto} onMessage={onMessage} />}
      {tab === 'check' && <CheckTab doc={doc} busy={!!busy} run={run} cancel={cancel} author={author} readOnly={readOnly} onGoto={onGoto} onAddMarkups={onAddMarkups} onMessage={onMessage} />}
      {tab === 'compare' && <CompareTab doc={doc} docs={docs} busy={!!busy} run={run} author={author} readOnly={readOnly} onGoto={onGoto} onAddMarkups={onAddMarkups} onMessage={onMessage} />}
      <p className="muted small">AI results can be wrong. Check every answer and markup against the drawings before relying on it. Pages you analyse are sent to Google Gemini.</p>
    </div>
  );
}

type Run = (label: string, job: () => Promise<void>) => Promise<void>;

// ---------------- Settings ----------------

function AiSettings({ status, onStatus, onMessage }: { status: AiStatus | null; onStatus(s: AiStatus): void; onMessage(m: string): void }) {
  const [key, setKey] = useState('');
  const [model, setModel] = useState(status?.model ?? '');
  const [err, setErr] = useState('');
  useEffect(() => { if (status) setModel(status.model); }, [status?.model]);
  const apply = async (args: { apiKey?: string; clearKey?: boolean; model?: string }) => {
    setErr('');
    const r = await window.api!.aiConfigure(args);
    if (!r.ok) return setErr(r.error);
    onStatus(r.status);
    setKey('');
    onMessage(args.clearKey ? 'Gemini API key removed from this PC.' : 'AI settings saved.');
  };
  return (
    <div>
      <p>
        Status: {status?.configured ? <b>ready</b> : <b>no API key</b>}
        {status?.source === 'env' && <span className="muted"> (using the GEMINI_API_KEY environment variable)</span>}
        {status?.source === 'saved' && <span className="muted"> (key saved encrypted on this PC)</span>}
      </p>
      <p className="muted small">Create a key at Google AI Studio (aistudio.google.com &gt; Get API key). The key stays in the app's main process and is never shown again.</p>
      <div className="row">
        <input type="password" autoComplete="off" placeholder="Paste Gemini API key" value={key} onChange={(e) => setKey(e.target.value)} style={{ flex: 1 }} />
        <button className="primary" disabled={!key.trim() || !status?.canSaveKey} onClick={() => void apply({ apiKey: key })}>Save key</button>
        {status?.source === 'saved' && <button onClick={() => void apply({ clearKey: true })}>Remove key</button>}
      </div>
      {status && !status.canSaveKey && <p className="muted small">Secure storage is unavailable here; set GEMINI_API_KEY in the environment instead.</p>}
      <div className="row">
        <label>Model</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={status?.defaultModel} style={{ flex: 1 }} />
        <button disabled={!model.trim() || model.trim() === status?.model} onClick={() => void apply({ model: model.trim() })}>Save model</button>
      </div>
      <p className="muted small">Default: {status?.defaultModel}. Use a Flash model for speed and cost; a larger model may read dense drawings better.</p>
      {err && <p className="ai-error">{err}</p>}
    </div>
  );
}

// ---------------- Ask the drawing ----------------

type ImageMode = 'current' | 'relevant' | 'none';

function AskTab({ doc, busy, run, author, readOnly, onGoto, onAddMarkups }: {
  doc: Doc; busy: boolean; run: Run; author: string; readOnly: boolean;
  onGoto(docId: string, page: number): void; onAddMarkups(docId: string, m: Markup[]): void;
}) {
  const [q, setQ] = useState('');
  const [images, setImages] = useState<ImageMode>('current');
  const [history, setHistory] = useState<{ q: string; a: Answer; sizes: Record<number, { w: number; h: number }> }[]>([]);

  const go = () => run('Reading the document…', async () => {
    const question = q.trim();
    const pages: PageInput[] = [];
    for (let i = 0; i < doc.numPages; i++) pages.push({ page: i, label: doc.sheets[i]?.number, text: await cachedText(doc.pdf, i, doc.textCache) });
    const chosen = selectPages(question, pages);
    const relevant = rankPages(question, pages).slice(0, 6).map((p) => p.page);
    const imagePages = images === 'none' ? [] : images === 'current' || !relevant.length ? [doc.page] : relevant;
    const parts: AiPart[] = [];
    const sizes: Record<number, { w: number; h: number }> = {};
    for (const p of imagePages) {
      const img = await pageImage(doc.pdf, p, 1600);
      parts.push(img.part);
      sizes[p] = { w: img.pageW, h: img.pageH };
    }
    parts.push({ text: qaPrompt(question, chosen, imagePages) });
    const a = parseAnswer(await ask({ system: QA_SYSTEM, parts, json: true }), doc.numPages);
    a.citations = a.citations.map((c) => (sizes[c.page] ? c : { ...c, box: undefined }));
    setHistory((h) => [{ q: question, a, sizes }, ...h]);
    setQ('');
  });

  return (
    <div>
      <div className="row">
        <input style={{ flex: 1 }} value={q} placeholder="e.g. What is the foundation thickness for Building A?" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && q.trim() && !busy && void go()} />
        <button className="primary" disabled={busy || !q.trim()} onClick={() => void go()}>Ask</button>
      </div>
      <label className="row small">
        Page images:
        <select value={images} onChange={(e) => setImages(e.target.value as ImageMode)}>
          <option value="current">Current page</option>
          <option value="relevant">Up to 6 most relevant pages</option>
          <option value="none">None (text layer only)</option>
        </select>
        <span className="muted">Images help with drawings and scans; text is always sent.</span>
      </label>
      {history.map((h, i) => (
        <div key={i} className="ai-card">
          <b>{h.q}</b>
          <p className="ai-answer">{h.a.answer}</p>
          {h.a.citations.map((c, j) => (
            <div key={j} className="item" onClick={() => onGoto(doc.id, c.page)}>
              <div className="grow">
                <b>Page {c.page + 1}</b>{doc.sheets[c.page]?.number ? ` · ${doc.sheets[c.page].number}` : ''}
                {c.quote && <div className="muted small">“{c.quote}”</div>}
              </div>
              {c.box && !readOnly && (
                <button onClick={(e) => {
                  e.stopPropagation();
                  const s = h.sizes[c.page];
                  onAddMarkups(doc.id, [aiCloud(c.page, c.box!, s.w, s.h, '#2563eb', `Q: ${h.q}\nA: ${h.a.answer}`, author)]);
                }}>Cloud it</button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------- Sheet index ----------------

type SheetScope = 'empty' | 'current' | 'all';

function SheetsTab({ doc, busy, run, cancel, readOnly, onApply, onGoto, onMessage }: {
  doc: Doc; busy: boolean; run: Run; cancel: { current: boolean }; readOnly: boolean;
  onApply(docId: string, s: Record<number, Partial<SheetMeta>>): void; onGoto(docId: string, page: number): void; onMessage(m: string): void;
}) {
  const [scope, setScope] = useState<SheetScope>('empty');
  const [found, setFound] = useState<Record<number, SheetMeta>>({});
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState('');

  const pages = Array.from({ length: doc.numPages }, (_, i) => i).filter((i) =>
    scope === 'all' ? true : scope === 'current' ? i === doc.page : !doc.sheets[i]?.number?.trim());

  const go = () => run('Reading title blocks…', async () => {
    setFound({});
    setSkip(new Set());
    let failed = 0;
    await eachPage(pages, async (p) => {
      try {
        const img = await pageImage(doc.pdf, p, 2000);
        const text = await cachedText(doc.pdf, p, doc.textCache);
        const meta = parseSheet(await ask({ system: SHEET_SYSTEM, parts: [img.part, { text: sheetPrompt(text) }], json: true, temperature: 0 }));
        if (meta) setFound((f) => ({ ...f, [p]: meta }));
        else failed++;
      } catch (e) {
        if (/API key|quota|rate limit|not found/i.test(errorText(e))) throw e;
        failed++;
      }
    }, (done, total) => setProgress(`${done}/${total} pages`), () => cancel.current);
    setProgress(failed ? `Done. ${failed} page(s) could not be read.` : 'Done.');
  });

  const apply = () => {
    const out: Record<number, Partial<SheetMeta>> = {};
    for (const [k, meta] of Object.entries(found)) {
      const p = Number(k);
      if (skip.has(p)) continue;
      // Only fill fields the AI actually read, so existing values are never blanked.
      out[p] = Object.fromEntries(Object.entries(meta).filter(([, v]) => v)) as Partial<SheetMeta>;
    }
    onApply(doc.id, out);
    onMessage(`Sheet index updated for ${Object.keys(out).length} page(s). Review it in Sheet index.`);
    setFound({});
  };

  const rows = Object.entries(found).map(([k, v]) => [Number(k), v] as const).sort((a, b) => a[0] - b[0]);
  return (
    <div>
      <div className="row">
        <select value={scope} onChange={(e) => setScope(e.target.value as SheetScope)}>
          <option value="empty">Pages with no sheet number</option>
          <option value="current">Current page</option>
          <option value="all">All pages (overwrites what the AI reads)</option>
        </select>
        <button className="primary" disabled={busy || readOnly || !pages.length} onClick={() => void go()}>Read {pages.length} page(s)</button>
        <span className="muted small">{progress}</span>
      </div>
      {rows.length > 0 && (
        <>
          <table className="ai-table">
            <thead><tr><th /><th>Pg</th><th>Sheet #</th><th>Title</th><th>Disc.</th><th>Rev</th></tr></thead>
            <tbody>
              {rows.map(([p, m]) => (
                <tr key={p}>
                  <td><input type="checkbox" checked={!skip.has(p)} onChange={(e) => setSkip((s) => { const n = new Set(s); if (e.target.checked) n.delete(p); else n.add(p); return n; })} /></td>
                  <td><a onClick={() => onGoto(doc.id, p)}>{p + 1}</a></td>
                  <td>{m.number}</td><td>{m.title}</td><td>{m.discipline}</td><td>{m.revision}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row"><button className="primary" disabled={busy || readOnly} onClick={apply}>Apply ticked rows</button><button onClick={() => setFound({})}>Discard</button></div>
        </>
      )}
    </div>
  );
}

// ---------------- Spec / compliance check ----------------

function CheckTab({ doc, busy, run, cancel, author, readOnly, onGoto, onAddMarkups, onMessage }: {
  doc: Doc; busy: boolean; run: Run; cancel: { current: boolean }; author: string; readOnly: boolean;
  onGoto(docId: string, page: number): void; onAddMarkups(docId: string, m: Markup[]): void; onMessage(m: string): void;
}) {
  const [requirements, setRequirements] = useState(loadRequirements);
  const [scope, setScope] = useState<'current' | 'all'>('current');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sizes, setSizes] = useState<Record<number, { w: number; h: number }>>({});
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState('');

  const pages = scope === 'current' ? [doc.page] : Array.from({ length: Math.min(doc.numPages, MAX_CHECK_PAGES) }, (_, i) => i);

  const go = () => run('Checking drawings…', async () => {
    saveRequirements(requirements);
    setIssues([]);
    setSkip(new Set());
    setSizes({});
    await eachPage(pages, async (p) => {
      const img = await pageImage(doc.pdf, p, 2000);
      setSizes((s) => ({ ...s, [p]: { w: img.pageW, h: img.pageH } }));
      const text = await cachedText(doc.pdf, p, doc.textCache);
      const found = parseIssues(await ask({ system: CHECK_SYSTEM, parts: [img.part, { text: checkPrompt(requirements, text, doc.sheets[p]?.number) }], json: true }), p);
      setIssues((all) => [...all, ...found]);
    }, (done, total) => setProgress(`${done}/${total} pages`), () => cancel.current);
    setProgress(scope === 'all' && doc.numPages > MAX_CHECK_PAGES ? `Done. Only the first ${MAX_CHECK_PAGES} pages were checked.` : 'Done.');
  });

  const placeable = issues.map((i, n) => [i, n] as const).filter(([i, n]) => i.box && !skip.has(n) && sizes[i.page]);
  const add = () => {
    onAddMarkups(doc.id, placeable.map(([i]) => {
      const s = sizes[i.page];
      return aiCloud(i.page, i.box!, s.w, s.h, SEVERITY_COLOR[i.severity], `[${i.severity.toUpperCase()}] ${i.title}\n${i.detail}`, author);
    }));
    onMessage(`Added ${placeable.length} AI review cloud(s). Each one has the finding as a comment.`);
  };

  return (
    <div>
      <label className="small muted">Requirements, spec clauses or checklist (one per line)</label>
      <textarea rows={6} value={requirements} onChange={(e) => setRequirements(e.target.value)} />
      <div className="row">
        <select value={scope} onChange={(e) => setScope(e.target.value as 'current' | 'all')}>
          <option value="current">Current page</option>
          <option value="all">All pages (max {MAX_CHECK_PAGES})</option>
        </select>
        <button className="primary" disabled={busy || !requirements.trim()} onClick={() => void go()}>Check {pages.length} page(s)</button>
        <button disabled={busy} onClick={() => setRequirements(DEFAULT_REQUIREMENTS)}>Reset checklist</button>
        <span className="muted small">{progress}</span>
      </div>
      {issues.length === 0 && progress.startsWith('Done') && <p className="muted">No issues found.</p>}
      {issues.map((i, n) => (
        <div key={n} className="item" onClick={() => onGoto(doc.id, i.page)}>
          <input type="checkbox" disabled={!i.box} checked={!!i.box && !skip.has(n)} onClick={(e) => e.stopPropagation()} onChange={(e) => setSkip((s) => { const x = new Set(s); if (e.target.checked) x.delete(n); else x.add(n); return x; })} />
          <span className="ai-dot" style={{ background: SEVERITY_COLOR[i.severity] }} />
          <div className="grow">
            <b>p{i.page + 1} · {i.title}</b>
            <div className="muted small">{i.detail}{!i.box && ' (no location given, cannot be clouded)'}</div>
          </div>
        </div>
      ))}
      {placeable.length > 0 && !busy && (
        <div className="row"><button className="primary" disabled={readOnly} onClick={add}>Add {placeable.length} as cloud markups</button></div>
      )}
    </div>
  );
}

// ---------------- Compare summary ----------------

function CompareTab({ doc, docs, busy, run, author, readOnly, onGoto, onAddMarkups, onMessage }: {
  doc: Doc; docs: Doc[]; busy: boolean; run: Run; author: string; readOnly: boolean;
  onGoto(docId: string, page: number): void; onAddMarkups(docId: string, m: Markup[]): void; onMessage(m: string): void;
}) {
  const [oldId, setOldId] = useState(docs.find((d) => d.id !== doc.id)?.id ?? doc.id);
  const [newId, setNewId] = useState(doc.id);
  const [oldPage, setOldPage] = useState(0);
  const [newPage, setNewPage] = useState(doc.page);
  const [result, setResult] = useState<{ r: CompareSummary; docId: string; page: number; w: number; h: number } | null>(null);
  const oldDoc = docs.find((d) => d.id === oldId);
  const newDoc = docs.find((d) => d.id === newId);
  const same = oldId === newId && oldPage === newPage;

  const go = () => run('Comparing revisions…', async () => {
    if (!oldDoc || !newDoc) return;
    setResult(null);
    const a = await pageImage(oldDoc.pdf, oldPage, 1800);
    const b = await pageImage(newDoc.pdf, newPage, 1800);
    const label = (d: Doc, p: number) => `${d.name}, page ${p + 1}${d.sheets[p]?.revision ? `, rev ${d.sheets[p].revision}` : ''}`;
    const text = comparePrompt(await cachedText(oldDoc.pdf, oldPage, oldDoc.textCache), await cachedText(newDoc.pdf, newPage, newDoc.textCache), label(oldDoc, oldPage), label(newDoc, newPage));
    const r = parseCompare(await ask({ system: COMPARE_SYSTEM, parts: [a.part, b.part, { text }], json: true }));
    setResult({ r, docId: newDoc.id, page: newPage, w: b.pageW, h: b.pageH });
  });

  const pageSelect = (d: Doc | undefined, value: number, set: (n: number) => void) => (
    <select value={value} onChange={(e) => set(+e.target.value)}>
      {Array.from({ length: d?.numPages ?? 0 }, (_, i) => <option key={i} value={i}>p{i + 1}{d?.sheets[i]?.number ? ` ${d.sheets[i].number}` : ''}</option>)}
    </select>
  );
  const boxed = result?.r.changes.filter((c) => c.box) ?? [];
  const summaryText = result ? `${result.r.summary}\n\n${result.r.changes.map((c) => `- [${c.kind}] ${c.description}`).join('\n')}` : '';

  return (
    <div>
      <div className="row">
        <span>Old:</span>
        <select value={oldId} onChange={(e) => { setOldId(e.target.value); setOldPage(0); }}>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        {pageSelect(oldDoc, oldPage, setOldPage)}
      </div>
      <div className="row">
        <span>New:</span>
        <select value={newId} onChange={(e) => { setNewId(e.target.value); setNewPage(0); }}>{docs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
        {pageSelect(newDoc, newPage, setNewPage)}
        <button className="primary" disabled={busy || same || !oldDoc || !newDoc} onClick={() => void go()}>Summarise changes</button>
      </div>
      {docs.length < 2 && <p className="muted small">Open the other revision as a second PDF, or pick two pages of this one.</p>}
      {result && (
        <div className="ai-card">
          <p className="ai-answer">{result.r.summary}</p>
          {result.r.changes.map((c, i) => (
            <div key={i} className="item" onClick={() => onGoto(result.docId, result.page)}>
              <span className="ai-dot" style={{ background: CHANGE_COLOR[c.kind] }} />
              <div className="grow"><b>{c.kind}</b> <span className="small">{c.description}</span></div>
            </div>
          ))}
          <div className="row">
            <button onClick={() => void navigator.clipboard?.writeText(summaryText).then(() => onMessage('Change summary copied.'), () => onMessage('Could not copy to the clipboard.'))}>Copy summary</button>
            {boxed.length > 0 && (
              <button className="primary" disabled={readOnly} onClick={() => {
                onAddMarkups(result.docId, boxed.map((c) => aiCloud(result.page, c.box!, result.w, result.h, CHANGE_COLOR[c.kind], `[${c.kind.toUpperCase()}] ${c.description}`, author)));
                onMessage(`Added ${boxed.length} change cloud(s) to the new revision.`);
              }}>Cloud {boxed.length} change(s) on new revision</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
