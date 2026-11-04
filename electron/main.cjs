const { app, BrowserWindow, ipcMain, dialog, net } = require('electron');
const fs = require('fs');
const path = require('path');
const { createClient } = require('./client.cjs');

// Paths the user opened or saved through a dialog; only these may be overwritten by "Save".
if (process.env.PMS_USER_DATA) app.setPath('userData', process.env.PMS_USER_DATA);
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
    title: 'Plan Markup Studio',
    backgroundColor: '#1e1f22',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
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
  ipcMain.handle('auth-test', (e, url) => auth.test(url));
  ipcMain.handle('auth-configure', (e, a) => auth.configure(a || {}));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on('window-all-closed', () => app.quit());
