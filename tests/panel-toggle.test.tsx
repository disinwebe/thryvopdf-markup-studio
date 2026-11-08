import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PanelToggle } from '../src/components/PanelToggle';

describe('independent viewer panel controls', () => {
  it('exposes accessible hide/show state and shortcuts for both sides', () => {
    for (const side of ['left', 'right'] as const) {
      const visible = renderToStaticMarkup(<PanelToggle side={side} visible onToggle={() => {}} />);
      const hidden = renderToStaticMarkup(<PanelToggle side={side} visible={false} onToggle={() => {}} />);
      expect(visible).toContain(`aria-controls="${side}-panel"`);
      expect(visible).toContain(`aria-label="Hide ${side} panel"`);
      expect(visible).toContain('aria-expanded="true"');
      expect(hidden).toContain(`aria-label="Show ${side} panel"`);
      expect(hidden).toContain('aria-expanded="false"');
      expect(hidden).toContain(side === 'left' ? 'Ctrl+Alt+L' : 'Ctrl+Alt+R');
    }
  });
});
