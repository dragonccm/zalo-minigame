'use strict';
require('./env');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');
const { handleApi, verifyPreview, GAMES_DIR, SUBS_DIR } = require('./api');
const { seedAll } = require('./seed');
const realtime = require('./realtime');

const PORT = Number(process.env.PORT || 8080);
const ROOT = path.join(__dirname, '..');
const PUBLIC = path.join(ROOT, 'public');
const SDK_DIR = path.join(ROOT, 'sdk');

const MIME = {
  html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav',
  m4a: 'audio/mp4', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', glb: 'model/gltf-binary',
  gltf: 'model/gltf+json', wasm: 'application/wasm', txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8', xml: 'application/xml',
};

// Nguồn bên ngoài được gọi API + nhúng game (vd Zalo Mini App: https://h5.zdn.vn). Danh sách cách nhau bởi dấu phẩy.
const ALLOWED_ORIGINS = String(process.env.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(s => /^[a-z][a-z0-9+.-]*:\/\/[^\s/;'"]+$/i.test(s));
function cors(req, res) {
  const o = req.headers.origin;
  if (!o || !ALLOWED_ORIGINS.includes(o)) return false;
  res.setHeader('Access-Control-Allow-Origin', o);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-GH');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

// Game chạy trong iframe sandbox (origin "null") + CSP chặn mọi kết nối/tài nguyên ra ngoài.
// Riêng WebSocket tới chính máy chủ này (/rt) được phép để chơi multiplayer.
function gameCsp(req) {
  const host = /^[a-z0-9.-]+(:\d+)?$/i.test(req.headers.host || '') ? req.headers.host : '';
  const ws = host ? ` ws://${host} wss://${host}` : '';
  return [
    "default-src 'self' data: blob:", "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'", "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:", "media-src 'self' data: blob:", "font-src 'self' data:", `connect-src 'self' data: blob:${ws}`,
    "worker-src 'self' blob:", "form-action 'none'", ["frame-ancestors 'self'", ...ALLOWED_ORIGINS].join(' '), 'sandbox allow-scripts allow-pointer-lock',
  ].join('; ');
}
const PORTAL_CSP = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";

function serveFile(req, res, root, rel, { game = false, spa = false } = {}) {
  let p;
  try { p = decodeURIComponent(rel); } catch { return notFound(res); }
  if (p.includes('\0')) return notFound(res);
  let file = path.normalize(path.join(root, p));
  if (file !== root && !file.startsWith(root + path.sep)) return notFound(res);
  let st = safeStat(file);
  if (st && st.isDirectory()) { file = path.join(file, 'index.html'); st = safeStat(file); }
  if (!st && spa && !path.extname(p)) { file = path.join(root, 'index.html'); st = safeStat(file); }
  if (!st || !st.isFile()) return notFound(res);
  const ext = path.extname(file).slice(1).toLowerCase();
  const h = {
    'Content-Type': MIME[ext] || 'application/octet-stream', 'Content-Length': st.size,
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
  };
  if (game) { h['Content-Security-Policy'] = gameCsp(req); h['Access-Control-Allow-Origin'] = '*'; }
  else if (ext === 'html') h['Content-Security-Policy'] = PORTAL_CSP;
  res.writeHead(200, h);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
const safeStat = f => { try { return fs.statSync(f); } catch { return null; } };
function notFound(res) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found'); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') {   // cho probe của k8s/docker: sống + DB trả lời được
      await db.one('SELECT 1 AS ok');
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
      return res.end('ok');
    }
    if (p.startsWith('/api/')) {
      const ok = cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(ok ? 204 : 403); return res.end(); }
      return await handleApi(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

    let m;
    if ((m = /^\/g\/([a-z0-9-]+)(\/.*)?$/.exec(p))) {
      const g = await db.one('SELECT status FROM games WHERE slug = $1', [m[1]]);
      if (!g || g.status !== 'live') return notFound(res);
      return serveFile(req, res, path.join(GAMES_DIR, m[1]), m[2] || '/', { game: true });
    }
    if ((m = /^\/preview\/(\d+)~(\d+)~([a-f0-9]{64})(\/.*)?$/.exec(p))) {   // URL xem thử có chữ ký (xin qua /api/submissions/:id/preview)
      const s = await db.one('SELECT status FROM submissions WHERE id = $1', [Number(m[1])]);
      if (!s || s.status !== 'pending' || !verifyPreview(m[1], m[2], m[3])) return notFound(res);
      return serveFile(req, res, path.join(SUBS_DIR, m[1]), m[4] || '/', { game: true });
    }
    if (p.startsWith('/sdk/')) return serveFile(req, res, SDK_DIR, p.slice(4), { game: true });
    return serveFile(req, res, PUBLIC, p, { spa: true });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500); res.end('Server error'); }
  }
});

async function main() {
  const kind = await db.init();
  console.log(`[db] ${kind === 'postgres' ? 'PostgreSQL (' + new URL(process.env.DATABASE_URL).host + ')' : 'PGlite (' + path.join(db.DATA, 'pgdata') + ')'}`);
  await seedAll();
  realtime.attach(server);
  server.listen(PORT, () => console.log(`GameHub chạy tại http://localhost:${PORT}`));
}

// tắt an toàn: đóng phòng (lưu kết quả trận), ngừng nhận kết nối, đóng DB
let stopping = false;
async function shutdown(sig) {
  if (stopping) return;
  stopping = true;
  console.log(`\n[${sig}] đang tắt máy chủ...`);
  const force = setTimeout(() => process.exit(1), 8000);
  force.unref();
  try {
    await realtime.shutdown();
    await new Promise(r => server.close(r));
    await db.close();
  } catch (e) { console.error(e); }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

main().catch(e => { console.error('Không khởi động được:', e); process.exit(1); });
