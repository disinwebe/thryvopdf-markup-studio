import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import AuthGate from '../src/components/AuthGate';
import { closeSharedLibraryOnEscape, fitSharedThumbnail, SharedDocumentThumbnail, SharedLibrary } from '../src/components/SharedLibrary';
import { MarkupShape } from '../src/components/MarkupShape';
import { NotificationBell } from '../src/components/Notifications';
import { renamedTab } from '../src/app/model';
import { DEFAULT_CAL } from '../src/core/measurement';
import { TabNameEditor } from '../src/components/TabNameEditor';

const user: AuthUser = { name: 'Reader', email: 'reader@example.test', discipline: '', role: 'admin' };
const actions = { serverMode: true, logout: vi.fn(), changePassword: vi.fn() };

describe('read-only viewer UI', () => {
  it('renders imported highlights at full opacity', () => {
    const markup = {
      id: 'legacy-highlight', type: 'highlight' as const, page: 0, points: [{ x: 1, y: 1 }, { x: 30, y: 20 }],
      color: '#ffeb3b', width: 2, opacity: 0.25, status: 'None' as const, author: 'Reader',
      date: '2026-01-01T00:00:00Z', comments: [],
    };
    const html = renderToStaticMarkup(<MarkupShape m={markup} cal={DEFAULT_CAL} />);
    expect(html).toContain('opacity="1"');
  });

  it('renders the local workspace without showing an account gate', () => {
    const html = renderToStaticMarkup(<AuthGate>{(currentUser) => <div>{currentUser.name} workspace</div>}</AuthGate>);
    expect(html).toContain('Local user workspace');
    expect(html).not.toContain('auth-card');
  });

  it('uses the Windows logon name for the signed-out local identity', () => {
    vi.stubGlobal('window', { api: { localUserName: 'Tito.SASEC' } });
    try {
      const html = renderToStaticMarkup(<AuthGate>{(currentUser) => <div>{currentUser.name} workspace</div>}</AuthGate>);
      expect(html).toContain('Tito.SASEC workspace');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('offers optional server sign-in without blocking the local workspace', () => {
    const html = renderToStaticMarkup(<NotificationBell api={null} onSignIn={vi.fn()} />);
    expect(html).toContain('Sign in for collaboration');
  });

  it('shows a viewer notice and measurement tools disabled without a license', () => {
    const html = renderToStaticMarkup(<App user={user} actions={actions} viewOnly licenseStatus={{ ok: false }} onImportLicense={vi.fn()} />);
    expect(html).toContain('Read-only viewer mode');
    expect(html).toContain('Open PDF');
    expect(html).toContain('Open Shared...');
    expect(html).not.toContain('Open Shared Documents</button>');
    expect(html).toContain('class="bar tools measurement-tools"');
    expect(html).toContain('title="Length" class="" disabled=""');
    expect(html).toContain('title="Spline" class="" disabled=""');
    expect(html).toContain('toolbar-command-label">Measurements (0)</span></button>');
    expect(html).toMatch(/<button disabled=""[^>]*><svg[^>]*>[\s\S]*?<\/svg><span class="toolbar-command-label">Save<\/span><\/button>/);
  });

  it('disables shared uploads in viewer mode', () => {
    const html = renderToStaticMarkup(<SharedLibrary me={user} activeName="file.pdf" readOnly onClose={vi.fn()} onOpen={vi.fn()} onUpload={vi.fn()} onChanged={vi.fn()} />);
    expect(html).toContain('shared documents and live markups are read-only');
    expect(html).toMatch(/disabled=""[^>]*>Upload PDFs/);
    expect(html).toMatch(/disabled=""[^>]*>Upload project folder/);
  });

  it('adds a page 1 preview column for shared server documents', () => {
    const document = {
      id: 'shared-1',
      name: 'plan.pdf',
      owner: 'Reader',
      size: 1024,
      created: '2026-11-22T10:00:00Z',
      version: 1,
      markups: 0,
      users: [],
    };
    const html = renderToStaticMarkup(<SharedDocumentThumbnail document={document} />);
    expect(html).toContain('shared-document-thumbnail');
    expect(html).toContain('role="img"');
    expect(html).toContain('Page 1 preview of plan.pdf');
  });

  it('fits shared page previews to their orientation without changing aspect ratio', () => {
    expect(fitSharedThumbnail(1200, 600)).toEqual({ scale: 0.08, width: 96, height: 48 });
    expect(fitSharedThumbnail(600, 1200)).toEqual({ scale: 0.10333333333333333, width: 62, height: 124 });
  });

  it('keeps the shared library header identifiable and closes it on Escape', () => {
    const html = renderToStaticMarkup(<SharedLibrary me={user} onClose={vi.fn()} onOpen={vi.fn()} onUpload={vi.fn()} onChanged={vi.fn()} />);
    expect(html).toContain('shared-library-header');
    const onClose = vi.fn();
    const preventDefault = vi.fn();
    closeSharedLibraryOnEscape({ key: 'Enter', preventDefault }, onClose);
    expect(onClose).not.toHaveBeenCalled();
    closeSharedLibraryOnEscape({ key: 'Escape', preventDefault }, onClose);
    expect(onClose).toHaveBeenCalledOnce();
    expect(preventDefault).toHaveBeenCalledOnce();
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
    expect(html).toMatch(/toolbar-command-label">Open…<\/span><\/button><button[^>]*>[\s\S]*?toolbar-command-label">Open Shared\.\.\.<\/span><\/button>/);
    const offline = renderToStaticMarkup(<App user={user} actions={{ ...actions, serverMode: false }} viewOnly licenseStatus={{ ok: false }} onImportLicense={vi.fn()} />);
    expect(offline).toMatch(/<button title="Sign in to open shared documents"/);
  });

  it('does not show a separate pending-registration alert in the toolbar', () => {
    const html = renderToStaticMarkup(<App user={user} actions={{ ...actions, manageUsers: vi.fn() }} />);
    expect(html).not.toContain('pending-registrations');
    expect(html).not.toContain('Signed in:');
    expect(html).not.toContain('toolbar-logout');
  });

  it('does not show account or logout controls in the file toolbar', () => {
    const html = renderToStaticMarkup(<App user={user} actions={actions} viewOnly licenseStatus={{ ok: false }} />);
    expect(html).not.toContain('Signed in:');
    expect(html).not.toContain('toolbar-logout');
  });

  it('shows all toolbar groups on the welcome screen without restore buttons', () => {
    const notifications = { state: { notifications: [], unread: 0, error: null }, markRead: vi.fn(), clearAll: vi.fn() };
    const html = renderToStaticMarkup(<App user={user} actions={{ ...actions, notifications }} viewOnly licenseStatus={{ ok: false }} />);
    expect(html).not.toContain('<div class="toolbar-groups" hidden="">');
    expect(html).toContain('aria-label="Move File management toolbar"');
    expect(html).toContain('aria-label="Move Content tools toolbar"');
    expect(html).toContain('aria-label="Move Markup tools toolbar"');
    expect(html).toContain('aria-label="Move Measurement tools toolbar"');
    expect(html).toContain('aria-label="0 unread notifications"');
    expect(html).not.toContain('toolbar-group-restore');
    expect(html).not.toContain('Show File management');
    expect(html).not.toContain('Show Content tools');
    expect(html).not.toContain('Show Markup tools');
    expect(html).not.toContain('Show Measurement tools');
    expect(html).not.toContain('aria-label="Dock ');
    expect(html).not.toContain('Top edge</option>');
    expect(html).not.toContain('type="range"');
  });

  it('places Undo and Redo between Pan and Text in the Content tools toolbar', () => {
    const html = renderToStaticMarkup(<App user={user} actions={actions} viewOnly licenseStatus={{ ok: false }} />);
    const fileGroup = html.indexOf('aria-label="Move File management toolbar"');
    const contentGroup = html.indexOf('aria-label="Move Content tools toolbar"');
    const markupGroup = html.indexOf('aria-label="Move Markup tools toolbar"');
    const measureGroup = html.indexOf('aria-label="Move Measurement tools toolbar"');
    expect(fileGroup).toBeLessThan(contentGroup);
    expect(contentGroup).toBeLessThan(markupGroup);
    expect(markupGroup).toBeLessThan(measureGroup);
    const fileTools = html.slice(fileGroup, contentGroup);
    const contentTools = html.slice(contentGroup, markupGroup);
    expect(fileTools).toContain('toolbar-command-label">Viewer</span>');
    expect(fileTools).toContain('toolbar-command-label">Compare</span>');
    expect(fileTools).not.toContain('toolbar-command-label">Undo</span>');
    expect(fileTools).not.toContain('toolbar-command-label">Redo</span>');
    for (const label of ['Select', 'Pan', 'Undo', 'Redo', 'Text', 'Symbol', 'Signatures']) {
      expect(contentTools).toContain(`toolbar-command-label">${label}</span>`);
    }
    const pan = contentTools.indexOf('toolbar-command-label">Pan</span>');
    const undo = contentTools.indexOf('toolbar-command-label">Undo</span>');
    const redo = contentTools.indexOf('toolbar-command-label">Redo</span>');
    const text = contentTools.indexOf('toolbar-command-label">Text</span>');
    const panSeparator = contentTools.indexOf('<span class="sep"></span>', pan);
    const textSeparator = contentTools.indexOf('<span class="sep"></span>', redo);
    expect(panSeparator).toBeGreaterThan(pan);
    expect(undo).toBeGreaterThan(panSeparator);
    expect(redo).toBeGreaterThan(undo);
    expect(textSeparator).toBeGreaterThan(redo);
    expect(text).toBeGreaterThan(textSeparator);
  });

  it('places current-page rotation actions between Save As and Viewer with distinct shortcuts', () => {
    const html = renderToStaticMarkup(<App user={user} actions={actions} />);
    const fileGroup = html.indexOf('aria-label="Move File management toolbar"');
    const contentGroup = html.indexOf('aria-label="Move Content tools toolbar"');
    const fileTools = html.slice(fileGroup, contentGroup);
    const saveAs = fileTools.indexOf('toolbar-command-label">Save as…</span>');
    const clockwise = fileTools.indexOf('toolbar-command-label">Rotate clockwise</span>');
    const counterClockwise = fileTools.indexOf('toolbar-command-label">Rotate counter-clockwise</span>');
    const viewer = fileTools.indexOf('toolbar-command-label">Viewer</span>');
    expect(saveAs).toBeGreaterThan(-1);
    expect(clockwise).toBeGreaterThan(saveAs);
    expect(counterClockwise).toBeGreaterThan(clockwise);
    expect(viewer).toBeGreaterThan(counterClockwise);
    expect(fileTools).toContain('Rotate current page clockwise (Ctrl+Shift+Right)');
    expect(fileTools).toContain('Rotate current page counter-clockwise (Ctrl+Shift+Left)');
  });
});
