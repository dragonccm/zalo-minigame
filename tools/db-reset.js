#!/usr/bin/env node
'use strict';
// XÓA TOÀN BỘ dữ liệu (chỉ dùng khi phát triển/kiểm thử):  node tools/db-reset.js --yes
require('../server/env');
const fs = require('node:fs');
const path = require('node:path');

if (!process.argv.includes('--yes')) { console.error('Lệnh này xóa toàn bộ dữ liệu. Chạy lại với --yes nếu chắc chắn.'); process.exit(2); }
const DATA = process.env.GAMEHUB_DATA || path.join(__dirname, '..', 'data');

(async () => {
  if (process.env.DATABASE_URL) {
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.end();
    console.log('Đã xóa schema PostgreSQL:', new URL(process.env.DATABASE_URL).host);
  }
  for (const d of ['pgdata', 'games', 'submissions']) fs.rmSync(path.join(DATA, d), { recursive: true, force: true });
  console.log('Đã xóa', DATA);
})().catch(e => { console.error(e.message); process.exit(1); });
