import { useMemo, useState } from 'react';
import { Doc, TOOL_LABEL } from '../app/model';
import { defaultSubject, measureLabel, DEFAULT_CAL, toCsv } from '../core/measurement';
import { Actor, canDeleteComment, canEditComment } from '../core/comments';
import { numberMarkups } from '../core/numbering';
import { Markup, STATUSES, STAMPS, Status, isMeasure, uid } from '../core/types';

export interface MarkupsPanelProps {
  doc: Doc;
  selectedId: string | null;
  author: string;
  user: Actor;
  onSelect(id: string): void;
  onUpdate(id: string, patch: Partial<Markup>, key?: string): void;
  onDelete(id: string): void;
  onExport(csv: string): void;
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
          const hay = [m.type, m.text, m.subject, m.author, m.status, ...m.comments.map((c) => c.text)].join(' ').toLowerCase();
          return hay.includes(q.toLowerCase());
        })
        .sort((a, b) => a.page - b.page || (a.date ?? '').localeCompare(b.date ?? '')),
    [doc.markups, q, status, scope, doc.page],
  );
  const nums = numberMarkups(doc.markups);
  const sel = doc.markups.find((m) => m.id === p.selectedId) ?? null;

  const exportCsv = () => {
    const out: unknown[][] = [['Page', 'Type', 'Subject', 'Text', 'Status', 'Author', 'Date', 'Comments']];
    for (const m of doc.markups)
      out.push([m.page + 1, TOOL_LABEL[m.type], m.subject ?? '', m.text ?? '', m.status, m.author, m.date, m.comments.map((c) => `${c.author}: ${c.text}`).join(' | ')]);
    p.onExport(toCsv(out));
  };

  return (
    <div className="panel-body">
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
        <button onClick={exportCsv} title="Export markup list as CSV">CSV</button>
      </div>
      <div className="list">
        {rows.length === 0 && <p className="muted">No markups.</p>}
        {rows.map((m) => (
          <div key={m.id} className={'item' + (m.id === p.selectedId ? ' active' : '')} onClick={() => p.onSelect(m.id)}>
            <span className="swatch" style={{ background: m.color }} />
            <div className="grow">
              <b className="review-no">#{nums.get(m.id)}</b> <b>{TOOL_LABEL[m.type]}</b> <span className="muted">p{m.page + 1}</span>
              <div className="muted small">
                {(m.subject || m.text || m.stamp || '').slice(0, 40)} · {m.author} · {new Date(m.date).toLocaleDateString()}
                {m.comments.length ? ` · 💬${m.comments.length}` : ''}
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

function Properties({ m, doc, onUpdate, onDelete, author, user }: { m: Markup; doc: Doc } & MarkupsPanelProps) {
  const [comment, setComment] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const upd = (patch: Partial<Markup>, key?: string) => onUpdate(m.id, patch, key);
  const cal = doc.calibrations[m.page] ?? DEFAULT_CAL;
  const hasFill = ['rect', 'ellipse', 'cloud', 'text', 'callout', 'm-area'].includes(m.type);
  return (
    <div className="props">
      <h4>
        {TOOL_LABEL[m.type]} properties
        <button className="danger" onClick={() => onDelete(m.id)}>Delete</button>
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
      <label>
        Opacity
        <input type="range" min={0.1} max={1} step={0.05} value={m.opacity} onChange={(e) => upd({ opacity: +e.target.value }, 'opacity')} />
        <span>{Math.round(m.opacity * 100)}%</span>
      </label>
      {hasFill && m.type !== 'm-area' && (
        <label>
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
        <label>
          Stamp
          <select value={m.stamp} onChange={(e) => upd({ stamp: e.target.value })}>
            {STAMPS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
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
      <div className="muted small" title="Internal annotation ID, saved as /NM in the PDF">Comment #{numberMarkups(doc.markups).get(m.id)} · internal ID: {m.id}</div>
      <h4>Comments</h4>
      {m.comments.map((c) => (
        <div key={c.id} className="comment" title={'Comment ID ' + c.id}>
          <b>{c.author}</b> <span className="muted small">{new Date(c.date).toLocaleString()}</span>
          {c.edited && <span className="muted small"> (edited)</span>}
          {editing?.id === c.id ? (
            <div>
              <textarea value={editing.text} rows={3} onChange={(e) => setEditing({ id: c.id, text: e.target.value })} />
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
          {editing?.id !== c.id && (
            <div className="row">
              {canEditComment(c, user) && <button onClick={() => setEditing({ id: c.id, text: c.text })}>Edit</button>}
              {canDeleteComment(c, user) && <button className="danger" onClick={() => upd({ comments: m.comments.filter((x) => x.id !== c.id) })}>Delete</button>}
            </div>
          )}
        </div>
      ))}
      <div className="row">
        <input
          value={comment}
          placeholder="Add a comment / reply"
          onChange={(e) => setComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && comment.trim()) {
              upd({ comments: [...m.comments, { id: uid(), author, authorEmail: user.email, date: new Date().toISOString(), text: comment.trim() }] });
              setComment('');
            }
          }}
        />
      </div>
    </div>
  );
}
