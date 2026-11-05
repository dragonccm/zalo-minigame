import React, { useState, useEffect } from 'react';
import { api, AVATARS, dateStr, dur, num, MATCH_END } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Icon from '../components/Icon';

export default function ProfilePage({ username }) {
  const { user: currentUser, refreshUser } = useAuth();
  const { toastGood, toastBad } = useToast();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Edit fields
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('smile');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    api(`/api/users/${encodeURIComponent(username)}`)
      .then(res => {
        if (!mounted) return;
        setData(res);
        setDisplayName(res.user.displayName || '');
        setBio(res.user.bio || '');
        setAvatar(res.user.avatar || 'smile');
        document.title = `${res.user.displayName} — GameHub`;
      })
      .catch(err => {
        if (mounted) toastBad(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [username, toastBad]);

  const isOwn = currentUser && currentUser.username === username;

  const handleSaveProfile = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await api('/api/me', {
        method: 'PATCH',
        body: { displayName, bio, avatar },
      });
      setData(prev => ({ ...prev, user: res.user }));
      await refreshUser();
      setShowEdit(false);
      toastGood('Đã cập nhật hồ sơ!');
    } catch (err) {
      toastBad(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async e => {
    e.preventDefault();
    setSaving(true);
    try {
      await api('/api/me/password', {
        method: 'POST',
        body: { oldPassword, newPassword },
      });
      setShowPassword(false);
      setOldPassword('');
      setNewPassword('');
      toastGood('Đã đổi mật khẩu thành công!');
    } catch (err) {
      toastBad(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !data) {
    return (
      <div className="center" style={{ padding: '60px' }}>
        <div className="spin" />
        <p className="muted">Đang tải hồ sơ...</p>
      </div>
    );
  }

  const u = data.user;
  const lo = 20 * (u.level - 1) ** 2;
  const hi = 20 * u.level ** 2;
  const pct = Math.min(100, Math.round(((u.xp - lo) / (hi - lo)) * 100));

  return (
    <div>
      {/* Profile Header */}
      <div className="panel phead">
        <span className="avatar big">
          <Icon name={u.avatar || 'smile'} />
        </span>
        <div style={{ flex: 1, minWidth: '240px' }}>
          <h1 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            {u.displayName}
            {u.role === 'admin' && (
              <span className="tag">
                <Icon name="shield" size={12} /> Admin
              </span>
            )}
          </h1>
          <div className="muted">
            @{u.username} · tham gia {dateStr(u.createdAt)}
          </div>
          <p style={{ margin: '8px 0' }}>{u.bio || <span className="muted">Chưa có giới thiệu.</span>}</p>
          <div className="row small" style={{ alignItems: 'center' }}>
            <span className="lvl">Lv {u.level}</span>
            <div className="bar" style={{ flex: 1, minWidth: '140px', margin: '0 8px' }}>
              <i style={{ width: `${pct}%` }} />
            </div>
            <span className="muted">
              {num(u.xp)} / {num(hi)} XP
            </span>
          </div>
        </div>
        {isOwn && (
          <button className="btn" onClick={() => setShowEdit(true)}>
            <Icon name="pencil" /> Chỉnh sửa hồ sơ
          </button>
        )}
      </div>

      {/* Stats Cards */}
      <div className="stats" style={{ margin: '16px 0' }}>
        <div className="stat">
          <b>{num(data.stats.plays)}</b>
          <span>Lượt chơi</span>
        </div>
        <div className="stat">
          <b>{dur(data.stats.playSeconds)}</b>
          <span>Thời gian chơi</span>
        </div>
        <div className="stat">
          <b>{data.stats.gamesPlayed}</b>
          <span>Game đã chơi</span>
        </div>
        <div className="stat">
          <b>{data.stats.achievements}</b>
          <span>Thành tựu</span>
        </div>
        <div className="stat">
          <b>{num(data.stats.achievementPoints)}</b>
          <span>Điểm thành tựu</span>
        </div>
        <div className="stat">
          <b>{num(data.stats.matches)}</b>
          <span>Trận online</span>
        </div>
        <div className="stat">
          <b>{num(data.stats.kills)}</b>
          <span>Đối thủ đã nuốt</span>
        </div>
        <div className="stat">
          <b>{data.stats.bestRoomRank ? '#' + data.stats.bestRoomRank : '—'}</b>
          <span>Hạng phòng cao nhất</span>
        </div>
      </div>

      {/* Main Grid: Left scores & matches, Right recent games */}
      <div className="grid2">
        <div className="stack">
          {/* Best Scores */}
          <div className="panel">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="medal" /> Điểm cao nhất
            </h3>
            {data.bestScores.length > 0 ? (
              <table>
                <thead>
                  <tr>
                    <th>Game</th>
                    <th>Điểm cao nhất</th>
                    <th>Hạng</th>
                    <th>Lượt</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bestScores.map(s => (
                    <tr key={s.game.slug}>
                      <td>
                        <a href={`#/game/${encodeURIComponent(s.game.slug)}`}>{s.game.name}</a>
                      </td>
                      <td>
                        <b>{num(s.best)}</b> <span className="muted small">{s.label}</span>
                      </td>
                      <td>#{s.rank}</td>
                      <td>{s.runs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="muted">Chưa có điểm nào.</p>
            )}
          </div>

          {/* Recent Online Matches */}
          {data.matches.length > 0 && (
            <div className="panel">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="globe" /> Trận online gần đây
              </h3>
              <table>
                <thead>
                  <tr>
                    <th>Game</th>
                    <th>Điểm</th>
                    <th>Hạng</th>
                    <th>Nuốt</th>
                    <th>Thời gian</th>
                    <th>Kết thúc</th>
                  </tr>
                </thead>
                <tbody>
                  {data.matches.map(m => (
                    <tr key={m.id || m.endedAt}>
                      <td>
                        <a href={`#/game/${encodeURIComponent(m.game.slug)}`}>{m.game.name}</a>
                        <div className="small muted">{new Date(m.endedAt).toLocaleString('vi-VN')}</div>
                      </td>
                      <td>
                        <b>{num(m.score)}</b>
                      </td>
                      <td>{m.rank ? '#' + m.rank : '—'}</td>
                      <td>{m.kills}</td>
                      <td>{dur(m.seconds)}</td>
                      <td className="small">
                        {m.reason === 'death'
                          ? m.killedBy
                            ? `bị ${m.killedBy} nuốt`
                            : 'đâm vào khối lớn'
                          : MATCH_END[m.reason] || m.reason}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Achievements */}
          <div className="panel">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="award" /> Thành tựu ({data.achievements.length})
            </h3>
            <div className="agrid">
              {data.achievements.length > 0 ? (
                data.achievements.map((a, i) => (
                  <div key={i} className="ach">
                    <div className="ic">
                      <Icon name={a.icon || 'trophy'} />
                    </div>
                    <div>
                      <div className="t">{a.name}</div>
                      <div className="d">
                        {a.game.name} · {dateStr(a.unlockedAt)}
                      </div>
                    </div>
                    <div className="pt">+{a.points}</div>
                  </div>
                ))
              ) : (
                <p className="muted">Chưa mở khóa thành tựu nào.</p>
              )}
            </div>
          </div>
        </div>

        {/* Right column */}
        <aside className="stack">
          {/* Recently Played */}
          <div className="panel">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Icon name="joystick" /> Chơi gần đây
            </h3>
            {data.recent.length > 0 ? (
              data.recent.map(g => (
                <a key={g.slug} className="ach" href={`#/game/${encodeURIComponent(g.slug)}`} style={{ color: 'inherit' }}>
                  <div className="ic">
                    {g.thumbnail ? (
                      <img src={g.thumbnail} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '12px' }} />
                    ) : (
                      <Icon name="gamepad-2" />
                    )}
                  </div>
                  <div>
                    <div className="t">{g.name}</div>
                    <div className="d">
                      {g.plays} lượt · {dateStr(g.lastPlayed)}
                    </div>
                  </div>
                </a>
              ))
            ) : (
              <p className="muted">Chưa chơi game nào.</p>
            )}
          </div>

          {/* Developed games */}
          {data.developed?.length > 0 && (
            <div className="panel">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="wrench" /> Game đã phát hành
              </h3>
              {data.developed.map(g => (
                <a key={g.slug} className="ach" href={`#/game/${encodeURIComponent(g.slug)}`} style={{ color: 'inherit' }}>
                  <div className="ic">
                    <Icon name="gamepad-2" />
                  </div>
                  <div>
                    <div className="t">{g.name}</div>
                    <div className="d">{num(g.plays)} lượt chơi</div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* Edit Profile Modal */}
      {showEdit && (
        <div className="modal" onClick={e => e.target === e.currentTarget && setShowEdit(false)}>
          <div className="modal-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="pencil" /> Chỉnh sửa hồ sơ
              </h2>
              <button className="tk-x" onClick={() => setShowEdit(false)} style={{ border: 0, background: 'none' }}>
                <Icon name="x" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile}>
              <label className="field">
                Tên hiển thị
                <input
                  type="text"
                  maxLength={24}
                  required
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                />
              </label>

              <div className="muted small" style={{ fontWeight: 600, marginTop: '8px' }}>
                Avatar
              </div>
              <div className="emoji-pick">
                {AVATARS.map(avName => (
                  <button
                    key={avName}
                    type="button"
                    className={avName === avatar ? 'on' : ''}
                    onClick={() => setAvatar(avName)}
                    title={avName}
                  >
                    <Icon name={avName} />
                  </button>
                ))}
              </div>

              <label className="field">
                Giới thiệu
                <textarea
                  rows={3}
                  maxLength={200}
                  value={bio}
                  onChange={e => setBio(e.target.value)}
                  placeholder="Vài dòng về bạn..."
                />
              </label>

              <div className="row" style={{ marginTop: '14px' }}>
                <button className="btn primary" type="submit" disabled={saving}>
                  {saving ? 'Đang lưu...' : 'Lưu'}
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setShowEdit(false);
                    setShowPassword(true);
                  }}
                >
                  Đổi mật khẩu
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {showPassword && (
        <div className="modal" onClick={e => e.target === e.currentTarget && setShowPassword(false)}>
          <div className="modal-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Icon name="lock" /> Đổi mật khẩu
              </h2>
              <button className="tk-x" onClick={() => setShowPassword(false)} style={{ border: 0, background: 'none' }}>
                <Icon name="x" />
              </button>
            </div>

            <form onSubmit={handleChangePassword}>
              <label className="field">
                Mật khẩu cũ
                <input
                  type="password"
                  required
                  value={oldPassword}
                  onChange={e => setOldPassword(e.target.value)}
                />
              </label>
              <label className="field">
                Mật khẩu mới (từ 8 ký tự)
                <input
                  type="password"
                  required
                  minLength={8}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                />
              </label>

              <button className="btn primary" type="submit" style={{ marginTop: '12px', width: '100%' }} disabled={saving}>
                {saving ? 'Đang xử lý...' : 'Xác nhận đổi mật khẩu'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
