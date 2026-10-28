'use strict';
// Đọc file .zip an toàn, không phụ thuộc thư viện ngoài.
// Chặn: zip-slip (../), đường dẫn tuyệt đối, symlink, file mã hóa, zip64, zip-bomb (giới hạn dung lượng).
const zlib = require('node:zlib');

const LIMITS = {
  maxZipBytes: 30 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxFiles: 600,
};

function readZip(buf, limits = LIMITS) {
  if (buf.length > limits.maxZipBytes) throw new Error(`File zip quá lớn (tối đa ${limits.maxZipBytes >> 20}MB)`);
  // tìm End Of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Không phải file zip hợp lệ');
  const total = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  if (total === 0xffff || off === 0xffffffff) throw new Error('Zip64 không được hỗ trợ');
  if (total > limits.maxFiles) throw new Error(`Quá nhiều file (tối đa ${limits.maxFiles})`);

  const entries = [];
  let sum = 0;
  for (let n = 0; n < total; n++) {
    if (off + 46 > buf.length || buf.readUInt32LE(off) !== 0x02014b50) throw new Error('Central directory bị hỏng');
    const flags = buf.readUInt16LE(off + 8);
    const method = buf.readUInt16LE(off + 10);
    const csize = buf.readUInt32LE(off + 20);
    const usize = buf.readUInt32LE(off + 24);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const extAttr = buf.readUInt32LE(off + 38);
    const lho = buf.readUInt32LE(off + 42);
    const rawName = buf.toString('utf8', off + 46, off + 46 + nameLen);
    off += 46 + nameLen + extraLen + commentLen;

    const name = rawName.replace(/\\/g, '/');
    if (name.endsWith('/')) continue;                              // thư mục
    if (flags & 1) throw new Error(`File bị mã hóa: ${name}`);
    if (csize === 0xffffffff || usize === 0xffffffff) throw new Error('Zip64 không được hỗ trợ');
    if (((extAttr >>> 16) & 0o170000) === 0o120000) throw new Error(`Không cho phép symlink: ${name}`);
    if (name.startsWith('/') || /^[a-zA-Z]:/.test(name) || name.includes('\0') || name.split('/').some(p => p === '..'))
      throw new Error(`Đường dẫn không an toàn: ${name}`);
    if (name.startsWith('__MACOSX/') || name.split('/').pop() === '.DS_Store') continue;
    if (usize > limits.maxFileBytes) throw new Error(`File quá lớn: ${name}`);
    sum += usize;
    if (sum > limits.maxTotalBytes) throw new Error(`Tổng dung lượng sau giải nén quá lớn (tối đa ${limits.maxTotalBytes >> 20}MB)`);

    if (lho + 30 > buf.length || buf.readUInt32LE(lho) !== 0x04034b50) throw new Error(`Local header hỏng: ${name}`);
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const comp = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(comp);
    else if (method === 8) data = zlib.inflateRawSync(comp, { maxOutputLength: usize + 1 });
    else throw new Error(`Kiểu nén không hỗ trợ (${method}): ${name}`);
    if (data.length !== usize) throw new Error(`Kích thước không khớp: ${name}`);
    entries.push({ name, data });
  }
  return entries;
}

// Nếu toàn bộ file nằm trong 1 thư mục gốc duy nhất (người dùng nén cả thư mục) thì bỏ thư mục đó.
function stripRoot(entries) {
  if (!entries.length || entries.some(e => !e.name.includes('/'))) return entries;
  const root = entries[0].name.split('/')[0];
  if (!entries.every(e => e.name.startsWith(root + '/'))) return entries;
  return entries.map(e => ({ name: e.name.slice(root.length + 1), data: e.data }));
}

module.exports = { readZip, stripRoot, LIMITS };
