import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CommentPopup } from '../src/components/CommentPopup';
import { SaveIcon } from '../src/components/SaveIcon';
import { isReviewMarkup } from '../src/core/numbering';

describe('new markup comment popup', () => {
  it('provides a labelled modal with cancel and disabled empty submission', () => {
    const html = renderToStaticMarkup(<CommentPopup onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('id="new-markup-comment"');
    expect(html).toContain('disabled="">Add comment');
    expect(html).toContain('>Cancel</button>');
  });
  it('keeps plain lines, stamps, and measurements out of comment numbering and popup eligibility', () => {
    expect(isReviewMarkup({ type: 'line' })).toBe(false);
    expect(isReviewMarkup({ type: 'stamp' })).toBe(false);
    for (const type of ['m-length', 'm-polylength', 'm-spline', 'm-radius', 'm-diameter', 'm-area', 'm-perimeter', 'm-angle', 'm-count'] as const)
      expect(isReviewMarkup({ type })).toBe(false);
    expect(isReviewMarkup({ type: 'cloud' })).toBe(true);
  });
  it('mirrors only the save-as floppy icon', () => {
    const save = renderToStaticMarkup(<SaveIcon />);
    const saveAs = renderToStaticMarkup(<SaveIcon inverted />);
    expect(save).not.toContain('scale(-1 1)');
    expect(saveAs).toContain('translate(16 0) scale(-1 1)');
  });
});
