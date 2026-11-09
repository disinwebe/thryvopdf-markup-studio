import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { SharedLibrary } from '../src/components/SharedLibrary';
import { renamedTab } from '../src/app/model';
import { TabNameEditor } from '../src/components/TabNameEditor';

const user: AuthUser = { name: 'Reader', email: 'reader@example.test', discipline: '', role: 'admin' };
const actions = { serverMode: true, logout: vi.fn(), changePassword: vi.fn() };

describe('read-only viewer UI', () => {
  it('shows a viewer notice and the two welcome actions without Measurements', () => {
    const html = renderToStaticMarkup(<App user={user} actions={actions} viewOnly licenseStatus={{ ok: false }} onImportLicense={vi.fn()} />);
    expect(html).toContain('Read-only viewer mode');
    expect(html).toContain('Open PDF');
    expect(html).toContain('Open Shared...');
    expect(html).not.toContain('Open Shared Documents</button>');
    expect(html).not.toContain('Measurements');
    expect(html).toMatch(/<button disabled=""[^>]*><svg[^>]*>[\s\S]*?<\/svg>Save<\/button>/);
  });

  it('disables shared uploads in viewer mode', () => {
    const html = renderToStaticMarkup(<SharedLibrary me={user} activeName="file.pdf" readOnly onClose={vi.fn()} onOpen={vi.fn()} onUpload={vi.fn()} onChanged={vi.fn()} />);
    expect(html).toContain('shared documents and live markups are read-only');
    expect(html).toMatch(/disabled=""[^>]*>Upload PDFs/);
    expect(html).toMatch(/disabled=""[^>]*>Upload project folder/);
  });

  it('allows local tab aliases but never shared tab aliases', () => {
    expect(renamedTab({ name: 'file.pdf' }, ' New name.pdf ')).toBe('New name.pdf');
    expect(renamedTab({ name: 'file.pdf' }, '../file.pdf')).toBeNull();
    expect(renamedTab({ name: 'file.pdf', shared: { id: 's', version: 0, pr: 0, synced: {}, collaborators: [], status: 'live' } }, 'renamed.pdf')).toBeNull();
  });

  it('renders an inline tab editor with save and cancel controls', () => {
    const html = renderToStaticMarkup(<TabNameEditor name="old.pdf" onSave={vi.fn()} onCancel={vi.fn()} />);
    expect(html).toContain('aria-label="Tab name"');
    expect(html).toContain('value="old.pdf"');
    expect(html).toContain('aria-label="Save tab name"');
    expect(html).toContain('aria-label="Cancel tab rename"');
  });

  it('places the renamed shared documents action directly after open in the toolbar', () => {
    const html = renderToStaticMarkup(<App user={user} actions={actions} viewOnly licenseStatus={{ ok: false }} onImportLicense={vi.fn()} />);
    expect(html).toMatch(/Open…<\/button><button[^>]*>[\s\S]*?Open Shared\.\.\.<\/button>/);
    const offline = renderToStaticMarkup(<App user={user} actions={{ ...actions, serverMode: false }} viewOnly licenseStatus={{ ok: false }} onImportLicense={vi.fn()} />);
    expect(offline).toMatch(/<button disabled="" title="Shared documents require server mode"/);
  });

  it('places pending registrations next to signed-in information in the toolbar', () => {
    const html = renderToStaticMarkup(<App user={user} actions={{ ...actions, manageUsers: vi.fn(), pendingRegistrations: { status: 'ready', count: 2 } }} />);
    expect(html).toMatch(/Signed in:[\s\S]*<\/span><aside class="pending-registrations"[\s\S]*<\/aside><button class="toolbar-logout"/);
    expect(html).toContain('>Logout</button>');
    expect(html).toContain('class="badge">2');
  });

  it('does not show an account Logout button in the unlicensed guest viewer', () => {
    const html = renderToStaticMarkup(<App user={user} actions={actions} viewOnly licenseStatus={{ ok: false }} />);
    expect(html).not.toContain('class="toolbar-logout"');
  });
});
