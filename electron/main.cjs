const { app, BrowserWindow, ipcMain, dialog, net, Menu, nativeTheme, nativeImage, clipboard, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { createClient } = require('./client.cjs');
const { menuTemplate, applyNativeTheme } = require('./menu.cjs');
const { createLicenseStore, MAX_LICENSE_BYTES } = require('./license.cjs');
const { renamePdfFile, writeSavedFile } = require('./fileOps.cjs');
const { requireAccess, sharedOperationRequiresLicense } = require('./access.cjs');
const { createServerControl } = require('./server-control.cjs');

// Paths the user opened or saved through a dialog; only these may be overwritten by "Save".
// Keep the pre-rename data folder so existing installs keep their settings and accounts.
app.setName('ThryvoPDF Markup Studio');
app.setPath('userData', process.env.PMS_USER_DATA || path.join(app.getPath('appData'), 'Plan Markup Studio'));
const allowed = new Set();

function startupPaths() {
  const fromArgs = process.argv.slice(1).filter((a) => /\.pdf$/i.test(a) && fs.existsSync(a));
  const fromEnv = (process.env.PMS_OPEN || '').split(';').filter(Boolean);
  return [...fromArgs, ...fromEnv];
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1500,
    height: 950,
    title: 'ThryvoPDF Markup Studio',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  let rendererSignedIn = false;
  let currentMenuState = {};
  const installMenu = (state) => {
    currentMenuState = state;
    const iconForAction = (name) => {
      const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
      const image = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'menu', `${name}-${theme}.png`));
      return image.isEmpty() ? undefined : image.resize({ width: 16, height: 16 });
    };
    const menu = Menu.buildFromTemplate(menuTemplate(state, (action) => {
      if (action === 'quit' && !rendererSignedIn) app.quit();
      else win.webContents.send('menu-action', action);
    }, process.platform, iconForAction));
    if (process.platform === 'darwin') Menu.setApplicationMenu(menu);
    else { win.setMenu(menu); win.setMenuBarVisibility(true); }
  };
  installMenu({});
  const onMenuState = (e, state) => {
    if (e.sender !== win.webContents) return;
    rendererSignedIn = state.signedIn === true;
    const user = auth.current();
    installMenu({ ...state, signedIn: (!!user && state.signedIn === true) || state.viewOnly === true, admin: user?.role === 'admin', passwordAvailable: !!user?.email });
  };
  ipcMain.on('menu-state', onMenuState);
  const onTheme = (e, theme) => {
    if (e.sender === win.webContents && applyNativeTheme(nativeTheme, theme)) installMenu(currentMenuState);
  };
  ipcMain.on('theme', onTheme);
  win.on('closed', () => ipcMain.removeListener('menu-state', onMenuState));
  win.on('closed', () => ipcMain.removeListener('theme', onTheme));
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Automated smoke test: run a script in the page, capture a screenshot, then quit.
  if (process.env.PMS_SCREENSHOT) {
    win.webContents.on('did-finish-load', async () => {
      await new Promise((r) => setTimeout(r, Number(process.env.PMS_WAIT || 4000)));
      let result = null;
      if (process.env.PMS_SCRIPT) {
        try {
          result = await win.webContents.executeJavaScript(fs.readFileSync(process.env.PMS_SCRIPT, 'utf8'));
        } catch (err) {
          result = 'script error: ' + err;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (process.env.PMS_RESULT) fs.writeFileSync(process.env.PMS_RESULT, JSON.stringify(result, null, 2));
      try {
        const img = await win.webContents.capturePage();
        fs.writeFileSync(process.env.PMS_SCREENSHOT, img.toPNG());
      } catch (err) {
        console.error('capture failed', err.message);
      }
      app.quit();
    });
  }
}

let auth, license, serverControl;
const guard = (fn) => (...a) => {
  requireAccess(auth, license, true);
  return fn(...a);
};
const readGuard = (fn) => (...a) => {
  requireAccess(auth, license);
  return fn(...a);
};
const viewerAccess = (fn) => (...a) => {
  if (license.status().ok && !auth.current()) throw new Error('Not signed in');
  return fn(...a);
};

const toBuf = (p) => {
  allowed.add(p);
  const b = fs.readFileSync(p);
  return { path: p, name: path.basename(p), data: new Uint8Array(b.buffer, b.byteOffset, b.byteLength) };
};

ipcMain.handle('startup-files', viewerAccess(() => startupPaths().map(toBuf)));

ipcMain.handle('open-files', viewerAccess(async (e, opts = {}) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    properties: ['openFile', ...(opts.multi === false ? [] : ['multiSelections'])],
    filters: opts.filters || [{ name: 'PDF', extensions: ['pdf'] }],
  });
  return r.canceled ? [] : r.filePaths.map(toBuf);
}));

ipcMain.handle('rename-file', guard((e, args = {}) => renamePdfFile(args.path, args.name, allowed, fs)));

