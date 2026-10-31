#!/usr/bin/env node
'use strict';
// Kiểm chứng joystick ảo + 2 chiều màn hình cho Diều Chiến và Cubes 2048 (Chrome headless, mô phỏng cảm ứng)
const { launch, sleep } = require('./cdp');
const fs = require('node:fs');
const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.argv[2] || '/tmp/joy-shots';
fs.mkdirSync(OUT, { recursive: true });

// PointerEvent kiểu touch gửi thẳng vào canvas chính (nút bấm qua click thường)
const touch = (type, x, y) => `{ const c = document.querySelector('#cv, #c'); c.dispatchEvent(new PointerEvent('${type}', { pointerType: 'touch', clientX: ${x}, clientY: ${y}, bubbles: true })); }`;

(async () => {
  for (const [game, playBtn] of [['dieu-chien', 'bPlay'], ['cubes-2048', 'playBtn']]) {
    for (const [name, w, h] of [['portrait', 390, 844], ['landscape', 844, 390]]) {
      const b = await launch({ width: w, height: h });
      try {
        await b.nav(`${BASE}/#/${game === 'dieu-chien' ? 'game/dieu-chien' : 'game/cubes-2048'}`, 4000);
        const fctx = await b.frameCtx();
        const T = (type, x, y) => b.eval(touch(type, x, y), fctx);
        await b.eval(`document.querySelector('#${playBtn}').click()`, fctx);
        await sleep(2500);
        await T('pointerdown', Math.round(w * 0.5), Math.round(h * 0.72));
        await sleep(120);
        await T('pointermove', Math.round(w * 0.5) + 75, Math.round(h * 0.72) - 50);
        await sleep(800);
        await b.shot(`${OUT}/${game}-${name}.png`);
        console.log(`${game}-${name}: ok`);
      } catch (e) { console.error(game, name, e.message); }
      b.close();
      await sleep(1200);
    }
  }
  console.log('xong — ảnh ở', OUT);
})();
