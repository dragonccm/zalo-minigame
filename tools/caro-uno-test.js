#!/usr/bin/env node
'use strict';
// Kiểm thử phòng online Caro và UNO qua server đang chạy: node tools/caro-uno-test.js
const assert = require('node:assert/strict');
const { WebSocket } = require('ws');
const BASE = process.env.BASE || 'http://localhost:8080';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function ticket(slug) {
  const res = await fetch(`${BASE}/api/games/${slug}/realtime-ticket`);
  assert.equal(res.status, 200, `${slug}: không lấy được vé realtime`);
  return (await res.json()).ticket;
}
async function connect(slug) {
  const token = await ticket(slug);
  const ws = new WebSocket(`${BASE.replace(/^http/, 'ws')}/rt?ticket=${encodeURIComponent(token)}`);
  const c = { ws, messages: [], send: data => ws.send(JSON.stringify(data)), close: () => ws.close() };
  ws.on('message', raw => c.messages.push(JSON.parse(String(raw))));
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  c.wait = async (kind, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const index = c.messages.findIndex(m => m.t === kind);
      if (index >= 0) return c.messages.splice(index, 1)[0];
      await sleep(20);
    }
    throw Error(`Hết thời gian chờ ${slug}:${kind} (${JSON.stringify(c.messages.slice(-3))})`);
  };
  return c;
}

async function pair(slug) {
  const a = await connect(slug); a.send({ t: 'join', create: true });
  const wa = await a.wait('welcome');
  const b = await connect(slug); b.send({ t: 'join', code: wa.room.code });
  const wb = await b.wait('welcome');
  assert.equal(wb.room.id, wa.room.id);
  return [a, b, wa.room.code];
}

async function testCaro() {
  const [a, b, code] = await pair('caro');
  try {
    const sa = await a.wait('start'), sb = await b.wait('start');
    assert.equal(sa.side + sb.side, 3);
    const x = sa.side === 1 ? a : b, o = sa.side === 2 ? a : b;
    o.send({ t: 'mv', x: 7, y: 7 });
    assert.match((await o.wait('reject')).error, /lượt/);
    x.send({ t: 'mv', x: 7, y: 7 });
    assert.equal((await x.wait('mv')).side, 1);
    assert.equal((await o.wait('mv')).side, 1);
    o.send({ t: 'mv', x: 7, y: 7 });
    assert.match((await o.wait('reject')).error, /hợp lệ/);
    o.send({ t: 'mv', x: 8, y: 7 });
    assert.equal((await x.wait('mv')).side, 2);
    await o.wait('mv');
    x.send({ t: 'resign' });
    assert.equal((await a.wait('end')).winner, 2);
    assert.equal((await b.wait('end')).reason, 'resign');
    x.close();
    await o.wait('opp_left');
    const replacement = await connect('caro');
    try {
      replacement.send({ t: 'join', code });
      await replacement.wait('welcome');
      const oldStart = await o.wait('start'), newStart = await replacement.wait('start');
      assert.equal(oldStart.side + newStart.side, 3);
    } finally { replacement.close(); }
    console.log('✓ Caro: tạo phòng, chia quân, kiểm tra nước đi, đầu hàng và thay người');
  } finally { a.close(); b.close(); }
}

async function testUno() {
  const [a, b, code] = await pair('uno');
  try {
    const sa = await a.wait('start'), sb = await b.wait('start');
    assert.equal(sa.view.hand.length, 7);
    assert.equal(sb.view.hand.length, 7);
    assert.equal(sa.view.players.length, 2);
    assert.equal(sa.view.deckCount, 93);
    assert.equal(sa.view.hand.some(c => sb.view.hand.some(d => d.id === c.id)), false, 'Bài hai người bị trùng');
    assert.equal(JSON.stringify(sa).includes('"pile"'), false, 'Lộ bộ bài còn lại');
    const current = sa.view.turnId === sa.view.players[0].id ? a : b;
    const currentView = current === a ? sa.view : sb.view;
    current.send({ t: 'play', cardId: -1 });
    assert.match((await current.wait('reject')).error, /không có lá/);
    const top = currentView.top;
    const card = currentView.hand.find(c => c.c === 'w' || c.c === currentView.color || (top.c !== 'w' && c.v === top.v));
    if (card) {
      current.send({ t: 'play', cardId: card.id, color: card.c === 'w' ? 'r' : null });
      const qa = await a.wait('snapshot'), qb = await b.wait('snapshot');
      assert.equal(qa.view.top.id, card.id);
      assert.equal(qb.view.top.id, card.id);
      assert.equal(qa.view.players.find(p => p.id === currentView.turnId).count, 6);
    } else {
      current.send({ t: 'draw' });
      await a.wait('snapshot'); await b.wait('snapshot');
    }
    const third = await connect('uno');
    try {
      third.send({ t: 'join', code });
      assert.match((await third.wait('error')).error, /bắt đầu|đầy/);
    } finally { third.close(); }
    a.close();
    assert.equal((await b.wait('end')).reason, 'left');
    const replacement = await connect('uno');
    try {
      replacement.send({ t: 'join', code });
      await replacement.wait('welcome');
      assert.equal((await b.wait('start')).view.players.length, 2);
      assert.equal((await replacement.wait('start')).view.hand.length, 7);
    } finally { replacement.close(); }
    console.log('✓ UNO: chia bài riêng, kiểm tra hành động, khóa phòng đang chơi và thay người');
  } finally { a.close(); b.close(); }
}

(async () => { await testCaro(); await testUno(); })().catch(e => { console.error(e); process.exitCode = 1; });
