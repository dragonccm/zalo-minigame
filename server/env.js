'use strict';
// Đọc file .env (nếu có) vào process.env — biến môi trường đã đặt sẵn được ưu tiên.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const file = path.join(__dirname, '..', '.env');
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

// Bí mật gốc để ký token. Không đặt APP_SECRET thì sinh ngẫu nhiên (token mất hiệu lực khi khởi động lại).
let secret = process.env.APP_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  if (process.env.NODE_ENV === 'production') console.warn('[env] Chưa đặt APP_SECRET — token sẽ mất hiệu lực sau mỗi lần khởi động lại');
}
// khóa con cho từng mục đích, để lộ một loại token không ảnh hưởng loại khác
const subkey = purpose => crypto.createHmac('sha256', secret).update('gamehub:' + purpose).digest();

module.exports = { subkey };
