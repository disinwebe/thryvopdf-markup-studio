import { useEffect, useRef, useState } from 'react';
import type { Comment } from '../core/types';

export function EditCommentsPopup({ comments, onSave, onCancel }: {
  comments: Comment[];
  onSave(edits: Record<string, string>): void;
  onCancel(): void;
}) {
  const [edits, setEdits] = useState(() => Object.fromEntries(comments.map((comment) => [comment.id, comment.text])));
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const changed = comments.some((comment) => edits[comment.id]?.trim() && edits[comment.id].trim() !== comment.text);
  return (
    <div className="modal">
      <div className="usermgmt comment-popup" role="dialog" aria-modal="true" aria-labelledby="edit-comments-title">
        <h3 id="edit-comments-title">Edit your comments</h3>
        {comments.map((comment, index) => (
          <label key={comment.id} htmlFor={`edit-comment-${comment.id}`}>
            Comment {index + 1}
            <textarea
              id={`edit-comment-${comment.id}`}
              ref={index === 0 ? input : undefined}
              spellCheck
              rows={4}
              value={edits[comment.id] ?? ''}
              onChange={(event) => setEdits((current) => ({ ...current, [comment.id]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  onCancel();
                }
              }}
            />
          </label>
        ))}
        <p className="muted small">Only comments you authored can be edited.</p>
        <div className="row">
          <button className="primary" disabled={!changed} onClick={() => onSave(edits)}>Save changes</button>
          <button onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
