import { useEffect, useRef, useState } from 'react';

export function CommentPopup({ onSave, onCancel }: { onSave(text: string): void; onCancel(): void }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  const submit = () => { if (text.trim()) onSave(text.trim()); };
  return (
    <div className="modal">
      <div className="usermgmt comment-popup" role="dialog" aria-modal="true" aria-labelledby="comment-popup-title">
        <h3 id="comment-popup-title">Add comment</h3>
        <label htmlFor="new-markup-comment">Comment</label>
        <textarea id="new-markup-comment" ref={input} spellCheck rows={4} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); }
            else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); submit(); }
          }} />
        <p className="muted small">Enter to add; Shift+Enter for a new line. Cancel leaves the markup without a comment.</p>
        <div className="row"><button className="primary" disabled={!text.trim()} onClick={submit}>Add comment</button><button onClick={onCancel}>Cancel</button></div>
      </div>
    </div>
  );
}
