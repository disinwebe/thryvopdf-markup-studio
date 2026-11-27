const { app, BrowserWindow, ipcMain, dialog, net, Menu, nativeTheme, nativeImage, shell, safeStorage } = require('electron');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { createClient } = require('./client.cjs');
const { createAi } = require('./ai.cjs');
const { menuTemplate, applyNativeTheme } = require('./menu.cjs');
const { createLicenseStore, MAX_LICENSE_BYTES } = require('./license.cjs');
const { renamePdfFile, writeSavedFile } = require('./fileOps.cjs');
const { requireAccess, requireSignIn, sharedOperationRequiresLicense } = require('./access.cjs');
const { createWindowCloseGuard } = require('./windowCloseGuard.cjs');
const execFileAsync = promisify(execFile);

// Paths the user opened or saved through a dialog; only these may be overwritten by "Save".
// Keep the pre-rename data folder so existing installs keep their settings and accounts.
app.setName('ThryvoPDF Markup Studio');
app.setPath('userData', process.env.PMS_USER_DATA || path.join(app.getPath('appData'), 'Plan Markup Studio'));
const allowed = new Set();
const pendingOpenPaths = [];
let mainWindow = null;
const hasInstanceLock = app.requestSingleInstanceLock();

function pdfPaths(args, cwd = process.cwd()) {
  return args
    .filter((arg) => typeof arg === 'string' && /\.pdf$/i.test(arg))
    .map((arg) => path.resolve(cwd, arg))
    .filter((file) => fs.existsSync(file));
}

function startupPaths() {
  const fromArgs = pdfPaths(process.argv.slice(1));
  const fromEnv = pdfPaths((process.env.PMS_OPEN || '').split(';').filter(Boolean));
  return [...fromArgs, ...fromEnv];
}

