#!/usr/bin/env node
'use strict';
// Kiểm tra game trước khi upload:  node tools/validate-game.js <thư-mục-game | file.zip>
const fs = require('node:fs');
const path = require('node:path');
const { readZip, stripRoot } = require('../server/zip');
const { validatePackage } = require('../server/validate');

const target = process.argv[2];
if (!target || !fs.existsSync(target)) { console.error('Cách dùng: node tools/validate-game.js <thư-mục-game | file.zip>'); process.exit(2); }

function readDir(dir, base = dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) readDir(full, base, out);
    else out.push({ name: path.relative(base, full).split(path.sep).join('/'), data: fs.readFileSync(full) });
  }
  return out;
}

let entries;
try { entries = fs.statSync(target).isDirectory() ? readDir(path.resolve(target)) : stripRoot(readZip(fs.readFileSync(target))); }
catch (e) { console.error('✖', e.message); process.exit(1); }

const r = validatePackage(entries);
console.log(`\nGói: ${r.files} file, ${(r.size / 1024).toFixed(0)} KB`);
r.errors.forEach(e => console.log('  ✖ LỖI     ', e));
r.warnings.forEach(w => console.log('  ⚠ CẢNH BÁO', w));
if (!r.errors.length) console.log(`\n✔ Đạt chuẩn GameHub${r.warnings.length ? ' (có cảnh báo)' : ''} — game "${r.manifest.name}" v${r.manifest.version}`);
else console.log(`\n✖ Chưa đạt chuẩn: ${r.errors.length} lỗi`);
process.exit(r.errors.length ? 1 : 0);
