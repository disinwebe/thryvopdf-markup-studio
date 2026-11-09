import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MeasurePanel } from '../src/components/MeasurePanel';

describe('measurement takeoff panel', () => {
  it('renders the takeoff summary as a full-width table, not a grid layout', () => {
    const html = renderToStaticMarkup(
      <MeasurePanel
        doc={{ page: 0, calibrations: {}, markups: [] } as never}
        pending={null}
        subject=""
        onSubject={vi.fn()}
        onTool={vi.fn()}
        onSetCal={vi.fn()}
        onClearPending={vi.fn()}
        onExport={vi.fn()}
        onMessage={vi.fn()}
      />,
    );
    expect(html).toContain('<table class="takeoff-table">');
    expect(html).not.toContain('<table class="grid">');
    expect(html).toContain('<th>Subject</th><th>Type</th><th>Items</th><th>Total</th>');
  });
});