async function windowsPrinterCapabilities(printerName) {
  const encodedName = Buffer.from(printerName, 'utf8').toString('base64');
  const script = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
$name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedName}'))
$settings = New-Object System.Drawing.Printing.PrinterSettings
$settings.PrinterName = $name
if (-not $settings.IsValid) { throw 'The selected printer is not available.' }
$paperSizes = @(
  foreach ($paper in $settings.PaperSizes) {
    if ($paper.Width -gt 0 -and $paper.Height -gt 0) {
      [PSCustomObject]@{ name = [string]$paper.PaperName; width = [int]$paper.Width; height = [int]$paper.Height; rawKind = [int]$paper.RawKind }
    }
  }
)
$paperSources = @(
  foreach ($source in $settings.PaperSources) {
    [PSCustomObject]@{ name = [string]$source.SourceName; rawKind = [int]$source.RawKind }
  }
)
[PSCustomObject]@{
  paperSizes = $paperSizes
  paperSources = $paperSources
  defaultPaper = [string]$settings.DefaultPageSettings.PaperSize.PaperName
  defaultSource = [string]$settings.DefaultPageSettings.PaperSource.SourceName
} | ConvertTo-Json -Compress -Depth 4
`;
  const encodedScript = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', encodedScript,
  ], { windowsHide: true, timeout: 20000, maxBuffer: 1024 * 1024 });
  let result;
  try {
    result = JSON.parse(stdout.trim());
  } catch {
    throw new Error('Windows returned invalid printer capabilities.');
  }
  if (!Array.isArray(result.paperSizes) || !result.paperSizes.length) {
    throw new Error('The selected printer did not report any supported paper sizes.');
  }
  return result;
}

function applySpellCheckerLanguage(win) {
  if (!spellChecker || win.isDestroyed()) return;
  win.webContents.session.setSpellCheckerLanguages([spellChecker.getLanguage()]);
}

async function addPersonalSpellWord(win, word) {
  await spellChecker.addWord(word);
  if (!win.webContents.session.addWordToSpellCheckerDictionary(word)) {
    throw new Error('The system spell checker did not accept the word.');
  }
}

function installSpellCheckContextMenu(win) {
  win.webContents.on('context-menu', (event, params) => {
    const word = params.misspelledWord;
    if (!params.isEditable || !word) return;
    event.preventDefault();
    const suggestions = spellChecker.suggestions(word);
    const template = [
      ...(suggestions.length
        ? suggestions.map((suggestion) => ({ label: suggestion, click: () => win.webContents.replaceMisspelling(suggestion) }))
        : [{ label: 'No suggestions', enabled: false }]),
      { type: 'separator' },
      {
        label: 'Add to dictionary',
        click: () => {
          void addPersonalSpellWord(win, word)
            .then(() => win.webContents.replaceMisspelling(word))
            .catch((error) => dialog.showMessageBox(win, {
              type: 'error', title: 'Personal dictionary', message: 'Could not add this word.',
              detail: error.message, buttons: ['OK'],
            }));
        },
      },
      { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ];
    Menu.buildFromTemplate(template).popup({ window: win });
  });
}

function queueOpenFiles(args, cwd) {
  pendingOpenPaths.push(...pdfPaths(args, cwd));
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
  const notify = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send('open-files-pending');
  };
  if (mainWindow.webContents.isLoading()) mainWindow.webContents.once('did-finish-load', notify);
  else notify();
}

if (hasInstanceLock) {
  app.on('second-instance', (_event, argv, cwd) => queueOpenFiles(argv.slice(1), cwd));
  app.on('open-file', (event, file) => {
    event.preventDefault();
    queueOpenFiles([file], path.dirname(file));
  });
} else app.quit();

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
      spellcheck: true,
    },
  });
  win.maximize();
  mainWindow = win;
  applySpellCheckerLanguage(win);
  installSpellCheckContextMenu(win);
  const closeGuard = createWindowCloseGuard(win);
  let rendererSignedIn = false;
  let currentMenuState = {};
  const installMenu = (state) => {
    currentMenuState = state;
    const iconForAction = (name) => {
      const theme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
      const graphics = {
        open: '<path d="M3 7h7l2 2h9v10H3z"/><path d="M3 10h18l-2 9H5z"/>',
        save: '<path d="M5 3h12l4 4v14H5z"/><path d="M8 3v6h9V3M8 21v-8h10v8"/>',
        saveAs: '<path d="M5 3h12l4 4v14H5z"/><path d="M8 3v6h9V3M8 21v-8h10v8"/><path d="M18 5v5m-2.5-2.5h5"/>',
        export: '<path d="M4 13v7h16v-7M12 16V3m-5 5 5-5 5 5"/>',
        close: '<path d="M5 5l14 14M19 5 5 19"/>',
        key: '<circle cx="8" cy="12" r="5"/><path d="M13 12h8m-3 0v3m-3-3v2"/>',
        exit: '<path d="M10 4H5v16h5M14 8l4 4-4 4m4-4H9"/>',
        undo: '<path d="M9 8 4 12l5 4v-3h5c4 0 6 2 6 6 2-2 2-5 1-7-1-3-4-4-7-4H9z"/>',
        redo: '<path d="m15 8 5 4-5 4v-3h-5c-4 0-6 2-6 6-2-2-2-5-1-7 1-3 4-4 7-4h5z"/>',
        select: '<path d="m5 3 14 11-7 1-3 6L5 3z"/>',
        pan: '<path d="M7 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v6-3a2 2 0 0 1 4 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-4-5a2 2 0 0 1 3-2l2 2"/>',
        delete: '<path d="M5 7h14l-1 14H6zM3 4h18M9 4V2h6v2"/><path d="M9 10v7m6-7v7"/>',
        users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2z"/><path d="M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v1h-4"/>',
        license: '<path d="M5 3h14v18H5z"/><path d="M8 7h8m-8 4h8m-8 4h5"/>',
        settings: '<circle cx="12" cy="12" r="3"/><path d="m19 13 2 1-2 4-2-1-2 2v2H9v-2l-2-2-2 1-2-4 2-1v-3l-2-1 2-4 2 1 2-2V2h6v2l2 2 2-1 2 4-2 1z"/>',
        group: '<rect x="3" y="4" width="9" height="9" rx="1.5"/><rect x="12" y="11" width="9" height="9" rx="1.5"/>',
        ungroup: '<rect x="3" y="4" width="8" height="8" rx="1.5"/><rect x="14" y="13" width="7" height="7" rx="1.5"/><path d="M12 7h7m-3-3 3 3-3 3M12 17H5m3-3-3 3 3 3"/>',
        zoomIn: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6m-11-14v6m-3-3h6"/>',
        zoomOut: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6"/>',
        page: '<path d="M5 3h10l4 4v14H5z"/><path d="M14 3v5h5M8 12h8m-8 4h8"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4.3 1.8c-1.2 1.1-1.8 1.4-1.8 3m0 3v.1"/>',
        measure: '<path d="m4 17 12-12 5 5L9 22H4z"/><path d="m12 9 2 2m1-5 2 2m-9 9 2 2"/>',
      }[name];
      if (!graphics) return undefined;
      const palette = ['group', 'ungroup', 'compare', 'undo'].includes(name)
        ? ['#c1a8ff', '#8c68ec', '#6547c5', '#563aa9']
        : ['pan', 'redo'].includes(name)
          ? ['#8ee5b6', '#48bd81', '#23945d', '#17794b']
          : ['measure', 'open'].includes(name)
            ? ['#ffd18a', '#f5a33e', '#d47a20', '#ad6117']
            : ['delete', 'close', 'exit'].includes(name)
              ? ['#ffa1a1', '#ed6269', '#c73946', '#a82e3b']
              : ['key', 'license'].includes(name)
                ? ['#82e6e5', '#37babb', '#19898e', '#116e74']
                : ['#73b8ff', '#3989ed', '#2563c5', '#1d4e9a'];
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${palette[0]}"/><stop offset=".48" stop-color="${palette[1]}"/><stop offset="1" stop-color="${palette[2]}"/></linearGradient><filter id="s" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="1" stdDeviation=".8" flood-color="#25364b" flood-opacity=".34"/></filter></defs><g fill="url(#g)" stroke="${palette[3]}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" filter="url(#s)">${graphics}</g><path d="M5 5h4" fill="none" stroke="#fff" stroke-width="1.15" stroke-linecap="round" opacity=".76"/></svg>`;
      const image = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
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
    installMenu({ ...state, signedIn: !!user && state.signedIn === true, admin: user?.role === 'admin', passwordAvailable: !!user?.email });
  };
  ipcMain.on('menu-state', onMenuState);
  const onCloseGuardReady = (e) => {
    if (e.sender === win.webContents) closeGuard.markReady();
  };
  const onCloseGuardResponse = (e, allow) => {
    if (e.sender === win.webContents) closeGuard.respond(allow);
  };
  ipcMain.on('close-guard-ready', onCloseGuardReady);
  ipcMain.on('close-guard-response', onCloseGuardResponse);
  win.on('close', closeGuard.onClose);
  const onTheme = (e, theme) => {
    if (e.sender === win.webContents && applyNativeTheme(nativeTheme, theme)) installMenu(currentMenuState);
  };
  ipcMain.on('theme', onTheme);
  win.on('closed', () => {
    ipcMain.removeListener('menu-state', onMenuState);
    ipcMain.removeListener('close-guard-ready', onCloseGuardReady);
    ipcMain.removeListener('close-guard-response', onCloseGuardResponse);
    if (mainWindow === win) mainWindow = null;
  });
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

