/*!
 * GameHub SDK v1.0 — thư viện nhỏ giúp game HTML5 nói chuyện với cổng GameHub.
 *
 * Giao thức (có thể tự viết lại nếu muốn): game <-> portal qua window.postMessage
 *   game -> portal : { gh:1, id, type, payload }
 *   portal -> game : { gh:1, replyTo:id, ok, data | error, code }   (trả lời)
 *                    { gh:1, event:'pause'|'resume'|'mute'|'task', data }   (sự kiện chủ động; task = {open, placement}: đang làm nhiệm vụ nhận thưởng)
 *
 * Chạy độc lập (mở index.html trực tiếp / localhost) SDK tự chuyển sang chế độ "mock":
 * dữ liệu lưu trong localStorage, in log ra console — để bạn phát triển mà không cần portal.
 */
(function (global) {
  'use strict';
  if (global.GameHub) return;

  var VERSION = '1.0';
  var inFrame = false;
  try { inFrame = global.parent && global.parent !== global; } catch (e) { inFrame = false; }

  var seq = 0, pending = {}, handlers = {}, mode = 'pending', mockState = null;
  var GameHub = { version: VERSION, player: null, game: null, mode: 'pending', preview: false, rewards: {} };

  function post(msg) { msg.gh = 1; global.parent.postMessage(msg, '*'); }
  function request(type, payload, timeout) {
    return new Promise(function (resolve, reject) {
      var id = ++seq;
      var timer = setTimeout(function () { delete pending[id]; reject(new Error('GameHub: hết thời gian chờ "' + type + '"')); }, timeout || 10000);
      pending[id] = { resolve: resolve, reject: reject, timer: timer };
      post({ id: id, type: type, payload: payload === undefined ? null : payload });
    });
  }
  function emit(name, data) {
    (handlers[name] || []).slice().forEach(function (fn) { try { fn(data); } catch (e) { console.error(e); } });
  }

  global.addEventListener('message', function (e) {
    var m = e.data;
    if (!m || m.gh !== 1) return;
    if (inFrame && e.source !== global.parent) return;           // chỉ tin tin nhắn từ portal
    if (m.replyTo) {
      var p = pending[m.replyTo];
      if (!p) return;
      clearTimeout(p.timer); delete pending[m.replyTo];
      if (m.ok) p.resolve(m.data);
      else { var err = new Error(m.error || 'GameHub error'); err.code = m.code; p.reject(err); }
    } else if (m.event) emit(m.event, m.data);
  });

  // ---------------- chế độ mock (chạy độc lập) ----------------
  function mockStore() {
    var mem = {};
    try { global.localStorage.setItem('__gh', '1'); global.localStorage.removeItem('__gh'); return global.localStorage; }
    catch (e) { return { getItem: function (k) { return k in mem ? mem[k] : null; }, setItem: function (k, v) { mem[k] = String(v); } }; }
  }
  function startMock(why) {
    mode = GameHub.mode = 'mock';
    var st = mockStore(), key = 'ghmock:' + location.pathname;
    mockState = JSON.parse(st.getItem(key) || '{"save":null,"scores":[],"ach":{}}');
    var persist = function () { try { st.setItem(key, JSON.stringify(mockState)); } catch (e) { /* bỏ qua */ } };
    var log = function () { console.log.apply(console, ['%c[GameHub mock]', 'color:#7c5cff;font-weight:bold'].concat([].slice.call(arguments))); };
    log('chạy độc lập (' + why + ') — dữ liệu chỉ lưu trên máy bạn');
    GameHub.player = { id: 0, username: 'dev', displayName: 'Dev (local)', avatar: 'bot', guest: false, mock: true };
    GameHub.game = { slug: 'local', name: document.title, version: '0.0.0' };
    return {
      ready: function () { log('ready()'); return {}; },
      gameStart: function () { log('gameStart()'); return {}; },
      gameOver: function (p) { log('gameOver()', p); return {}; },
      submitScore: function (p) {
        var best = mockState.scores.length ? Math.max.apply(null, mockState.scores) : null;
        mockState.scores.push(p.score); persist();
        var isBest = best === null || p.score > best;
        log('submitScore', p.score, p.meta || ''); return { saved: true, best: isBest ? p.score : best, isNewBest: isBest, rank: 1, mock: true };
      },
      unlockAchievement: function (p) {
        var fresh = !mockState.ach[p.key]; mockState.ach[p.key] = 1; persist();
        log('unlockAchievement', p.key, fresh ? '(mới)' : '(đã có)'); return { saved: true, newlyUnlocked: fresh };
      },
      save: function (p) { mockState.save = p.data; persist(); return { saved: true }; },
      load: function () { return { data: mockState.save }; },
      leaderboard: function () { return { entries: [], mock: true }; },
      rewardStatus: function (p) { return { available: true, placement: { placement: p.placement }, mock: true }; },
      requestReward: function (p) {
        log('requestReward', p.placement, '→ tự động nhận thưởng (chế độ mock, không có nhiệm vụ thật)');
        return new Promise(function (r) { setTimeout(r, 400); }).then(function () {
          var cfg = GameHub.rewards[p.placement];
          return { rewarded: true, placement: p.placement, reward: cfg ? cfg.reward : { type: p.placement, amount: 1 }, mock: true };
        });
      },
      event: function (p) { log('event', p.name, p.data); return {}; },
    };
  }
  var mock = null;
  function call(type, payload, timeout) {
    if (mode === 'mock') {
      var fn = mock[type];
      return Promise.resolve().then(function () { return fn(payload || {}); });
    }
    if (mode === 'pending') return Promise.reject(new Error('Hãy gọi GameHub.init() trước'));
    return request(type, payload, timeout);
  }

  // ---------------- API công khai ----------------
  /** Khởi tạo. Trả về { player, game, settings, preview }. Gọi 1 lần khi game bắt đầu tải. */
  GameHub.init = function () {
    if (!inFrame) { mock = startMock('không nằm trong portal'); return Promise.resolve(info()); }
    return request('init', { sdk: VERSION }, 2500).then(function (r) {
      mode = GameHub.mode = 'hosted';
      GameHub.player = r.player; GameHub.game = r.game; GameHub.preview = !!r.preview;
      (r.rewards || []).forEach(function (p) { GameHub.rewards[p.placement] = p; });
      return info(r.settings);
    }, function () { mock = startMock('portal không phản hồi'); return info(); });
  };
  function info(settings) { return { player: GameHub.player, game: GameHub.game, settings: settings || { muted: false }, preview: GameHub.preview, mode: mode, rewards: GameHub.rewards }; }

  /** Báo game đã tải xong (tắt màn hình loading của portal). */
  GameHub.ready = function () { return call('ready'); };
  /** Bắt đầu một lượt chơi (dùng để thống kê số lượt & thời gian chơi). */
  GameHub.gameStart = function () { return call('gameStart'); };
  /** Kết thúc lượt chơi. Có thể kèm { score, meta } để tự gửi điểm luôn. */
  GameHub.gameOver = function (result) { return call('gameOver', result || {}); };
  /** Gửi điểm lên bảng xếp hạng. Trả về { saved, best, isNewBest, rank } — saved=false nếu chưa đăng nhập. */
  GameHub.submitScore = function (score, meta) { return call('submitScore', { score: score, meta: meta || null }); };
  /** Mở khóa thành tựu đã khai báo trong gamehub.json. */
  GameHub.unlockAchievement = function (key) { return call('unlockAchievement', { key: key }); };
  /** Lưu dữ liệu game (JSON, tối đa 64KB) lên tài khoản người chơi. */
  GameHub.save = function (data) { return call('save', { data: data }); };
  /** Đọc dữ liệu đã lưu. Trả về null nếu chưa có hoặc chưa đăng nhập. */
  GameHub.load = function () { return call('load').then(function (r) { return r ? r.data : null; }); };
  /** Lấy bảng xếp hạng { period:'all'|'week'|'day', limit }. */
  GameHub.leaderboard = function (opts) { return call('leaderboard', opts || {}); };
  /**
   * Mời người chơi làm 1 nhiệm vụ (xem live TikTok, đọc bài Facebook...) để nhận thưởng ở "placement"
   * đã khai báo trong gamehub.json. Portal tạm dừng game, hiện danh sách nhiệm vụ, chờ người chơi làm xong.
   * Trả về { rewarded: true, reward: {type, amount}, placement, token }
   *     hoặc { rewarded: false, reason: 'closed'|'cooldown'|'limit'|'no_tasks'|'disabled'|'login'|'busy'|'error', retryAfterSec? }
   * Game tự áp dụng phần thưởng khi rewarded === true.
   */
  GameHub.requestReward = function (placement) { return call('requestReward', { placement: placement }, 3 * 3600e3); };
  /** Tên cũ, giữ để tương thích. */
  GameHub.showRewardedAd = GameHub.requestReward;
  /** Kiểm tra trước (không mở giao diện): { available, reason?, retryAfterSec?, remainingToday? } — dùng để ẩn/hiện nút. */
  GameHub.rewardStatus = function (placement) { return call('rewardStatus', { placement: placement }); };
  // ---------------- Multiplayer ----------------
  // Phòng "relay": máy chủ chuyển tin giữa người chơi + trạng thái chung (key/value), có "host" (người vào đầu tiên).
  // Phòng "authoritative": máy chủ chạy logic game (chỉ game hệ thống) — tin nhắn là giao thức riêng của game đó.
  function Room(ws, kind) {
    var self = this, ev = {}, pings = {}, pingSeq = 0;
    this.kind = kind; this.id = null; this.code = null; this.me = null; this.host = null;
    this.players = {}; this.state = {}; this.open = true;
    var fire = function (name) {
      var args = [].slice.call(arguments, 1);
      (ev[name] || []).slice().forEach(function (fn) { try { fn.apply(self, args); } catch (e) { console.error(e); } });
    };
    var raw = function (obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };
    /** Lắng nghe: 'join' | 'leave' | 'host' | 'state' | 'message' | 'close' | 'error' | <loại tin của game> */
    this.on = function (name, fn) { (ev[name] = ev[name] || []).push(fn); return self; };
    this.off = function (name, fn) { ev[name] = (ev[name] || []).filter(function (f) { return f !== fn; }); return self; };
    /** relay: gửi tin cho mọi người khác trong phòng. authoritative: gửi lệnh {t:type, ...data} cho máy chủ. */
    this.send = function (type, data) {
      if (kind === 'relay') raw({ t: 'msg', type: type, data: data === undefined ? null : data });
      else { var m = {}; for (var k in (data || {})) m[k] = data[k]; m.t = type; raw(m); }
    };
    /** relay: gửi riêng cho một người chơi */
    this.sendTo = function (playerId, type, data) { raw({ t: 'msg', type: type, data: data === undefined ? null : data, to: playerId }); };
    /** relay: đặt trạng thái chung của phòng (mọi người nhận sự kiện 'state'); value = null để xóa */
    this.setState = function (key, value) { raw({ t: 'set', key: key, value: value === undefined ? null : value }); };
    /** Đo độ trễ khứ hồi tới máy chủ (ms) */
    this.ping = function () {
      return new Promise(function (resolve) { var id = ++pingSeq; pings[id] = { at: Date.now(), resolve: resolve }; raw({ t: 'ping', at: id }); });
    };
    this.leave = function () { self.open = false; try { ws.close(1000, 'leave'); } catch (e) { /* */ } };
    this._handle = function (m) {
      switch (m.t) {
        case 'joined':
          self.id = m.room.id; self.code = m.room.code; self.me = m.you; self.host = m.host; self.state = m.state || {};
          m.players.forEach(function (p) { self.players[p.id] = p; });
          return;
        case 'welcome': self.id = m.room.id; self.code = m.room.code; self.me = m.you; return;   // nội dung đầy đủ ở room.welcome
        case 'join': self.players[m.player.id] = m.player; return fire('join', m.player);
        case 'leave': { var p = self.players[m.id]; delete self.players[m.id]; return fire('leave', p || { id: m.id }); }
        case 'host': self.host = m.id; return fire('host', m.id);
        case 'state': if (m.value === null) delete self.state[m.key]; else self.state[m.key] = m.value; return fire('state', m.key, m.value, m.by);
        case 'msg': fire(m.type, m.data, m.from); return fire('message', m.type, m.data, m.from);
        case 'pong': { var q = pings[m.at]; if (q) { delete pings[m.at]; q.resolve(Date.now() - q.at); } return; }
        case 'error': return fire('error', new Error(m.error));
      }
      fire(m.t, m); fire('message', m.t, m);
    };
    ws.onclose = function (e) { self.open = false; fire('close', { code: e.code, reason: e.reason }); };
  }

  GameHub.multiplayer = {
    /**
     * Vào phòng chơi nhiều người. opts: { code: 'ABC123' } vào phòng riêng · { create: true } tạo phòng riêng · {} ghép phòng công khai.
     * Trả về Room khi máy chủ xác nhận. Chỉ hoạt động khi game chạy trên GameHub (cần khai báo "multiplayer" trong gamehub.json).
     */
    join: function (opts) {
      opts = opts || {};
      if (mode !== 'hosted') {
        var e = new Error('Multiplayer chỉ hoạt động khi game chạy trên GameHub'); e.code = 'offline';
        return Promise.reject(e);
      }
      return request('rtTicket', {}).then(function (t) {
        return new Promise(function (resolve, reject) {
          var ws = new WebSocket(t.url), room = new Room(ws, t.mode), settled = false;
          var timer = setTimeout(function () { if (!settled) { settled = true; reject(new Error('Không kết nối được máy chủ multiplayer')); try { ws.close(); } catch (x) { /* */ } } }, 10000);
          ws.onopen = function () { ws.send(JSON.stringify({ t: 'join', code: opts.code || null, create: !!opts.create })); };
          ws.onerror = function () { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Lỗi kết nối máy chủ multiplayer')); } };
          ws.onmessage = function (e) {
            var m; try { m = JSON.parse(e.data); } catch (x) { return; }
            if (!settled) {
              if (m.t === 'error') { settled = true; clearTimeout(timer); var err = new Error(m.error); err.code = 'join_failed'; reject(err); return; }
              if (m.t === 'joined' || m.t === 'welcome') { room.welcome = m; room._handle(m); settled = true; clearTimeout(timer); resolve(room); return; }
            }
            room._handle(m);
          };
        });
      });
    },
  };

  /** Gửi sự kiện tùy ý (chỉ hiển thị trong nhật ký xem thử của admin). */
  GameHub.event = function (name, data) { return call('event', { name: name, data: data === undefined ? null : data }); };
  /** Lắng nghe sự kiện từ portal: 'pause' | 'resume' | 'mute' ({muted}) */
  GameHub.on = function (name, fn) { (handlers[name] = handlers[name] || []).push(fn); return GameHub; };
  GameHub.off = function (name, fn) { handlers[name] = (handlers[name] || []).filter(function (f) { return f !== fn; }); return GameHub; };

  global.GameHub = GameHub;
})(window);
