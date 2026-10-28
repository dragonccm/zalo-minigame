#!/usr/bin/env node
'use strict';
// Proxy Graph API của Zalo — chạy trên máy có IP Việt Nam.
// Zalo trả lỗi -501 cho mọi lời gọi graph.zalo.me từ IP nước ngoài, nên máy chủ GameHub (ở nước ngoài)
// gọi qua proxy này: đặt ZALO_GRAPH_URL=https://<proxy>/me và ZALO_PROXY_KEY giống nhau ở hai bên.
//
//   PROXY_KEY=<chuỗi ngẫu nhiên dài> PORT=8787 node proxy.js
//
// Chỉ chuyển tiếp đúng 1 lời gọi: GET /me?fields=id (kèm header access_token, appsecret_proof). Không lưu, không ghi log token.
const http = require('node:http');

const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.PROXY_KEY || '';
const UPSTREAM = 'https://graph.zalo.me/v2.0/me';
if (KEY.length < 32) { console.error('Cần PROXY_KEY dài ít nhất 32 ký tự'); process.exit(1); }

const crypto = require('node:crypto');
const sameKey = k => { const a = Buffer.from(String(k || '')), b = Buffer.from(KEY); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return json(res, 200, { ok: true });
  if (req.method !== 'GET' || url.pathname !== '/me') return json(res, 404, { error: 'not found' });
  if (!sameKey(req.headers['x-proxy-key'])) return json(res, 403, { error: 'forbidden' });
  const token = String(req.headers.access_token || '');
  if (!token || token.length > 2000) return json(res, 400, { error: 'missing access_token' });
  const headers = { access_token: token };
  if (req.headers.appsecret_proof) headers.appsecret_proof = String(req.headers.appsecret_proof).slice(0, 128);
  try {
    const r = await fetch(`${UPSTREAM}?fields=id`, { headers, signal: AbortSignal.timeout(8000) });
    json(res, 200, await r.json());
  } catch (e) {
    console.error('[proxy] graph:', e.message);
    json(res, 502, { error: 'upstream' });
  }
}).listen(PORT, () => console.log(`Zalo Graph proxy chạy tại cổng ${PORT}`));
