import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PdfCommentsList } from '../src/components/PdfComments';

describe('read-only PDF comments', () => {
  it('displays the author and escaped comment text', () => {
    const html = renderToStaticMarkup(<PdfCommentsList comments={[
      { id: 'foreign', subtype: 'Text', author: 'Reviewer', text: 'First line\n<script>not markup</script>' },
    ]} />);
    expect(html).toContain('PDF comments (read-only)');
    expect(html).toContain('Reviewer');
    expect(html).toContain('First line');
    expect(html).toContain('&lt;script&gt;not markup&lt;/script&gt;');
    expect(html).not.toContain('<button');
  });

  it('renders nothing when there are no comments', () => {
    expect(renderToStaticMarkup(<PdfCommentsList comments={[]} />)).toBe('');
  });
});
