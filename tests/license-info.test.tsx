import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LicenseInfo } from '../src/components/LicenseInfo';

describe('license information dialog', () => {
  it('shows verified license and device request without secret material', () => {
    const html = renderToStaticMarkup(<LicenseInfo status={{ ok: true, id: 'license-id', device: 'request-hash' }} onClose={() => {}} />);
    expect(html).toContain('Activated');
    expect(html).toContain('Perpetual, one device');
    expect(html).toContain('license-id');
    expect(html).toContain('request-hash');
    expect(html).not.toContain('MachineGuid');
  });
  it('shows failure without claiming a license type', () => {
    const html = renderToStaticMarkup(<LicenseInfo status={{ ok: false, error: 'Unable to verify' }} onClose={() => {}} />);
    expect(html).toContain('Not activated');
    expect(html).toContain('Unable to verify');
    expect(html).not.toContain('Perpetual, one device');
  });
});
