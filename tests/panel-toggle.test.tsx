import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PanelToggle } from '../src/components/PanelToggle';
import { FloatingTools } from '../src/components/FloatingTools';

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

  describe('floating viewer tools', () => {
    it('exposes Select and Pan with shortcuts and the active state', () => {
      const select = renderToStaticMarkup(<FloatingTools tool="select" theme="light" onTool={() => {}} />);
      const pan = renderToStaticMarkup(<FloatingTools tool="hand" theme="light" onTool={() => {}} />);
      expect(select).toMatch(/aria-label="Select" aria-pressed="true"/);
      expect(select).toMatch(/aria-label="Pan" aria-pressed="false"/);
      expect(pan).toMatch(/aria-label="Pan" aria-pressed="true"/);
      expect(select).toContain('Select (V)');
      expect(select).toContain('Pan (H to toggle');
    });
  });
});