ipcMain.handle('pick-stamp', guard(async (e) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    properties: ['openFile'],
    filters: [{ name: 'Images and PDF', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'pdf'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const p = r.filePaths[0];
  const size = fs.statSync(p).size;
  if (!size || size > 20 * 1024 * 1024) throw new Error('Choose a non-empty image or PDF smaller than 20 MB.');
  const b = fs.readFileSync(p);
  return { path: '', name: path.basename(p), data: new Uint8Array(b.buffer, b.byteOffset, b.byteLength) };
}));

ipcMain.handle('save-file', guard(async (e, { defaultName, data, filters, path: existing }) => {
  const write = (p) => {
    writeSavedFile(p, data, fs);
    allowed.add(p);
    return p;
  };
  if (existing && allowed.has(existing)) return write(existing);
  const r = await dialog.showSaveDialog(BrowserWindow.fromWebContents(e.sender), {
    defaultPath: defaultName,
    filters: filters || [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (r.canceled || !r.filePath) return null;
  return write(r.filePath);
}));

// Files chosen for shared upload; the renderer refers to them by path and main reads them, so whole projects never cross IPC.
const MAX_PICK = 500;
const MAX_FILE = 150 * 1024 * 1024;
const picked = new Map();
const walkPdfs = (root) => {
  const out = [];
  const stack = [root];
  while (stack.length && out.length < MAX_PICK) {
    const dir = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const en of ents) {
      const p = path.join(dir, en.name);
      if (en.isDirectory()) stack.push(p);
      else if (en.isFile() && /\.pdf$/i.test(en.name)) out.push(p);
    }
  }
  return out.sort();
};
ipcMain.handle('pick-uploads', guard(async (e, kind) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  let files = [];
  let root = '';
  let project = '';
  if (kind === 'folder') {
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    root = r.filePaths[0];
    project = path.basename(root);
    files = walkPdfs(root);
  } else {
    const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled) return null;
    files = r.filePaths;
  }
  const items = files.slice(0, MAX_PICK).map((p) => {
    const token = require('crypto').randomUUID();
    let size = 0;
    try { size = fs.statSync(p).size; } catch { /* reported at upload */ }
    picked.set(token, p);
    const rel = root ? path.relative(root, path.dirname(p)).split(path.sep).filter(Boolean).join('/') : '';
    return { token, name: path.basename(p), rel, size };
  });
  return { project, items, truncated: files.length > MAX_PICK };
}));

ipcMain.handle('save-many', guard(async (e, { files }) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  for (const f of files) fs.writeFileSync(path.join(r.filePaths[0], path.basename(f.name)), Buffer.from(f.data));
  return r.filePaths[0];
}));

app.whenReady().then(() => {
  const ud = app.getPath('userData');
  serverControl = createServerControl({ configFile: path.join(ud, 'server-control.json'), defaultDir: path.join(ud, 'server-data') });
  ipcMain.handle('server-control-status', () => serverControl.status());
  ipcMain.handle('server-control-run', (_e, action, config) => serverControl.perform(action, config));
  ipcMain.handle('server-control-folder', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0] || null;
  });
  ipcMain.handle('server-control-copy', (_e, address) => {
    if (!serverControl.status().addresses.includes(address)) throw new Error('Choose a current server address.');
    clipboard.writeText(address);
  });
  ipcMain.handle('server-control-firewall-help', () => shell.openExternal('https://support.microsoft.com/windows/risks-of-allowing-apps-through-windows-firewall-654559af-3f54-3dcf-349f-71ccd90bcc5c'));
  license = createLicenseStore({ file: path.join(ud, 'device-license.json'), publicKeyFile: path.join(__dirname, '..', 'dist', 'license-public.pem') });
  auth = createClient({ configFile: path.join(ud, 'server.json'), localFile: path.join(ud, 'users.json'), fetch: net.fetch.bind(net) });
  ipcMain.handle('license-status', () => license.status());
  ipcMain.handle('license-import', async (e) => {
    const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      properties: ['openFile'], filters: [{ name: 'License files', extensions: ['json', 'license'] }],
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, cancelled: true };
    try {
      if (fs.statSync(r.filePaths[0]).size > MAX_LICENSE_BYTES) return { ok: false, error: 'License file is too large.' };
      return license.activate(fs.readFileSync(r.filePaths[0], 'utf8'));
    } catch { return { ok: false, error: 'Could not read the license file.' }; }
  });
  ipcMain.handle('auth-status', () => auth.status());
  ipcMain.handle('auth-register', (e, a) => auth.register(a || {}));
  ipcMain.handle('auth-login', (e, a) => auth.login(a || {}));
  ipcMain.handle('auth-logout', () => auth.logout());
  ipcMain.handle('quit-app', () => app.quit());
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('show-about', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    await dialog.showMessageBox(win, {
      type: 'info', title: 'About this software', message: `ThryvoPDF Markup Studio ${app.getVersion()}`,
      detail: 'PDF review, markup and shared drawing collaboration.\nDeveloped by: TRL 2026', buttons: ['OK'],
    });
  });
  ipcMain.handle('shared-docs', guard((e, a = {}) => {
    if (!auth.docs) return { ok: false, error: 'Shared documents are unavailable.' };
    if (a.op === 'upload' && a.token) {
      const p = picked.get(a.token);
      if (!p) return { ok: false, error: 'That file was not selected in this session.' };
      try {
        if (fs.statSync(p).size > MAX_FILE) return { ok: false, error: 'File is larger than the 150 MB upload limit.' };
        a = { ...a, bytes: fs.readFileSync(p) };
      } catch (err) {
        return { ok: false, error: 'Could not read the file: ' + err.message };
      }
    }
    return auth.docs(a);
  }));
  // Password changes must remain available during mandatory first-login changes.
  ipcMain.handle('auth-change-password', (e, a) => auth.changePassword(a || {}));
  ipcMain.handle('auth-notifications', readGuard((e, a) => auth.notifications(a || {})));
  ipcMain.handle('auth-admin-list', readGuard(() => auth.adminList()));
  ipcMain.handle('auth-admin-action', readGuard((e, a) => auth.adminAction(a || {})));
  ipcMain.handle('auth-test', (e, url) => auth.test(url));
  ipcMain.handle('auth-configure', (e, a) => auth.configure(a || {}));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => app.quit());
