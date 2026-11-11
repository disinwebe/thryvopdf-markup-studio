const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createServer } = require('vite');
const react = require('@vitejs/plugin-react').default;

const root = path.resolve(__dirname, '..');
const harness = path.join(__dirname, 'manual-screenshot-harness');
const assetDir = path.join(root, 'docs', 'user-manual-assets');
const browser = [
  process.env.MANUAL_BROWSER,
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
].filter(Boolean).find((candidate) => fs.existsSync(candidate));

if (!browser) throw new Error('Microsoft Edge or Google Chrome was not found. Set MANUAL_BROWSER to its executable path.');

const outputs = [
  ['workspace', path.join(assetDir, 'workspace.png')],
  ['markups', path.join(assetDir, 'markups-and-comments.png')],
  ['shared', path.join(assetDir, 'shared-documents.png')],
];
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'thryvopdf-manual-captures-'));

async function waitFor(check, description, timeout = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

async function captureScene(scene, output, baseUrl) {
  const profile = path.join(tempDir, scene);
  fs.mkdirSync(profile, { recursive: true });
  const process = spawn(browser, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-debugging-port=0',
    '--remote-allow-origins=*',
    `--user-data-dir=${profile}`,
    '--window-size=1440,1000',
    `${baseUrl}?scene=${scene}`,
  ], { stdio: 'ignore' });
  let socket;

  try {
    const activePortPath = path.join(profile, 'DevToolsActivePort');
    const portText = await waitFor(() => fs.existsSync(activePortPath) && fs.readFileSync(activePortPath, 'utf8'));
    const port = Number(portText.split(/\r?\n/)[0]);
    const targets = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (!response.ok) return null;
      return (await response.json()).find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    }, `${scene} browser tab`);
    socket = new WebSocket(targets.webSocketDebuggerUrl);

    let nextId = 0;
    const pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !pending.has(message.id)) return;
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });

    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params }));
    });
    await send('Page.enable');
    await send('Runtime.enable');
    const sceneReady = scene === 'shared'
      ? 'document.querySelector(\'[role="dialog"][aria-label="Shared documents"]\')'
      : scene === 'markups'
        ? 'document.querySelector(".panel-body .props-fields") && document.body.innerText.includes("Please verify the conference-room door swing")'
        : 'true';
    const evaluation = await send('Runtime.evaluate', {
      expression: `new Promise((resolve, reject) => {
        const started = Date.now();
        const check = () => {
          const canvas = document.querySelector(".page canvas");
          const ready = ${sceneReady};
          if (canvas && canvas.width > 0 && canvas.height > 0 && ready) {
            resolve({ ready: true, canvas: [canvas.width, canvas.height] });
            return;
          }
          const status = document.querySelector(".status")?.textContent || "";
          if (status.includes("Could not open")) {
            reject(new Error(status));
            return;
          }
          if (Date.now() - started > 30000) {
            reject(new Error("PDF workspace did not become ready. Visible text: " + document.body.innerText.slice(-600)));
            return;
          }
          setTimeout(check, 100);
        };
        check();
      })`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (evaluation.exceptionDetails) {
      throw new Error(evaluation.exceptionDetails.exception?.description || evaluation.exceptionDetails.text);
    }

    const screenshot = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
    });
    fs.writeFileSync(output, Buffer.from(screenshot.data, 'base64'));
  } finally {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    if (!process.killed) process.kill();
  }
}

async function main() {
  const server = await createServer({
    configFile: false,
    root: harness,
    base: './',
    plugins: [react()],
    server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [root] } },
    logLevel: 'error',
  });
  try {
    await server.listen();
    const address = server.httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Could not start the manual screenshot server.');
    const baseUrl = `http://127.0.0.1:${address.port}/`;
    for (const [scene, output] of outputs) {
      fs.mkdirSync(path.dirname(output), { recursive: true });
      await captureScene(scene, output, baseUrl);
      const png = fs.readFileSync(output);
      if (png.length < 20000 || png.readUInt32BE(16) < 1200 || png.readUInt32BE(20) < 800) {
        throw new Error(`Screenshot for ${scene} was not generated at the expected size.`);
      }
      console.log(`Captured ${path.relative(root, output)} (${png.readUInt32BE(16)}x${png.readUInt32BE(20)}).`);
    }
  } finally {
    await server.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
