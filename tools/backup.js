#!/usr/bin/env node
'use strict';
// Sao lưu cơ sở dữ liệu + file game vào thư mục backups/:  npm run backup
//  - PostgreSQL: pg_dump (dùng pg_dump trên máy nếu có, nếu không thì chạy trong container gamehub-postgres)
//  - PGlite: dumpDataDir (hãy tắt server trước — PGlite chỉ mở được bởi một tiến trình)
require('../server/env');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const DATA = process.env.GAMEHUB_DATA || path.join(ROOT, 'data');
const OUT = path.join(ROOT, 'backups');
const CONTAINER = process.env.PG_CONTAINER || 'gamehub-postgres';
fs.mkdirSync(OUT, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const has = cmd => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;

(async () => {
  let dbFile;
  if (process.env.DATABASE_URL) {
    dbFile = path.join(OUT, `db-${stamp}.dump`);
    let r;
    if (has('pg_dump')) {
      r = spawnSync('pg_dump', ['--format=custom', '--no-owner', '--file', dbFile, process.env.DATABASE_URL], { stdio: ['ignore', 'inherit', 'inherit'] });
    } else {
      const u = new URL(process.env.DATABASE_URL);
      const fd = fs.openSync(dbFile, 'w');
      r = spawnSync('docker', ['exec', CONTAINER, 'pg_dump', '--format=custom', '--no-owner', '-U', decodeURIComponent(u.username), u.pathname.slice(1)],
        { stdio: ['ignore', fd, 'inherit'] });
      fs.closeSync(fd);
    }
    if (r.status !== 0) { fs.rmSync(dbFile, { force: true }); throw new Error('pg_dump thất bại'); }
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    const pg = await PGlite.create(path.join(DATA, 'pgdata'));
    const blob = await pg.dumpDataDir('gzip');
    dbFile = path.join(OUT, `pglite-${stamp}.tar.gz`);
    fs.writeFileSync(dbFile, Buffer.from(await blob.arrayBuffer()));
    await pg.close();
  }
  const filesFile = path.join(OUT, `files-${stamp}.tar.gz`);
  const t = spawnSync('tar', ['czf', filesFile, '-C', DATA, 'games', 'submissions'], { stdio: 'inherit' });
  if (t.status !== 0) throw new Error('nén file game thất bại');
  const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
  console.log(`✔ Đã sao lưu:\n  ${path.relative(ROOT, dbFile)}  (${kb(dbFile)})\n  ${path.relative(ROOT, filesFile)}  (${kb(filesFile)})`);
})().catch(e => { console.error('✖', e.message); process.exit(1); });
