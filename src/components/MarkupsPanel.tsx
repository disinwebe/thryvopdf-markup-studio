import { useEffect, useMemo, useRef, useState } from 'react';
import { Doc, TOOL_LABEL } from '../app/model';
import { defaultSubject, measureLabel, DEFAULT_CAL } from '../core/measurement';
import { markupCsv } from '../core/markupCsv';
import { COMMENT_SIZE_MAX, COMMENT_SIZE_MIN } from '../core/commentSize';
import { Actor, canDeleteComment, canDeleteMarkup, canEditComment, ownsComment, ownsMarkup } from '../core/comments';
import { isReviewMarkup, numberMarkups } from '../core/numbering';
import { Markup, STATUSES, STAMPS, Status, isMeasure, uid } from '../core/types';
import { PdfComments } from './PdfComments';

export interface MarkupsPanelProps {
  doc: Doc;
  selectedId: string | null;
  author: string;
  user: Actor;
  onSelect(id: string): void;
  onUpdate(id: string, patch: Partial<Markup>, key?: string): void;
  onDelete(id: string): void;
  onExport(csv: string): void;
  commentSize: number;
  onCommentSize(size: number): void;
  readOnly?: boolean;
  focusCommentId?: string | null;
  onCommentFocused?(): void;
}

export function MarkupsPanel(p: MarkupsPanelProps) {
  const { doc } = p;
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<string>('All');
  const [scope, setScope] = useState<'all' | 'page'>('all');
  const rows = useMemo(
    () =>
      doc.markups
        .filter((m) => (scope === 'all' ? true : m.page === doc.page))
        .filter((m) => status === 'All' || m.status === status)
        .filter((m) => {
          if (!q.trim()) return true;
          const hay = [m.type, m.text, m.subject, m.author, m.status, ...(isReviewMarkup(m) ? m.comments.map((c) => c.text) : [])].join(' ').toLowerCase();
          return hay.includes(q.toLowerCase());
        })
        .sort((a, b) => a.page - b.page || (a.date ?? '').localeCompare(b.date ?? '')),
    [doc.markups, q, status, scope, doc.page],
  );
  const nums = numberMarkups(doc.markups);
  const sel = doc.markups.find((m) => m.id === p.selectedId) ?? null;

  const exportCsv = () => {
    p.onExport(markupCsv(doc.markups, doc.path || doc.name));
  };

  return (
    <div className="panel-body">
      <PdfComments pdf={doc.pdf} page={doc.page} />
      <div className="row">
        <input placeholder="Search markups" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="row">
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option>All</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'page')}>
          <option value="all">All pages</option>
          <option value="page">This page</option>
        </select>
        <button onClick={exportCsv} disabled={p.readOnly} title="Export markup list as CSV">CSV</button>
      </div>
      <div className="list">
        {rows.length === 0 && <p className="muted">No markups.</p>}
        {rows.map((m) => (
          <div key={m.id} className={'item' + (m.id === p.selectedId ? ' active' : '')} onClick={() => p.onSelect(m.id)}>
            <span className="swatch" style={{ background: m.color }} />
            <div className="grow">
              {isReviewMarkup(m) && <b className="review-no">#{nums.get(m.id)}</b>} <b>{TOOL_LABEL[m.type]}</b> <span className="muted">p{m.page + 1}</span>
              <div className="muted small">
                {(m.subject || m.text || m.stamp || '').slice(0, 40)} · {m.author} · {new Date(m.date).toLocaleDateString()}
                {isReviewMarkup(m) && m.comments.length ? ` · 💬${m.comments.length}` : ''}
              </div>
            </div>
            <span className={'badge s-' + m.status}>{m.status === 'None' ? '' : m.status}</span>
          </div>
        ))}
      </div>
      {sel && <Properties key={sel.id} {...p} m={sel} doc={doc} />}
    </div>
  );
}

