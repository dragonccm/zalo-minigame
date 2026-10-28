'use strict';
// Bộ điều khiển Chrome tối giản qua DevTools Protocol (không cần puppeteer) — dùng để kiểm thử giao diện.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CHROME = process.env.CHROME || '/home/dragonccm/.local/bin/google-chrome';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function launch({ port = 9333, width = 1280, height = 800 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'));
  const proc = spawn(CHROME, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`,
    '--disable-site-isolation-trials', '--disable-features=IsolateOrigins,site-per-process',   // giữ iframe cùng tiến trình để đọc context
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--hide-scrollbars',
    `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  let targets;
  for (let i = 0; i < 50; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some(t => t.type === 'page')) break; } catch { /* chưa sẵn sàng */ }
    await sleep(200);
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const waits = new Map(); const listeners = [];
  const contexts = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { const { res, rej } = waits.get(m.id); waits.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
    else if (m.method) {
      if (m.method === 'Runtime.executionContextCreated') contexts.set(m.params.context.id, m.params.context);
      if (m.method === 'Runtime.executionContextDestroyed') contexts.delete(m.params.executionContextId);
      if (m.method === 'Runtime.executionContextsCleared') contexts.clear();
      listeners.forEach(l => l(m));
    }
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waits.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  const logs = [];
  listeners.push(m => {
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) logs.push(`[${m.params.type}] ` + m.params.args.map(a => a.value ?? a.description).join(' '));
    if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text));
  });

  const api = {
    send, logs, contexts,
    async nav(url, wait = 800) { await send('Page.navigate', { url }); await sleep(wait); },
    async eval(expression, contextId) {
      const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    // context mặc định (main world) của iframe con đầu tiên — nơi GameHub SDK của game chạy
    async frameCtx() {
      const tree = await send('Page.getFrameTree');
      const child = (tree.frameTree.childFrames || [])[0];
      if (!child) return null;
      for (const c of contexts.values()) if (c.auxData && c.auxData.frameId === child.frame.id && c.auxData.isDefault) return c.id;
      return null;
    },
    async shot(file) { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); },
    async resize(w, h, mobile = false) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile }); },
    sleep,
    close() { try { ws.close(); } catch { /* */ } proc.kill(); setTimeout(() => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); } catch { /* */ } }, 1500).unref(); },
  };
  return api;
}
module.exports = { launch, sleep };
