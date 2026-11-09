const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'server-manager', 'build');
fs.mkdirSync(out, { recursive: true });
const csc = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const result = spawnSync(csc, ['/nologo', '/target:exe', `/out:${path.join(out, 'ThryvoServerHost.exe')}`, '/reference:System.ServiceProcess.dll', path.join(root, 'server-manager', 'ServiceHost.cs')], { stdio: 'inherit' });
if (result.error) { console.error(result.error.message); process.exit(1); }
if (result.status !== 0) process.exit(result.status || 1);
const builder = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const pack = spawnSync(process.execPath, [builder, '--win', 'nsis', '--publish', 'never', '--config', path.join(root, 'server-manager', 'builder.cjs')], { stdio: 'inherit', cwd: root });
if (pack.error) { console.error(pack.error.message); process.exit(1); }
process.exit(pack.status || 0);
