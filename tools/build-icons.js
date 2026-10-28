#!/usr/bin/env node
'use strict';
// Sinh bộ icon SVG (Lucide, giấy phép ISC) cho portal và game:  node tools/build-icons.js
// Mọi hình (circle, rect, line...) được đổi sang <path d> để vừa vẽ được trong HTML, vừa vẽ được lên canvas (Path2D).
// Muốn thêm icon: thêm tên vào danh sách bên dưới (tra tên ở https://lucide.dev/icons) rồi chạy lại lệnh.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'node_modules', 'lucide-static', 'icons');
const VERSION = require(path.join(ROOT, 'node_modules', 'lucide-static', 'package.json')).version;

// icon giao diện portal + game
const UI = `triangle-alert sparkles key-round hand user-round user-plus users lock lock-open lock-keyhole medal flame flask-conical x
  gift timer external-link link check circle-check circle-x circle-help info party-popper gamepad-2 joystick upload trophy award
  rotate-ccw refresh-cw volume-2 volume-x maximize minimize mouse mouse-pointer-2 keyboard pointer smartphone shield shield-check
  pencil globe wrench book-open package send list-checks arrow-right arrow-left chevron-right loader-circle hourglass folder-open
  play target scroll-text settings sliders-horizontal plus ban trash-2 frown copy eye log-in log-out house inbox box divide
  palette magnet zap crown star heart users-round wifi wifi-off gauge activity chart-column clock flag radio music-2 newspaper
  video thumbs-up circle-play camera message-circle swords square-pen test-tube`;
// avatar người chơi + icon thành tựu / nhiệm vụ mà game có thể dùng (tài liệu liệt kê đủ danh sách này)
const EXTRA = `smile laugh glasses bot ghost squirrel cat dog rabbit bird fish turtle snail bug rocket wand-sparkles skull gem diamond
  coins sword crosshair bomb leaf sun moon snowflake cake music headphones brain puzzle dice-5 map compass mountain atom earth
  car bike footprints feather apple cherry pizza candy cookie ship plane anchor tree-pine flower-2 square circle triangle hexagon
  layers grid-3x3 badge-check sparkle medal hand-metal rocket scissors sword ghost magnet door-open handshake lightbulb chess-king chess-queen chess-knight`;
// tập con cho game Cubes 2048 (game phải tự chứa mọi file trong gói)
const CUBES = `trophy box volume-2 volume-x settings maximize gift zap globe users rotate-ccw palette gamepad-2 mouse smartphone square
  divide shield magnet party-popper house hourglass ban inbox lock triangle-alert circle-check medal bot loader-circle crown
  timer star sparkles swords target wifi wifi-off x check flame ghost`;

// tập con cho game Cờ Vua
const CHESS = `undo-2 lightbulb handshake flag refresh-cw volume-2 volume-x house play bot globe swords users trophy medal crown
  frown loader-circle triangle-alert wifi-off info user-round`;
// tập con cho game Diều Chiến
const KITE = `pause trophy map coins play shopping-cart circle-help gift mouse-pointer-click gem sword shield cloud-lightning check x door-open house rotate-ccw zap ghost magnet timer heart triangle-alert globe bot users loader-circle swords`;
const names = s => [...new Set(s.split(/\s+/).filter(Boolean))];
const num = v => Number(v || 0);
const f = n => +n.toFixed(3);