function Properties({ m, doc, onUpdate, onDelete, author, user, commentSize, onCommentSize, readOnly = false, focusCommentId, onCommentFocused }: { m: Markup; doc: Doc } & MarkupsPanelProps) {
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const commentInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusCommentId === m.id) {
      commentInput.current?.focus();
      onCommentFocused?.();
    }
  }, [focusCommentId, m.id, onCommentFocused]);
  const upd = (patch: Partial<Markup>, key?: string) => onUpdate(m.id, patch, key);
  const cal = doc.calibrations[m.page] ?? DEFAULT_CAL;
  const hasFill = ['rect', 'ellipse', 'cloud', 'text', 'callout', 'm-area'].includes(m.type);
  return (
    <div className="props">
      <fieldset className="props-fields" disabled={readOnly || (!!doc.shared && !ownsMarkup(m, user))}>
      <h4>
        {TOOL_LABEL[m.type]} properties
        <button className="danger" disabled={!canDeleteMarkup(m, user)} title={canDeleteMarkup(m, user) ? undefined : "Only the author can delete this markup"} onClick={() => onDelete(m.id)}>Delete</button>
      </h4>
      {isMeasure(m.type) && <div className="muted">{measureLabel(m, cal) || '1 item'}</div>}
      <label>
        Color
        <input type="color" value={m.color} onChange={(e) => upd({ color: e.target.value }, 'color')} />
      </label>
      {m.type !== 'highlight' && (
        <label>
          Line width
          <input type="range" min={1} max={12} value={m.width} onChange={(e) => upd({ width: +e.target.value }, 'width')} />
          <span>{m.width}</span>
        </label>
      )}
      {m.type === 'cloud' && (
        <label>
          Cloud arc diameter ({m.cloudArc ?? 14} pt)
          <input type="range" min={4} max={80} step={1} value={m.cloudArc ?? 14} onChange={(e) => upd({ cloudArc: +e.target.value }, 'cloud-arc')} />
        </label>
      )}
      {m.type === 'm-length' && (
        <>
          <label>
            Endpoint arrowheads
            <select
              aria-label="Measurement endpoint arrowheads"
              value={m.measurementArrowheads ?? 'none'}
              onChange={(e) => upd({ measurementArrowheads: e.target.value as NonNullable<Markup['measurementArrowheads']> }, 'measurement-arrowheads')}
            >
              <option value="none">None</option>
              <option value="start">Start</option>
              <option value="end">End</option>
              <option value="both">Both</option>
            </select>
          </label>
          {m.measurementArrowheads && m.measurementArrowheads !== 'none' && (
            <label>
              Arrow size ({m.measurementArrowSize ?? 8} pt)
              <input
                aria-label="Measurement arrow size"
                type="range"
                min={3}
                max={24}
                step={1}
                value={m.measurementArrowSize ?? 8}
                onChange={(e) => upd({ measurementArrowSize: +e.target.value }, 'measurement-arrow-size')}
              />
            </label>
          )}
        </>
      )}
      <label>
        Opacity
        <input type="range" min={0.1} max={1} step={0.05} value={m.opacity} onChange={(e) => upd({ opacity: +e.target.value }, 'opacity')} />
        <span>{Math.round(m.opacity * 100)}%</span>
      </label>
      {hasFill && m.type !== 'm-area' && (
        <label className="inline-check">
          Fill
          <input type="checkbox" checked={!!m.fill} onChange={(e) => upd({ fill: e.target.checked ? '#ffffff' : undefined })} />
          {m.fill && <input type="color" value={m.fill} onChange={(e) => upd({ fill: e.target.value }, 'fill')} />}
        </label>
      )}
      {(m.type === 'text' || m.type === 'callout') && (
        <label>
          Font size
          <input type="number" min={6} max={72} value={m.fontSize ?? 12} onChange={(e) => upd({ fontSize: +e.target.value || 12 }, 'fs')} />
        </label>
      )}
      {m.type === 'stamp' && (
        <>
          <label>
            Stamp
            <select value={m.stampImage ? '__custom__' : m.stamp} onChange={(e) => upd({ stamp: e.target.value, stampImage: undefined, stampLockAspectRatio: undefined })}>
              {m.stampImage && <option value="__custom__">Custom image</option>}
              {STAMPS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          {m.stampImage && (
            <label className="inline-check">
              Lock aspect ratio
              <input type="checkbox" checked={m.stampLockAspectRatio !== false} onChange={(e) => upd({ stampLockAspectRatio: e.target.checked }, 'stamp-ratio')} />
            </label>
          )}
        </>
      )}
      {(m.type === 'text' || m.type === 'callout' || m.type === 'note') && (
        <textarea
          rows={3}
          placeholder="Text"
          autoFocus={!m.text}
          value={m.text ?? ''}
          onChange={(e) => upd({ text: e.target.value }, 'text')}
        />
      )}
      {isMeasure(m.type) && (
        <label>
          Subject
          <input value={m.subject ?? ''} placeholder={defaultSubject(m)} onChange={(e) => upd({ subject: e.target.value }, 'subject')} />
        </label>
      )}
      <label>
        Status
        <select value={m.status} onChange={(e) => upd({ status: e.target.value as Status })}>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </label>
      <div className="muted small">
        {m.author} · {new Date(m.date).toLocaleString()}
      </div>
      {isReviewMarkup(m) && (
        <>
      <div className="comment-id" title="Internal annotation ID, saved as /NM in the PDF"><span className="comment-id-badge">#{numberMarkups(doc.markups).get(m.id)}</span><span className="muted small">Comment ID: {m.id}</span></div>
      <h4>Comments</h4>
      <label className="inline-check">
        <span>Show comment box on drawing</span>
        <input type="checkbox" checked={!m.calloutHidden} onChange={(e) => upd({ calloutHidden: !e.target.checked })} />
      </label>
      {m.comments.map((c) => (
        <div key={c.id} className="comment" title={'Comment ID ' + c.id}>
          <b>{c.author}</b> <span className="muted small">{new Date(c.date).toLocaleString()}</span>
          {c.edited && <span className="muted small"> (edited)</span>}
          {editing?.id === c.id ? (
            <div>
              <textarea className="comment-input" value={editing.text} rows={3} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} />
              <div className="row">
                <button
                  onClick={() => {
                    if (editing.text.trim()) upd({ comments: m.comments.map((x) => (x.id === c.id ? { ...x, text: editing.text.trim() } : x)) });
                    setEditing(null);
                  }}
                >
                  Save
                </button>
                <button onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div>{c.text}</div>
          )}
          <label className="comment-size">
            Comment text size
            <select
              aria-label={`Comment text size for ${c.author}`}
              value={c.fontSize ?? commentSize}
              disabled={!!doc.shared && !ownsComment(c, user)}
              onChange={(e) => {
                const fontSize = +e.target.value;
                upd({ comments: m.comments.map((item) => item.id === c.id ? { ...item, fontSize: fontSize === commentSize ? undefined : fontSize } : item) });
              }}
            >
              {Array.from({ length: COMMENT_SIZE_MAX - COMMENT_SIZE_MIN + 1 }, (_, i) => COMMENT_SIZE_MIN + i).map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
          {editing?.id !== c.id && (
            <div className="row">
              {canEditComment(c, user) && <button onClick={() => setEditing({ id: c.id, text: c.text })}>Edit</button>}
              {canDeleteComment(c, user) && (!doc.shared || ownsComment(c, user)) && <button className="danger" onClick={() => upd({ comments: m.comments.filter((x) => x.id !== c.id) })}>Delete</button>}
            </div>
          )}
        </div>
      ))}
      <div className="row">
        <textarea
          className="comment-input"
          ref={commentInput}
          rows={2}
          value={comment}
          aria-label="Add Comment"
          placeholder="Add a comment / reply"
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && comment.trim()) {
              e.preventDefault();
              upd({ comments: [...m.comments, { id: uid(), author, authorEmail: user.email, date: new Date().toISOString(), text: comment.trim() }] });
              setComment('');
            }
          }}
        />
      </div>
        </>
      )}
      {!readOnly && <label className="comment-size">
        Default comment text size
        <select value={commentSize} onChange={(e) => onCommentSize(+e.target.value)}>
          {Array.from({ length: COMMENT_SIZE_MAX - COMMENT_SIZE_MIN + 1 }, (_, i) => COMMENT_SIZE_MIN + i).map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>}
      </fieldset>
    </div>
  );
}
