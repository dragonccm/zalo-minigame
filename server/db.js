'use strict';
// Lớp cơ sở dữ liệu PostgreSQL.
//  - Có DATABASE_URL  -> PostgreSQL thật qua pool kết nối (pg)
//  - Không có         -> PGlite: PostgreSQL nhúng (WASM), lưu ở data/pgdata — tiện để phát triển, cùng SQL
require('./env');
const fs = require('node:fs');
const path = require('node:path');

const DATA = process.env.GAMEHUB_DATA || path.join(__dirname, '..', 'data');
fs.mkdirSync(path.join(DATA, 'games'), { recursive: true });
fs.mkdirSync(path.join(DATA, 'submissions'), { recursive: true });

let driver = null;          // { kind, query(sql, params), tx(fn), close() }

async function connect() {
  if (driver) return driver;
  if (process.env.DATABASE_URL) {
    const { Pool, types } = require('pg');
    types.setTypeParser(20, v => Number(v));                // BIGINT -> number (id, COUNT)
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX || 10), idleTimeoutMillis: 30000 });
    pool.on('error', e => console.error('[db] lỗi kết nối nền:', e.message));
    await pool.query('SELECT 1');
    const wrap = c => Object.assign(async (sql, params = []) => { const r = await c.query(sql, params); return { rows: r.rows, rowCount: r.rowCount }; },
      { exec: sql => c.query(sql) });          // giao thức simple: chạy được nhiều câu lệnh
    driver = {
      kind: 'postgres',
      query: wrap(pool),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const r = await fn(wrap(client));
          await client.query('COMMIT');
          return r;
        } catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
        finally { client.release(); }
      },
      close: () => pool.end(),
    };
  } else {
    const { PGlite, types } = require('@electric-sql/pglite');
    const dir = path.join(DATA, 'pgdata');
    const pg = await PGlite.create(dir, { parsers: { [types.INT8]: v => Number(v) } });
    const wrap = c => Object.assign(async (sql, params = []) => { const r = await c.query(sql, params); return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }; },
      { exec: sql => c.exec(sql) });
    driver = {
      kind: 'pglite',
      query: wrap(pg),
      tx: fn => pg.transaction(t => fn(wrap(t))),
      close: () => pg.close(),
    };
  }
  return driver;
}

// ---- hàm tiện dụng (dùng driver đã kết nối) ----
const q = (sql, params) => driver.query(sql, params);
const one = async (sql, params) => (await driver.query(sql, params)).rows[0] || null;
const many = async (sql, params) => (await driver.query(sql, params)).rows;
const tx = fn => driver.tx(fn);                          // fn nhận hàm query(sql, params) của transaction
const ms = d => (d ? new Date(d).getTime() : null);      // timestamptz -> mili giây (cho API)

// ---- migrations: chạy lần lượt các file server/migrations/NNN_*.sql chưa áp dụng ----
async function migrate() {
  await q(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  const done = new Set((await many('SELECT version FROM schema_migrations')).map(r => r.version));
  const dir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(dir).filter(f => /^\d+_.*\.sql$/.test(f)).sort();
  for (const f of files) {
    const version = f.replace(/\.sql$/, '');
    if (done.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    await tx(async t => {
      await t.exec(sql);
      await t('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    });
    console.log(`[db] đã áp dụng migration ${version}`);
  }
}

async function init() {
  await connect();
  await migrate();
  return driver.kind;
}

module.exports = { init, q, one, many, tx, ms, DATA, close: () => driver && driver.close(), kind: () => driver && driver.kind };
