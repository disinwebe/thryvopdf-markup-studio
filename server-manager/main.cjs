const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { SERVICE, validate, serviceArgs, parseImage, addresses } = require('./control.cjs');

const { sendMail, normalizeSmtp } = require('../server/notify.cjs');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const NEEDS_AUTH = ['smtp.office365.com', 'smtp-mail.outlook.com', 'smtp.gmail.com'];
function needAuth(c) {
  if (NEEDS_AUTH.includes(c.host.toLowerCase()) && (!c.user || !c.password)) throw new Error('This provider requires signing in: enter the SMTP user (full mailbox address) and its password or app password, then save.');
}
function friendly(err) {
  const m = err.message || String(err);
  if (/5\.7\.57|530 /.test(m)) return m + ' Hint: the server did not accept the sign-in. Check the SMTP user and password, and that Authenticated SMTP is enabled for this mailbox.';
  if (/535|5\.7\.139|5\.7\.3|534/.test(m)) return m + ' Hint: sign-in was rejected. Use an app password (Gmail/Outlook with 2-step verification), or ask a Microsoft 365 administrator to enable SMTP AUTH and allow basic authentication for this mailbox.';
  return m;
}
function readNotify(dir) {
  try { return normalizeSmtp(JSON.parse(fs.readFileSync(path.join(dir, 'notify.json'), 'utf8')).smtp); } catch { return normalizeSmtp(); }
}
app.setName('ThryvoPDF Server Manager');
app.setPath('userData', path.join(app.getPath('appData'), 'ThryvoPDF Server Manager'));
const run = promisify(execFile);
const host = path.join(process.resourcesPath, 'ThryvoServerHost.exe');
const appPath = process.execPath;
const defaults = { port: 8787, dataDir: path.join(process.env.ProgramData || 'C:\\ProgramData', 'ThryvoPDF Server') };
let win;
function own(event) { if (!win || event.sender !== win.webContents) throw new Error('Unauthorized request.'); }
async function queryService() {
  try { return (await run('sc.exe', ['query', SERVICE], { windowsHide: true })).stdout; }
  catch (e) {
    if (e.code === 1060) return null;
    throw new Error('Could not inspect Windows service status: ' + e.message);
  }
}
async function imagePath() {
  try {
    const { stdout } = await run('reg.exe', ['query', `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${SERVICE}`, '/v', 'ImagePath'], { windowsHide: true });
    const match = /^\s*ImagePath\s+REG_(?:EXPAND_)?SZ\s+(.+)$/im.exec(stdout);
    if (!match) throw new Error('Service configuration could not be read.');
    return match[1].trim();
  } catch (e) {
    throw new Error('Could not inspect service configuration: ' + e.message);
  }
}
function health(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/health', timeout: 2000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; if (body.length > 4096) req.destroy(); });
      res.on('end', () => { try { const json = JSON.parse(body); resolve(res.statusCode === 200 && json.ok === true && json.docsAccess === true); } catch { resolve(false); } });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}
