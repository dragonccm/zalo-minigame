import { api } from '../api';

const PREVIEW_TASK = {
  id: 0,
  title: 'Nhiệm vụ mẫu (xem thử)',
  type: 'link',
  typeLabel: 'Mở liên kết',
  url: '',
  description: 'Chế độ xem thử: không mở link thật, chỉ đợi 3 giây.',
  icon: 'flask-conical',
  durationSec: 3,
  verify: 'time',
};

export class GameHost {
  constructor(iframe, game, opts = {}) {
    this.iframe = iframe;
    this.game = game;
    this.preview = !!opts.preview;
    this.opts = opts;
    this.playId = null;
    this.muted = false;
    this.guestHinted = false;
    this.mock = { best: null, ach: {}, save: null };
    this.taskBusy = false;

    this.onMsg = e => this.onMessage(e);
    this.onVis = () => {
      if (!document.hidden && this.taskBusy) return;
      this.send({ event: document.hidden ? 'pause' : 'resume' });
    };

    window.addEventListener('message', this.onMsg);
    document.addEventListener('visibilitychange', this.onVis);
  }

  destroy() {
    window.removeEventListener('message', this.onMsg);
    document.removeEventListener('visibilitychange', this.onVis);
    this.endPlay(true);
  }

  send(msg) {
    try {
      if (this.iframe && this.iframe.contentWindow) {
        this.iframe.contentWindow.postMessage({ gh: 1, ...msg }, '*');
      }
    } catch {
      /* iframe unmounted */
    }
  }

  setMuted(m) {
    this.muted = m;
    this.send({ event: 'mute', data: { muted: m } });
  }

  log(type, payload, result) {
    if (this.opts.log) this.opts.log(type, payload, result);
  }

  async onMessage(e) {
    if (!this.iframe || e.source !== this.iframe.contentWindow) return;
    const m = e.data;
    if (!m || m.gh !== 1 || typeof m.type !== 'string') return;
    try {
      const data = await this.handle(m.type, m.payload || {});
      this.log(m.type, m.payload, data);
      this.send({ replyTo: m.id, ok: true, data });
    } catch (err) {
      this.log(m.type, m.payload, { error: err.message });
      this.send({ replyTo: m.id, ok: false, error: err.message, code: err.status || 'error' });
    }
  }

  playerInfo() {
    const user = this.opts.getUser ? this.opts.getUser() : null;
    return user
      ? { id: user.id, username: user.username, displayName: user.displayName, avatar: user.avatar, guest: false }
      : { id: null, username: null, displayName: 'Khách', avatar: 'user-round', guest: true };
  }

  hintLogin() {
    if (this.guestHinted || this.preview) return;
    this.guestHinted = true;
    if (this.opts.onLoginHint) this.opts.onLoginHint();
  }

  async endPlay(quiet) {
    if (!this.playId || this.preview) return;
    const id = this.playId;
    this.playId = null;
    try {
      await fetch(`/api/games/${this.game.slug}/play/${id}/end`, {
        method: 'POST',
        headers: { 'X-GH': '1' },
        credentials: 'same-origin',
        keepalive: true,
      });
    } catch {
      /* ignore */
    }
    if (!quiet && this.opts.onRefreshUser) this.opts.onRefreshUser();
  }

  async submit(score, meta) {
    if (this.preview) {
      const isNew = this.mock.best === null || score > this.mock.best;
      if (isNew) this.mock.best = score;
      return { saved: true, best: this.mock.best, isNewBest: isNew, rank: 1, preview: true };
    }
    const user = this.opts.getUser ? this.opts.getUser() : null;
    if (!user) {
      this.hintLogin();
      return { saved: false, reason: 'login' };
    }
    try {
      const r = await api(`/api/games/${this.game.slug}/score`, { method: 'POST', body: { score, meta } });
      if (this.opts.onScore) this.opts.onScore(r, score);
      if (this.opts.onRefreshUser) this.opts.onRefreshUser();
      return r;
    } catch (e) {
      return { saved: false, reason: e.status === 429 ? 'rate' : e.status === 403 ? 'forbidden' : 'error', error: e.message };
    }
  }

  async rewardStatus(placement) {
    if (this.preview) {
      const p = (this.game.rewards || []).find(r => r.placement === placement);
      return p
        ? { available: true, placement: p, preview: true, tasks: [PREVIEW_TASK] }
        : { available: false, reason: 'unknown_placement' };
    }
    try {
      return await api(`/api/games/${this.game.slug}/rewards/${encodeURIComponent(placement)}`);
    } catch (e) {
      return { available: false, reason: e.status === 404 ? 'unknown_placement' : e.status === 403 ? 'forbidden' : 'error', error: e.message };
    }
  }

