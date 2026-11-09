import { useEffect, useState } from 'react';
import { pagePdfComments, type PdfComment, type PDFDocumentProxy } from '../pdf/pdfjs';

/** Read-only comments embedded in the PDF, separate from editable app markups. */
export function PdfComments({ pdf, page }: { pdf: PDFDocumentProxy; page: number }) {
  const [comments, setComments] = useState<PdfComment[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setComments([]);
    setError('');
    pagePdfComments(pdf, page).then(
      (items) => { if (active) setComments(items); },
      (reason: unknown) => { if (active) setError(`Could not load PDF comments: ${reason instanceof Error ? reason.message : String(reason)}`); },
    );
    return () => { active = false; };
  }, [pdf, page]);

  return error ? <p className="danger" role="alert">{error}</p> : <PdfCommentsList comments={comments} />;
}

export function PdfCommentsList({ comments }: { comments: PdfComment[] }) {
  if (!comments.length) return null;
  return (
    <aside aria-label="PDF comments" style={{ margin: '12px auto', padding: 12, maxWidth: 600, background: '#fff', color: '#222', border: '1px solid #bbb' }}>
      <strong>PDF comments (read-only)</strong>
      {comments.map((comment) => (
        <div key={comment.id} style={{ marginTop: 8, borderTop: '1px solid #ddd', paddingTop: 8 }}>
          <strong>{comment.author || comment.subtype}</strong>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{comment.text}</div>
        </div>
      ))}
    </aside>
  );
}
