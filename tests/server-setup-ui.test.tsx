import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ServerSetup } from '../src/components/ServerSetup';

describe('server setup UI', () => {
  it('explains lifecycle and firewall without displaying credentials', () => {
    const html = renderToStaticMarkup(<ServerSetup onClose={() => {}} />);
    expect(html).toContain('Server setup and control');
    expect(html).toContain('Listen port');
    expect(html).toContain('Server data folder');
    expect(html).toContain('stops when this application closes');
    expect(html).toContain('No firewall rules are changed automatically');
    expect(html).toContain('unencrypted HTTP');
  });
});