  async requestReward(placement) {
    if (this.taskBusy) return { rewarded: false, reason: 'busy' };
    this.taskBusy = true;
    let paused = false,
      taskOpen = false;
    try {
      const offer = await this.rewardStatus(placement);
      if (!offer.available) {
        if (offer.reason === 'login') this.hintLogin();
        const { tasks, ...rest } = offer;
        return { rewarded: false, ...rest };
      }
      if (!this.preview) {
        await api(`/api/games/${this.game.slug}/rewards/${encodeURIComponent(placement)}/open`, { method: 'POST' }).catch(() => {});
      }
      this.send({ event: 'pause' });
      this.send({ event: 'mute', data: { muted: true } });
      this.send({ event: 'task', data: { open: true, placement } });
      paused = true;
      taskOpen = true;

      if (this.opts.onRequestReward) {
        return await this.opts.onRequestReward(offer);
      }
      return { rewarded: false, reason: 'unhandled' };
    } finally {
      this.taskBusy = false;
      if (taskOpen) {
        this.send({ event: 'task', data: { open: false, placement } });
        if (!this.preview) {
          api(`/api/games/${this.game.slug}/rewards/close`, { method: 'POST' }).catch(() => {});
        }
      }
      if (paused) {
        this.send({ event: 'mute', data: { muted: this.muted } });
        if (!document.hidden) this.send({ event: 'resume' });
      }
    }
  }

  async handle(type, p) {
    const slug = this.game.slug;
    switch (type) {
      case 'init':
        return {
          player: this.playerInfo(),
          game: { slug, name: this.game.name, version: this.game.version },
          settings: { muted: this.muted },
          preview: this.preview,
          rewards: this.game.rewards || [],
        };
      case 'rtTicket': {
        if (this.preview) {
          const e = new Error('Multiplayer chưa dùng được khi xem thử — hãy thử sau khi game được duyệt');
          e.status = 'preview';
          throw e;
        }
        const r = await api(`/api/games/${slug}/realtime-ticket`);
        return {
          url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${r.path}?ticket=${encodeURIComponent(r.ticket)}`,
          mode: r.mode,
          maxPlayers: r.maxPlayers,
        };
      }
      case 'rewardStatus':
        return this.rewardStatus(String(p.placement || ''));
      case 'requestReward':
        return this.requestReward(String(p.placement || ''));
      case 'ready':
        if (this.opts.onReady) this.opts.onReady();
        return {};
      case 'gameStart':
        if (!this.preview) {
          await this.endPlay(true);
          this.playId = (await api(`/api/games/${slug}/play`, { method: 'POST' })).playId;
        }
        return {};
      case 'gameOver': {
        await this.endPlay();
        const hasScore = p.score !== undefined && p.score !== null;
        return { score: hasScore ? await this.submit(Number(p.score), p.meta) : null };
      }
      case 'submitScore':
        return this.submit(Number(p.score), p.meta);
      case 'unlockAchievement': {
        if (this.preview) {
          const fresh = !this.mock.ach[p.key];
          this.mock.ach[p.key] = 1;
          return { saved: true, newlyUnlocked: fresh, preview: true };
        }
        const user = this.opts.getUser ? this.opts.getUser() : null;
        if (!user) {
          this.hintLogin();
          return { saved: false, reason: 'login' };
        }
        try {
          const r = await api(`/api/games/${slug}/achievements/${encodeURIComponent(p.key)}`, { method: 'POST' });
          if (r.newlyUnlocked) {
            if (this.opts.onAchievement) this.opts.onAchievement(r.achievement);
            if (this.opts.onRefreshUser) this.opts.onRefreshUser();
          }
          return r;
        } catch (e) {
          return { saved: false, reason: e.status === 403 ? 'forbidden' : 'error', error: e.message };
        }
      }
      case 'save':
        if (this.preview) {
          this.mock.save = p.data;
          return { saved: true, preview: true };
        }
        if (!this.opts.getUser || !this.opts.getUser()) return { saved: false, reason: 'login' };
        try {
          return await api(`/api/games/${slug}/save`, { method: 'PUT', body: { data: p.data } });
        } catch (e) {
          return { saved: false, reason: 'error', error: e.message };
        }
      case 'load':
        if (this.preview) return { data: this.mock.save };
        if (!this.opts.getUser || !this.opts.getUser()) return { data: null };
        try {
          return await api(`/api/games/${slug}/save`);
        } catch {
          return { data: null };
        }
      case 'leaderboard':
        if (this.preview) return { entries: [], preview: true };
        return api(`/api/games/${slug}/leaderboard?period=${encodeURIComponent(p.period || 'all')}&limit=${Math.min(50, Number(p.limit) || 10)}`);
      case 'event':
        return {};
      default: {
        const e = new Error('Lệnh không hỗ trợ: ' + type);
        e.status = 400;
        throw e;
      }
    }
  }
}
