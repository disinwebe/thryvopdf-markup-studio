const { app, BrowserWindow, ipcMain, dialog, net, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const { createClient } = require('./client.cjs');
const { menuTemplate } = require('./menu.cjs');

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
  const installMenu = (state) => {
    const menu = Menu.buildFromTemplate(menuTemplate(state, (action) => {
      if (action === 'quit' && !rendererSignedIn) app.quit();
      else win.webContents.send('menu-action', action);
    }));
    if (process.platform === 'darwin') Menu.setApplicationMenu(menu);
    else { win.setMenu(menu); win.setMenuBarVisibility(true); }
  };
  installMenu({});
  const onMenuState = (e, state) => {
    if (e.sender !== win.webContents) return;
    rendererSignedIn = state.signedIn === true;
    installMenu({ ...state, signedIn: !!auth.current() && state.signedIn === true });
  };
  ipcMain.on('menu-state', onMenuState);
  win.on('closed', () => ipcMain.removeListener('menu-state', onMenuState));
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

let auth;
const guard = (fn) => (...a) => {
  if (!auth.current()) throw new Error('Not signed in');
  return fn(...a);
};

const toBuf = (p) => {
  allowed.add(p);
  const b = fs.readFileSync(p);
  return { path: p, name: path.basename(p), data: new Uint8Array(b.buffer, b.byteOffset, b.byteLength) };
};

ipcMain.handle('startup-files', guard(() => startupPaths().map(toBuf)));

ipcMain.handle('open-files', guard(async (e, opts = {}) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    properties: ['openFile', ...(opts.multi === false ? [] : ['multiSelections'])],
    filters: opts.filters || [{ name: 'PDF', extensions: ['pdf'] }],
  });
  return r.canceled ? [] : r.filePaths.map(toBuf);
}));

ipcMain.handle('save-file', guard(async (e, { defaultName, data, filters, path: existing }) => {
  const write = (p) => {
    fs.writeFileSync(p, typeof data === 'string' ? data : Buffer.from(data));
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
  auth = createClient({ configFile: path.join(ud, 'server.json'), localFile: path.join(ud, 'users.json'), fetch: net.fetch.bind(net) });
  ipcMain.handle('auth-status', () => auth.status());
  ipcMain.handle('auth-register', (e, a) => auth.register(a || {}));
  ipcMain.handle('auth-login', (e, a) => auth.login(a || {}));
  ipcMain.handle('auth-logout', () => auth.logout());
  ipcMain.handle('quit-app', () => app.quit());
  ipcMain.handle('app-version', () => app.getVersion());
  ipcMain.handle('shared-docs', (e, a = {}) => {
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
  });
  ipcMain.handle('auth-change-password', (e, a) => auth.changePassword(a || {}));
  ipcMain.handle('auth-admin-list', () => auth.adminList());
  ipcMain.handle('auth-admin-action', (e, a) => auth.adminAction(a || {}));
  ipcMain.handle('auth-test', (e, url) => auth.test(url));
  ipcMain.handle('auth-configure', (e, a) => auth.configure(a || {}));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => app.quit());