let auth, license, spellChecker, ai;
const guard = (fn) => (...a) => {
  requireAccess(auth, license, true);
  return fn(...a);
};
const serverAccess = (fn) => (...a) => {
  requireSignIn(auth);
  return fn(...a);
};

const toBuf = (p) => {
  allowed.add(p);
  const b = fs.readFileSync(p);
  return { path: p, name: path.basename(p), data: new Uint8Array(b.buffer, b.byteOffset, b.byteLength) };
};

ipcMain.handle('startup-files', () => startupPaths().map(toBuf));
ipcMain.handle('consume-open-files', () => pendingOpenPaths.splice(0).map(toBuf));

ipcMain.handle('open-files', async (e, opts = {}) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    properties: ['openFile', ...(opts.multi === false ? [] : ['multiSelections'])],
    filters: opts.filters || [{ name: 'PDF', extensions: ['pdf'] }],
  });
  return r.canceled ? [] : r.filePaths.map(toBuf);
});

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

ipcMain.handle('open-saved-pdf', async (_e, file) => {
  if (typeof file !== 'string' || !allowed.has(file) || !/\.pdf$/i.test(file) || !fs.existsSync(file)) {
    throw new Error('This PDF is not available to open from the current session.');
  }
  const error = await shell.openPath(file);
  if (error) throw new Error('Could not open the saved PDF: ' + error);
  return { ok: true };
});

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
ipcMain.handle('pick-uploads', serverAccess(guard(async (e, kind) => {
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
})));