async function status() {
  const query = await queryService();
  const image = query === null ? null : await imagePath();
  const parsed = image && parseImage(image, host);
  if (image && !parsed) return { state: 'foreign', config: defaults, addresses: [], health: false };
  let state = image ? 'unknown' : 'not installed';
  if (image) {
    const code = /STATE\s*:\s*(\d+)/i.exec(query)?.[1];
    state = ({ '1': 'stopped', '2': 'starting', '3': 'stopping', '4': 'running' })[code] || 'unknown';
  }
  const config = parsed?.config || defaults;
  return { state, config, addresses: addresses(config.port), health: await health(config.port), passwordFile: fs.existsSync(path.join(config.dataDir, 'ADMIN-INITIAL-PASSWORD.txt')) };
}
async function elevated(action, config) {
  const args = serviceArgs(action, config, appPath);
  const argsLiteral = args.map((arg) => `'${arg}'`).join(',');
  const command = `$ErrorActionPreference='Stop'; $p=Start-Process -FilePath '${host.replace(/'/g, "''")}' -ArgumentList @(${argsLiteral}) -Verb RunAs -Wait -PassThru; exit $p.ExitCode`;
  try {
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, timeout: 60000 });
  } catch (e) {
    if (e.code === 1223 || /cancel/i.test(e.stderr || '')) throw new Error('Administrator approval was cancelled.');
    throw new Error(`Service action failed (code ${e.code ?? 'unknown'}). Check administrator approval, the data folder permissions, service status and Windows Event Viewer.`);
  }
}
app.whenReady().then(() => {
  win = new BrowserWindow({ width: 900, height: 800, minWidth: 700, minHeight: 650, title: 'ThryvoPDF Server Manager', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadFile(path.join(__dirname, 'index.html'));
  ipcMain.handle('manager:status', (e) => { own(e); return status(); });
  ipcMain.handle('manager:choose', async (e) => { own(e); const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; });
  ipcMain.handle('manager:action', async (e, action, config) => {
    own(e); serviceArgs(action, config, appPath);
    const current = await status();
    if (current.state === 'foreign') throw new Error('A different service already uses this service name. No changes were made.');
    if (action !== 'install' && current.state === 'not installed') throw new Error('The service is not installed.');
    if (action === 'install' && current.state !== 'not installed') throw new Error('Uninstall the existing service before changing its settings; its data will be preserved.');
    const result = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Cancel', 'Continue as administrator'], defaultId: 0, cancelId: 0,
      message: `${action[0].toUpperCase() + action.slice(1)} the Windows service?`,
      detail: action === 'install' ? `This creates an automatic-start service running as LocalService on port ${config.port}, using ${config.dataDir}. LocalService will receive inherited Modify access to this folder and its contents, which may contain sensitive data. Windows will request administrator approval. No firewall rules will be changed.` : `Windows will request administrator approval. Uninstalling removes the service but does not delete server data or remove the LocalService folder permission.`
    });
    if (result.response !== 1) return status();
    await elevated(action, action === 'install' ? config : current.config);
    return status();
  });
  ipcMain.handle('manager:firewall', async (e) => { own(e); await shell.openExternal('https://support.microsoft.com/windows/risks-of-allowing-apps-through-windows-firewall-654559af-3f54-3dcf-349f-71ccd90bcc5c'); });
  ipcMain.handle('manager:logs', async (e) => { own(e); const s = await status(); const file = path.join(s.config.dataDir, 'service.log'); if (!fs.existsSync(file)) throw new Error('No service log exists yet. The service must be able to write to its data folder.'); const err = await shell.openPath(file); if (err) throw new Error(err); });
  ipcMain.handle('manager:notify-get', async (e) => {
    own(e);
    const s = await status();
    const c = readNotify(s.config.dataDir);
    return { enabled: c.enabled, host: c.host, port: c.port, secure: c.secure, user: c.user, from: c.from, hasPassword: !!c.password };
  });
  ipcMain.handle('manager:notify-save', async (e, input) => {
    own(e);
    const s = await status();
    const prev = readNotify(s.config.dataDir);
    const next = normalizeSmtp({ ...input, password: typeof input?.password === 'string' && input.password ? input.password : prev.password });
    if (next.enabled && (!next.host || !EMAIL_RE.test((/<([^>]+)>/.exec(next.from) || [null, next.from])[1]))) throw new Error('Enter an SMTP host and a valid From address (for example ThryvoPDF <noreply@example.com>).');
    if (next.enabled) needAuth(next);
    try {
      fs.mkdirSync(s.config.dataDir, { recursive: true });
      const file = path.join(s.config.dataDir, 'notify.json');
      fs.writeFileSync(file + '.tmp', JSON.stringify({ smtp: next }, null, 2));
      fs.renameSync(file + '.tmp', file);
    } catch (err) {
      throw new Error('Could not save email settings to the data folder (' + (err.code || err.message) + '). Run the manager as administrator or grant your account write access. The service applies changes on the next notification without a restart.');
    }
  });
  ipcMain.handle('manager:notify-test', async (e, to) => {
    own(e);
    if (typeof to !== 'string' || !EMAIL_RE.test(to.trim())) throw new Error('Enter a valid test recipient address.');
    const s = await status();
    const c = readNotify(s.config.dataDir);
    if (!c.host) throw new Error('Save SMTP settings first.');
    needAuth(c);
    try { await sendMail(c, to.trim(), 'ThryvoPDF test email', 'Email notifications from your ThryvoPDF server are working.'); }
    catch (err) { throw new Error('Test email failed: ' + friendly(err)); }
  });
  ipcMain.handle('manager:copy', (e, value) => { own(e); if (typeof value !== 'string' || !/^http:\/\/[0-9.]+:\d+$/.test(value)) throw new Error('Invalid address.'); clipboard.writeText(value); });
});
app.on('window-all-closed', () => app.quit());