function toPath(tag, a) {
  switch (tag) {
    case 'path': return a.d;
    case 'line': return `M${a.x1} ${a.y1}L${a.x2} ${a.y2}`;
    case 'polyline': case 'polygon': {
      const p = a.points.trim().split(/[\s,]+/).map(Number);
      let d = `M${p[0]} ${p[1]}`;
      for (let i = 2; i < p.length; i += 2) d += `L${p[i]} ${p[i + 1]}`;
      return tag === 'polygon' ? d + 'Z' : d;
    }
    case 'circle': case 'ellipse': {
      const cx = num(a.cx), cy = num(a.cy), rx = num(a.rx || a.r), ry = num(a.ry || a.r);
      return `M${f(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${f(2 * rx)} 0a${rx} ${ry} 0 1 0 ${f(-2 * rx)} 0`;
    }
    case 'rect': {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      const rx = Math.min(num(a.rx || a.ry), w / 2), ry = Math.min(num(a.ry || a.rx), h / 2);
      if (!rx) return `M${x} ${y}h${w}v${h}h${-w}Z`;
      return `M${f(x + rx)} ${y}h${f(w - 2 * rx)}a${rx} ${ry} 0 0 1 ${rx} ${ry}v${f(h - 2 * ry)}a${rx} ${ry} 0 0 1 ${-rx} ${ry}`
        + `h${f(-(w - 2 * rx))}a${rx} ${ry} 0 0 1 ${-rx} ${-ry}v${f(-(h - 2 * ry))}a${rx} ${ry} 0 0 1 ${rx} ${-ry}Z`;
    }
    default: throw new Error('Không hỗ trợ thẻ ' + tag);
  }
}

function load(name) {
  const file = path.join(SRC, name + '.svg');
  if (!fs.existsSync(file)) throw new Error(`Không có icon "${name}" trong lucide-static ${VERSION}`);
  const svg = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of svg.matchAll(/<(path|circle|rect|line|polyline|polygon|ellipse)\b([^>]*?)\/?>/g)) {
    const a = {};
    for (const at of m[2].matchAll(/([\w-]+)="([^"]*)"/g)) a[at[1]] = at[2];
    out.push(toPath(m[1], a));
  }
  return out;
}

// Mã chạy trong trình duyệt: ic(tên, lớp) -> chuỗi <svg>; ic.draw(ctx, tên, x, y, cỡ, màu) vẽ lên canvas.
const RUNTIME = `
  var A = ' viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';
  function ic(name, cls) {
    var p = D[name] || D[FALLBACK];
    return '<svg class="icon' + (cls ? ' ' + cls : '') + '"' + A + '><path d="' + p.join('"/><path d="') + '"/></svg>';
  }
  ic.has = function (n) { return Object.prototype.hasOwnProperty.call(D, n); };
  ic.names = Object.keys(D);
  ic.or = function (n, def) { return ic.has(n) ? n : def; };
  ic.draw = function (ctx, name, x, y, size, color, width) {
    var p = D[name] || D[FALLBACK], k = size / 24;
    ctx.save(); ctx.translate(x, y); ctx.scale(k, k);
    ctx.strokeStyle = color || '#fff'; ctx.lineWidth = width || 2; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (var i = 0; i < p.length; i++) ctx.stroke(new Path2D(p[i]));
    ctx.restore();
  };
  g.ic = ic;`;

function build(list, out, fallback) {
  const data = {};
  for (const n of list) data[n] = load(n);
  const js = `/* Icon Lucide v${VERSION} (https://lucide.dev) — giấy phép ISC, © Lucide Contributors.\n`
    + ` * File sinh tự động bởi tools/build-icons.js — đừng sửa tay. */\n(function (g) {\n  'use strict';\n`
    + `  var FALLBACK = ${JSON.stringify(fallback)};\n  var D = ${JSON.stringify(data)};${RUNTIME}\n})(window);\n`;
  fs.writeFileSync(path.join(ROOT, out), js);
  console.log(`✔ ${out}: ${list.length} icon, ${(js.length / 1024).toFixed(1)} KB`);
}

build(names(UI + ' ' + EXTRA), 'public/icons.js', 'circle-help');
build(names(CUBES), 'seed-games/cubes-2048/icons.js', 'square');
build(names(CHESS), 'seed-games/chess/icons.js', 'circle');
build(names(KITE), 'seed-games/dieu-chien/icons.js', 'circle');
module.exports = { load };