ipcMain.handle('save-many', guard(async (e, { files }) => {
  const r = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  for (const f of files) fs.writeFileSync(path.join(r.filePaths[0], path.basename(f.name)), Buffer.from(f.data));
  return r.filePaths[0];
}));

app.whenReady().then(() => {
  if (!hasInstanceLock) return;
  const ud = app.getPath('userData');
  const { createSpellChecker } = require('./spellcheck.cjs');
  const spellCheckerReady = createSpellChecker(ud);
  license = createLicenseStore({ file: path.join(ud, 'device-license.json'), publicKeyFile: path.join(__dirname, '..', 'dist', 'license-public.pem') });
  auth = createClient({
    configFile: path.join(ud, 'server.json'),
    localFile: path.join(ud, 'users.json'),
    sessionFile: path.join(ud, 'server-session.bin'),
    safeStorage,
    fetch: net.fetch.bind(net),
    onNotifications: (snapshot) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('notifications-update', snapshot);
      }
    },
  });
  ai = createAi({
    configFile: path.join(ud, 'ai.json'),
    keyFile: path.join(ud, 'ai-key.bin'),
    safeStorage,
    fetch: net.fetch.bind(net),
  });
  const aiSender = (e) => {
    if (e.sender !== mainWindow?.webContents) throw new Error('This AI request is not allowed.');
  };
  ipcMain.handle('ai-status', (e) => { aiSender(e); return ai.status(); });
  ipcMain.handle('ai-configure', (e, a) => { aiSender(e); return ai.configure(a || {}); });
  ipcMain.handle('ai-generate', (e, a) => {
    aiSender(e);
    requireAccess(auth, license, true);
    return ai.generate(a || {});
  });
  ipcMain.handle('license-status', () => license.status());
  ipcMain.handle('spellchecker-language', () => {
    if (!spellChecker) throw new Error('The spell checker is not ready.');
    return spellChecker.getLanguage();
  });
  ipcMain.handle('spellchecker-set-language', async (e, language) => {
    if (!spellChecker) throw new Error('The spell checker is not ready.');
    const selected = await spellChecker.setLanguage(language);
    for (const win of BrowserWindow.getAllWindows()) applySpellCheckerLanguage(win);
    return selected;
  });
  ipcMain.handle('spellchecker-check-words', (e, words) => {
    if (!spellChecker) throw new Error('The spell checker is not ready.');
    if (e.sender !== mainWindow?.webContents) throw new Error('This spell-check request is not allowed.');
    if (!Array.isArray(words) || words.length > 500) throw new Error('Spell-check words are invalid or too numerous.');
    return spellChecker.checkWords(words);
  });
  ipcMain.handle('spellchecker-add-word', async (e, word) => {
    if (!spellChecker) throw new Error('The spell checker is not ready.');
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win !== mainWindow) throw new Error('This spell-check request is not allowed.');
    await addPersonalSpellWord(win, word);
  });
  ipcMain.handle('print-printers', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win !== mainWindow) throw new Error('This printer-list request is not allowed.');
    return (await win.webContents.getPrintersAsync()).map(({ name, displayName, isDefault }) => ({ name, displayName, isDefault }));
  });
  ipcMain.handle('print-printer-capabilities', async (e, printerName) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win !== mainWindow) throw new Error('This printer-settings request is not allowed.');
    if (typeof printerName !== 'string' || !printerName.trim()) throw new Error('Select a printer first.');
    const printers = await win.webContents.getPrintersAsync();
    if (!printers.some((printer) => printer.name === printerName)) throw new Error('The selected printer is no longer available.');
    if (process.platform !== 'win32') {
      return {
        paperSizes: [
          { name: 'Letter', width: 850, height: 1100, rawKind: 1 },
          { name: 'A4', width: 827, height: 1169, rawKind: 9 },
        ],
        paperSources: [],
        defaultPaper: '',
        defaultSource: '',
      };
    }
    return windowsPrinterCapabilities(printerName);
  });
  ipcMain.handle('printer-properties', async (e, printerName) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win !== mainWindow) throw new Error('This printer-properties request is not allowed.');
    if (process.platform !== 'win32') throw new Error('Printer properties are available only on Windows.');
    if (typeof printerName !== 'string' || !printerName.trim()) throw new Error('Select a printer first.');
    const printers = await win.webContents.getPrintersAsync();
    if (!printers.some((printer) => printer.name === printerName)) throw new Error('The selected printer is no longer available.');
    const child = spawn('rundll32.exe', ['printui.dll,PrintUIEntry', '/e', '/n', printerName], {
      stdio: 'ignore',
      windowsHide: false,
    });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error('Printer properties closed with an error.'));
      });
    });
    return { ok: true };
  });
  ipcMain.handle('print-document', async (e, options = {}) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win !== mainWindow) throw new Error('This print request is not allowed.');
    if (!options || typeof options !== 'object' || Array.isArray(options)) throw new Error('Print options are invalid.');
    const papers = new Set(['A3', 'A4', 'A5', 'Legal', 'Letter', 'Tabloid']);
    const duplexModes = new Set(['simplex', 'shortEdge', 'longEdge']);
    if (options.copies !== undefined && (!Number.isInteger(options.copies) || options.copies < 1 || options.copies > 99)) throw new Error('Copies must be between 1 and 99.');
    if (options.pageSize !== undefined) {
      const standard = typeof options.pageSize === 'string' && papers.has(options.pageSize);
      const custom = options.pageSize && typeof options.pageSize === 'object'
        && Number.isInteger(options.pageSize.width) && options.pageSize.width > 0 && options.pageSize.width <= 1000000
        && Number.isInteger(options.pageSize.height) && options.pageSize.height > 0 && options.pageSize.height <= 1000000;
      if (!standard && !custom) throw new Error('The selected paper size is not supported.');
    }
    if (options.duplexMode !== undefined && !duplexModes.has(options.duplexMode)) throw new Error('The selected duplex mode is not supported.');
    const printers = await win.webContents.getPrintersAsync();
    if (options.deviceName !== undefined && !printers.some((printer) => printer.name === options.deviceName)) throw new Error('The selected printer is no longer available.');
    if (options.silent === true && !options.deviceName) throw new Error('Select a printer before printing.');
    return new Promise((resolve) => {
      win.webContents.print({
        silent: options.silent === true,
        printBackground: options.printBackground === true,
        landscape: options.landscape === true,
        copies: options.copies ?? 1,
        collate: options.collate === true,
        ...(options.pageSize ? { pageSize: options.pageSize } : {}),
        ...(options.duplexMode ? { duplexMode: options.duplexMode } : {}),
        ...(options.deviceName ? { deviceName: options.deviceName } : {}),
      }, (success, failureReason) => {
        resolve(success
          ? { ok: true }
          : { ok: false, ...(failureReason === 'cancelled' ? { cancelled: true } : { error: failureReason || 'The print job failed.' }) });
      });
    });
  });
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
  ipcMain.handle('shared-docs', (e, a = {}) => {
    if (!auth.current()) return { ok: false, expired: true, error: 'Sign in to the server to use this feature.' };
    if (sharedOperationRequiresLicense(a.op)) requireAccess(auth, license, true);
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
  // Password changes must remain available during mandatory first-login changes.
  ipcMain.handle('auth-change-password', (e, a) => auth.changePassword(a || {}));
  ipcMain.handle('auth-notifications', (e, a) => { requireSignIn(auth); return auth.notifications(a || {}); });
  ipcMain.handle('auth-admin-list', () => { requireSignIn(auth); return auth.adminList(); });
  ipcMain.handle('auth-admin-action', (e, a) => { requireSignIn(auth); return auth.adminAction(a || {}); });
  ipcMain.handle('auth-feedback-submit', (e, a) => { requireSignIn(auth); return auth.feedbackSubmit(a || {}); });
  ipcMain.handle('auth-feedback-list', () => { requireSignIn(auth); return auth.feedbackList(); });
  ipcMain.handle('auth-feedback-update', (e, a) => { requireSignIn(auth); return auth.feedbackUpdate(a || {}); });
  ipcMain.handle('auth-feedback-delete', (e, id) => { requireSignIn(auth); return auth.feedbackDelete(String(id || '')); });
  ipcMain.handle('auth-test', (e, url) => auth.test(url));
  ipcMain.handle('auth-configure', (e, a) => auth.configure(a || {}));
  void spellCheckerReady.then((checker) => {
    spellChecker = checker;
    createWindow();
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  }).catch((error) => {
    dialog.showErrorBox('Spell checker unavailable', `The English dictionaries could not be loaded.\n\n${error.message}`);
    createWindow();
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });
});
app.on('window-all-closed', () => app.quit());
