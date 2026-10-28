#!/usr/bin/env node
'use strict';
// Kiểm thử giao diện thật bằng Chrome headless: node tools/ui-test.js <thư-mục-lưu-ảnh>
const fs = require('node:fs');
const path = require('node:path');
const { launch, sleep } = require('./cdp');

const BASE = process.env.BASE || 'http://localhost:8080';
const OUT = process.argv[2] || '/tmp/gamehub-shots';
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✖', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

(async () => {
  const b = await launch({ width: 1280, height: 800 });
  const shot = n => b.shot(path.join(OUT, n + '.png'));
  // chờ tới khi biểu thức đúng (render 3D bằng phần mềm làm mọi thứ chậm, không dùng sleep cố định)
  const waitFor = async (expr, ms = 10000, ctxId) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await b.eval(expr, ctxId).catch(() => false)) return true; await sleep(200); }
    return false;
  };
  const enterCode = async code => {
    await b.eval(`{ const i = document.querySelector('[data-code]'); i.value = ${JSON.stringify(code)}; i.dispatchEvent(new Event('input')); }`);
    const ready = await waitFor(`!document.querySelector('[data-claim]').disabled`);
    await b.eval(`document.querySelector('[data-claim]').click()`);
    return ready;
  };
  const text = sel => b.eval(`(document.querySelector(${JSON.stringify(sel)})||{}).innerText||''`);
  try {
    console.log('\n[Trang chủ — khách]');
    await b.nav(BASE + '/#/', 1500);
    ok((await text('#cards')).includes('Cubes 2048 Arena'), 'Trang chủ liệt kê Cubes 2048');
    ok((await b.eval(`document.querySelectorAll('.gcard').length`)) >= 1, 'Có thẻ game');
    await shot('01-home');

    console.log('\n[Đăng nhập bằng giao diện]');
    await b.eval(`document.querySelector('[data-act=login]').click()`);
    await sleep(200);
    await b.eval(`(()=>{const f=document.querySelector('#authForm'); f.username.value='admin'; f.password.value='AdminPass123'; f.requestSubmit();})()`);
    await sleep(900);
    ok((await text('#userbox')).includes('Quản trị viên'), 'Đăng nhập thành công, hiện tên trên thanh trên');
    ok(!(await b.eval(`document.querySelector('#navAdmin').classList.contains('hidden')`)), 'Admin thấy menu Quản trị');

    console.log('\n[Trang game + cầu nối SDK trong iframe sandbox]');
    await b.nav(BASE + '/#/game/cubes-2048', 3500);
    // ghi lại mọi toast (render 3D bằng phần mềm rất chậm nên toast có thể tắt trước khi test kịp đọc)
    await b.eval(`window.__t = []; new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => window.__t.push(n.textContent)))).observe(document.querySelector('#toasts'), { childList: true })`);
    const toasts = () => b.eval(`window.__t.join(' | ')`);
    const sandbox = await b.eval(`document.querySelector('#player iframe').getAttribute('sandbox')`);
    ok(sandbox === 'allow-scripts allow-pointer-lock' && !/same-origin/.test(sandbox), 'iframe sandbox không có allow-same-origin', sandbox);
    ok(!(await b.eval(`!!document.querySelector('#loading')`)), 'Màn hình loading tắt khi game gọi ready()');
    const ctx = await b.frameCtx();
    ok(!!ctx, 'Tìm thấy context của game trong iframe');
    const initInfo = await b.eval(`JSON.stringify({mode: GameHub.mode, guest: GameHub.player && GameHub.player.guest, name: GameHub.player && GameHub.player.displayName})`, ctx);
    const ii = JSON.parse(initInfo);
    ok(ii.mode === 'hosted' && ii.guest === false && ii.name === 'Quản trị viên', 'SDK ở chế độ hosted, nhận đúng thông tin người chơi', ii);
    // game không truy cập được cookie/localStorage của portal
    const leak = await b.eval(`(()=>{try{return 'cookie:'+document.cookie.length}catch(e){return 'blocked:'+e.name}})()`, ctx);
    ok(/^(cookie:0|blocked)/.test(leak), 'Game không đọc được cookie phiên của portal', leak);
    const ls = await b.eval(`(()=>{try{localStorage.getItem('x');return 'ok'}catch(e){return 'blocked'}})()`, ctx);
    ok(ls === 'blocked', 'localStorage bị chặn trong sandbox', ls);
    const ext = await b.eval(`fetch('https://example.com/').then(()=> 'allowed').catch(()=> 'blocked')`, ctx);
    ok(ext === 'blocked', 'CSP chặn kết nối ra ngoài', ext);

    await b.eval(`GameHub.gameStart()`, ctx);
    const ach = await b.eval(`GameHub.unlockAchievement('merge_256')`, ctx);
    ok(ach && ach.newlyUnlocked === true, 'unlockAchievement qua cầu nối', ach);
    await sleep(500);
    ok((await toasts()).includes('Lớn dần'), 'Toast thành tựu hiển thị trong portal');
    ok((await b.eval(`document.querySelectorAll('.ach:not(.locked)').length`)) === 1, 'Danh sách thành tựu cập nhật (1 mở khóa)');
    await sleep(2200);
    const over = await b.eval(`GameHub.gameOver({score: 4321, meta: {maxBlock: 512}})`, ctx);
    ok(over.score && over.score.saved && over.score.rank === 1, 'gameOver gửi điểm, nhận hạng', over);
    await sleep(700);
    ok((await text('#lb')).includes('4.321') || (await text('#lb')).includes('4,321') || (await text('#lb')).includes('4321'), 'Bảng xếp hạng cập nhật điểm mới');
    ok(/Đã lưu.*hạng/.test(await toasts()), 'Toast điểm hiển thị');
    const sv = await b.eval(`GameHub.save({best: 4321, skin: 'medieval'}).then(()=>GameHub.load())`, ctx);
    ok(sv && sv.skin === 'medieval', 'save/load qua cầu nối', sv);
    await shot('02-game-page');

    console.log('\n[Nhiệm vụ nhận thưởng trong khung game]');
    // tạo nhiệm vụ ngắn (2 giây, cần mã) để thử nhanh
    const created = await b.eval(`fetch('/api/admin/tasks', { method: 'POST', headers: { 'X-GH': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Xem live TikTok thử', type: 'tiktok_live', url: 'https://www.tiktok.com/live', durationSec: 2, verify: 'code', code: 'XYZ', priority: 99 }) }).then(r => r.json())`);
    ok(created.task && created.task.id, 'Tạo nhiệm vụ thử', created);
    await b.eval(`window.__rr = GameHub.requestReward('power_boost'); 1`, ctx);
    await sleep(900);
    ok(await b.eval(`!!document.querySelector('#player .tasklayer')`), 'Bảng nhiệm vụ hiện trong khung game');
    ok((await text('.tasklayer')).includes('Siêu sức mạnh') && (await text('.tasklayer')).includes('Xem live TikTok thử'), 'Hiện phần thưởng của game và danh sách nhiệm vụ');
    await shot('12-task-list');
    await b.eval(`[...document.querySelectorAll('.tk-item')].find(x => x.textContent.includes('Xem live TikTok thử')).click()`);
    await sleep(200);
    await b.eval(`document.querySelector('[data-open]').click()`);
    await sleep(600);
    ok(await b.eval(`document.querySelector('[data-claim]').disabled`), 'Nút nhận thưởng khóa khi chưa đủ thời gian');
    await shot('13-task-doing');
    await waitFor(`((document.querySelector('[data-left]') || {}).textContent || '').includes('Đã đủ thời gian')`);
    ok(await b.eval(`document.querySelector('[data-claim]').disabled`), 'Đủ thời gian nhưng chưa nhập mã → vẫn khóa');
    await enterCode('sai');
    ok(await waitFor(`(document.querySelector('[data-err]') || {}).textContent.includes('Mã xác nhận chưa đúng')`), 'Sai mã → báo lỗi ngay trong bảng');
    await enterCode('xyz');
    await waitFor(`!!document.querySelector('.tasklayer h3')`);
    await shot('14-task-done');
    await waitFor(`!document.querySelector('.tasklayer')`);
    const rr = await b.eval(`window.__rr`, ctx);
    ok(rr && rr.rewarded === true && rr.reward.amount === 10 && rr.placement === 'power_boost' && rr.token, 'Game nhận được kết quả rewarded + phần thưởng + token', rr);
    ok(!(await b.eval(`!!document.querySelector('.tasklayer')`)), 'Bảng nhiệm vụ tự đóng sau khi nhận');
    const again = await b.eval(`GameHub.requestReward('power_boost')`, ctx);
    ok(again.rewarded === false && again.reason === 'cooldown', 'Gọi lại ngay → cooldown, không mở bảng', again);
    // nút "Khởi đầu mạnh" thật của Cubes ở menu
    await b.eval(`document.getElementById('adStart').click()`, ctx);
    await waitFor(`!!document.querySelector('.tk-item')`);
    await b.eval(`[...document.querySelectorAll('.tk-item')].find(x => x.textContent.includes('Xem live TikTok thử')).click()`);
    await sleep(200);
    await b.eval(`document.querySelector('[data-open]').click()`);
    await enterCode('XYZ');
    await waitFor(`/Đã nhận/.test(document.getElementById('adStart').textContent)`, 10000, ctx);
    const btnTxt = await b.eval(`document.getElementById('adStart').textContent`, ctx);
    const diag = await b.eval(`JSON.stringify({ layer: !!document.querySelector('.tasklayer'), text: (document.querySelector('.tasklayer') || {}).innerText || '', claim: (document.querySelector('[data-claim]') || {}).disabled })`);
    ok(/Đã nhận: khối 16/.test(btnTxt), 'Nút "Khởi đầu mạnh" của Cubes nhận thưởng qua nhiệm vụ', { btnTxt, diag });
    // đóng bảng giữa chừng
    await b.eval(`window.__rc = GameHub.requestReward('revive'); 1`, ctx);
    await waitFor(`!!document.querySelector('.tasklayer [data-x]')`);
    await b.eval(`document.querySelector('.tasklayer [data-x]').click()`);
    await sleep(500);
    const rc = await b.eval(`window.__rc`, ctx);
    ok(rc.rewarded === false && rc.reason === 'closed', 'Đóng bảng → rewarded=false, reason=closed', rc);

    console.log('\n[Chơi online nhiều người]');
    await b.eval(`document.querySelector('#bReload').click()`);
    await sleep(3500);
    const gctx = await b.frameCtx();
    ok(await b.eval(`!document.getElementById('playOnline').classList.contains('hidden')`, gctx), 'Menu có nút "Chơi online" khi chạy trên GameHub');
    await b.eval(`document.getElementById('playOnline').click()`, gctx);
    ok(await waitFor(`!!(window.__game.net && window.__game.net.myId && window.__game.state === 'playing')`, 15000, gctx), 'Vào phòng online, nhận rắn từ máy chủ (WebSocket từ iframe sandbox được phép)');
    ok(await waitFor(`window.__game.net.byId.size >= 10 && window.__game.snakes.filter(s => s.alive).length >= 8`, 8000, gctx), 'Thấy rắn trong đấu trường (bot do máy chủ điều khiển)');
    // người chơi thứ 2: một client Node vào cùng phòng
    const tk = await (await fetch(BASE + '/api/games/cubes-2048/realtime-ticket', { headers: { 'X-GH': '1' } })).json();
    const other = new WebSocket(BASE.replace(/^http/, 'ws') + '/rt?ticket=' + encodeURIComponent(tk.ticket));
    await new Promise(r => { other.onopen = r; });
    other.send(JSON.stringify({ t: 'join' }));
    await sleep(300);
    other.send(JSON.stringify({ t: 'spawn', name: 'NodeBot', skin: 'medieval' }));
    ok(await waitFor(`[...window.__game.net.byId.values()].some(s => s.name === 'NodeBot' && s.alive && s.skin === 'medieval')`, 8000, gctx), 'Trình duyệt thấy người chơi thứ 2 (tên + skin) cùng phòng');
    const x0 = await b.eval(`window.__game.player.x`, gctx);
    await b.eval(`window.__game.input.keys.KeyD = true; 1`, gctx);
    await sleep(1500);
    const x1 = await b.eval(`window.__game.player.x`, gctx);
    await b.eval(`window.__game.input.keys.KeyD = false; 1`, gctx);
    ok(Math.abs(x1 - x0) > 3, 'Điều khiển gửi lên máy chủ, rắn di chuyển theo snapshot', { x0, x1 });
    ok(await waitFor(`/Online|Phòng/.test(document.getElementById('netBadge').textContent)`, 3000, gctx), 'HUD hiện huy hiệu online + ping');
    await shot('17-online-play');
    await b.eval(`window.__game.net.room.send('debug_kill', {}); 1`, gctx);
    ok(await waitFor(`/máy chủ đã lưu điểm/.test(document.getElementById('overRank').textContent)`, 8000, gctx), 'Chết → máy chủ tự lưu điểm, màn hình thua báo hạng');
    await shot('18-online-dead');
    await b.eval(`document.getElementById('againBtn').click()`, gctx);
    ok(await waitFor(`window.__game.state === 'playing' && window.__game.player.alive`, 8000, gctx), 'Chơi lại trong cùng phòng');
    await b.eval(`window.__game.leaveOnline(); 1`, gctx);
    ok(await waitFor(`!window.__game.net && window.__game.state === 'menu' && window.__game.snakes.length > 5`, 8000, gctx), 'Rời phòng → quay về chơi với bot');
    other.close();

    console.log('\n[Hồ sơ]');
    await b.nav(BASE + '/#/u/admin', 1200);
    ok((await text('#view')).includes('Lớn dần') && (await text('#view')).includes('4.321'), 'Hồ sơ hiển thị thành tựu và điểm cao nhất');
    await shot('03-profile');
    await b.eval(`document.querySelector('#editProfile').click()`);
    await sleep(300);
    await shot('04-profile-edit');
    await b.eval(`document.querySelector('#modal').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);

    console.log('\n[Đăng game & tài liệu]');
    await b.nav(BASE + '/#/upload', 1000);
    ok((await text('#view')).includes('Kéo thả file .zip'), 'Trang upload hiển thị');
    await shot('05-upload');
    await b.nav(BASE + '/#/docs', 1000);
    ok((await text('#view')).includes('gamehub.json') && (await text('#view')).includes('GameHub SDK'), 'Trang tài liệu hiển thị');
    await shot('06-docs');

    console.log('\n[Quản trị: duyệt game]');
    await b.nav(BASE + '/#/admin', 1500);
    const pend = await text('#apane');
    ok(pend.includes('Click Rush') && pend.includes('Chờ duyệt'), 'Hàng đợi hiển thị game chờ duyệt');
    await shot('07-admin-pending');
    await b.eval(`document.querySelector('[data-a=preview]').click()`);
    await sleep(3000);
    const pctx = await b.frameCtx();
    ok(!!pctx, 'Xem thử mở game trong iframe');
    await b.eval(`GameHub.submitScore(99)`, pctx).catch(() => {});
    await b.eval(`GameHub.unlockAchievement('first_run')`, pctx).catch(() => {});
    await sleep(500);
    const logTxt = await text('#plog');
    ok(/submitScore/.test(logTxt) && /unlockAchievement/.test(logTxt), 'Nhật ký SDK hiển thị lệnh game đã gọi', logTxt.slice(0, 200));
    ok(/"preview":true/.test(logTxt), 'Chế độ xem thử không ghi dữ liệu thật');
    await shot('08-admin-preview');
    await b.eval(`document.querySelector('#modal').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
    await sleep(300);
    await b.eval(`document.querySelector('[data-note]').value='Ổn, duyệt!'; document.querySelector('[data-a=approve]').click()`);
    await sleep(1200);
    ok((await text('#apane')).includes('Không có game nào đang chờ duyệt'), 'Duyệt xong, hàng đợi trống');
    await b.eval(`document.querySelector('[data-t=games]').click()`);
    await sleep(800);
    await shot('09-admin-games');
    await b.eval(`document.querySelector('[data-t=tasks]').click()`);
    await sleep(900);
    ok((await text('#apane')).includes('Xem live TikTok thử') && (await text('#apane')).includes('2 / 2'), 'Tab Nhiệm vụ: danh sách + thống kê (2 xong / 2 bắt đầu)');
    await shot('15-admin-tasks');
    await b.eval(`document.querySelector('#newTask').click()`);
    await sleep(300);
    await shot('16-admin-task-form');
    await b.eval(`document.querySelector('#modal').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);

    console.log('\n[Di động]');
    await b.resize(390, 800, true);
    await b.nav(BASE + '/#/', 1200);
    await shot('10-mobile-home');
    await b.nav(BASE + '/#/game/cubes-2048', 3500);
    await shot('11-mobile-game');
    const overflow = await b.eval(`document.documentElement.scrollWidth > window.innerWidth + 2`);
    ok(!overflow, 'Không bị tràn ngang trên di động');

    const errs = b.logs.filter(l => !/Failed to load resource|favicon|ERR_BLOCKED|Refused to connect|Refused to load/.test(l));
    ok(errs.length === 0, 'Không có lỗi JS trong console', errs.slice(0, 5));
  } catch (e) { fail++; console.log('  ✖ Lỗi chạy test:', e.message); }
  b.close();
  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi — ảnh ở ${OUT}`);
  process.exit(fail ? 1 : 0);
})();
