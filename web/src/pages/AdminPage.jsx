import React, { useState, useEffect } from 'react';
import { api, CAT, num, dateStr } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Icon from '../components/Icon';

const TASK_TEMPLATES = [
  { type: 'tiktok_live', title: 'Xem live TikTok 30 giây', url: 'https://www.tiktok.com/@ten-kenh/live', durationSec: 30, dailyLimit: 3 },
  { type: 'tiktok_video', title: 'Xem video TikTok mới', url: 'https://www.tiktok.com/@ten-kenh', durationSec: 20, dailyLimit: 5 },
  { type: 'facebook_post', title: 'Đọc bài viết trên fanpage', url: 'https://www.facebook.com/ten-trang', durationSec: 15, dailyLimit: 3 },
  { type: 'facebook_live', title: 'Xem live Facebook', url: 'https://www.facebook.com/ten-trang/live', durationSec: 30, dailyLimit: 3 },
  { type: 'facebook_page', title: 'Theo dõi fanpage', url: 'https://www.facebook.com/ten-trang', durationSec: 10, dailyLimit: 1 },
  { type: 'youtube', title: 'Xem video YouTube', url: 'https://www.youtube.com/@ten-kenh', durationSec: 30, dailyLimit: 5 },
  { type: 'instagram', title: 'Xem bài đăng Instagram', url: 'https://www.instagram.com/ten-tai-khoan', durationSec: 10, dailyLimit: 3 },
  { type: 'zalo', title: 'Quan tâm Zalo OA', url: 'https://zalo.me/ten-oa', durationSec: 10, dailyLimit: 1 },
  { type: 'link', title: 'Ghé website của chúng tôi', url: 'https://', durationSec: 15, dailyLimit: 3 },
];

// Mỗi tab cần một năng lực; máy chủ kiểm tra lại từng thao tác.
const TABS = [
  { key: 'pending', label: 'Chờ duyệt', cap: 'review_games' },
  { key: 'done', label: 'Đã xử lý', cap: 'review_games' },
  { key: 'games', label: 'Game đã xuất bản', cap: 'manage_games' },
  { key: 'tasks', label: 'Nhiệm vụ thưởng', cap: 'manage_tasks' },
  { key: 'audit', label: 'Nhật ký thao tác', cap: 'view_audit' },
  { key: 'users', label: 'Người dùng', cap: 'view_users' },
  { key: 'roles', label: 'Vai trò & quyền', cap: 'view_users' },
];
const ROLE_LABEL = { user: 'Người chơi', moderator: 'Kiểm duyệt viên', admin: 'Quản trị viên' };
const CAP_LABEL = {
  view_dashboard: 'Xem thống kê', review_games: 'Duyệt game', manage_games: 'Quản lý game đã xuất bản',
  manage_tasks: 'Quản lý nhiệm vụ', view_users: 'Xem người dùng', ban_users: 'Khoá / mở khoá tài khoản',
  view_audit: 'Xem nhật ký', manage_roles: 'Đổi vai trò', manage_settings: 'Cài đặt hệ thống (thử nghiệm, thưởng)',
};

export default function AdminPage() {
  const { user } = useAuth();
  const { toastGood, toastBad } = useToast();
  const can = cap => !!user?.capabilities?.includes(cap);
  const visibleTabs = TABS.filter(t => can(t.cap));

  const [tab, setTab] = useState('pending');
  const [stats, setStats] = useState(null);
  const [pendingSubs, setPendingSubs] = useState([]);
  const [doneSubs, setDoneSubs] = useState([]);
  const [games, setGames] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [testMode, setTestMode] = useState(false);
  const [auditLogs, setAuditLogs] = useState([]);
  const [users, setUsers] = useState([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userQuery, setUserQuery] = useState('');
  const [userRole, setUserRole] = useState('');
  const [roleMatrix, setRoleMatrix] = useState(null);
  const [loading, setLoading] = useState(true);
  const [reviewNote, setReviewNote] = useState({});

  // Fetch admin overview stats
  const loadStats = async () => {
    try {
      const res = await api('/api/admin/stats');
      setStats(res);
    } catch (e) {
      toastBad(e.message);
    }
  };

  const loadUsers = async ({ reset, query = userQuery, role = userRole } = {}) => {
    const params = new URLSearchParams({ q: query, role, limit: '50', offset: reset ? '0' : String(users.length) });
    const res = await api(`/api/admin/users?${params}`);
    setUserTotal(res.total || 0);
    setUsers(prev => (reset ? res.users || [] : [...prev, ...(res.users || [])]));
  };

  const loadTabData = async currentTab => {
    setLoading(true);
    try {
      if (currentTab === 'pending') {
        const res = await api('/api/admin/submissions?status=pending');
        setPendingSubs(res.submissions || []);
      } else if (currentTab === 'done') {
        const [a, r] = await Promise.all([
          api('/api/admin/submissions?status=approved'),
          api('/api/admin/submissions?status=rejected'),
        ]);
        const all = [...(a.submissions || []), ...(r.submissions || [])].sort((x, y) => y.id - x.id);
        setDoneSubs(all);
      } else if (currentTab === 'games') {
        const res = await api('/api/admin/games');
        setGames(res.games || []);
      } else if (currentTab === 'tasks') {
        const [tData, cfgData] = await Promise.all([api('/api/admin/tasks'), api('/api/admin/config')]);
        setTasks(tData.tasks || []);
        setTaskTypes(tData.types || []);
        setTestMode(cfgData.testMode || false);
      } else if (currentTab === 'audit') {
        const res = await api('/api/admin/audit');
        setAuditLogs(res.logs || []);
      } else if (currentTab === 'users') {
        await loadUsers({ reset: true });
      } else if (currentTab === 'roles') {
        setRoleMatrix(await api('/api/admin/roles'));
      }
    } catch (e) {
      toastBad(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user || !visibleTabs.length) return;
    if (!visibleTabs.some(t => t.key === tab)) {
      setTab(visibleTabs[0].key);
      return;
    }
    loadStats();
    loadTabData(tab);
  }, [user, tab]);

  if (!user || !visibleTabs.length) {
    return (
      <div className="panel center" style={{ margin: '40px auto', maxWidth: '500px' }}>
        <h2>
          <Icon name="lock" /> Chỉ dành cho Quản trị viên
        </h2>
        <p className="muted">Bạn không có quyền truy cập trang quản trị này.</p>
        <a className="btn" href="#/">
          Về trang chủ
        </a>
      </div>
    );
  }

  // Handlers
  const handleReview = async (id, decision) => {
    const note = (reviewNote[id] || '').trim();
    if (decision === 'reject' && note.length < 5) {
      toastBad('Hãy ghi lý do từ chối (ít nhất 5 ký tự)');
      return;
    }
    try {
      await api(`/api/admin/submissions/${id}/review`, {
        method: 'POST',
        body: { decision, note },
      });
      toastGood(decision === 'approve' ? 'Đã duyệt & xuất bản game!' : 'Đã từ chối bản gửi.');
      loadTabData('pending');
      loadStats();
    } catch (e) {
      toastBad(e.message);
    }
  };

  const handleToggleGameStatus = async (slug, nextStatus) => {
    try {
      await api(`/api/admin/games/${slug}/status`, {
        method: 'POST',
        body: { status: nextStatus },
      });
      toastGood(nextStatus === 'live' ? 'Đã kích hoạt lại game!' : 'Đã gỡ game khỏi trang chủ.');
      loadTabData('games');
      loadStats();
    } catch (e) {
      toastBad(e.message);
    }
  };

  const handleToggleTestMode = async () => {
    try {
      const res = await api('/api/admin/config/test-mode', {
        method: 'POST',
        body: { testMode: !testMode },
      });
      setTestMode(res.testMode);
      toastGood(res.testMode ? 'Đã BẬT chế độ thử nghiệm nhiệm vụ' : 'Đã TẮT chế độ thử nghiệm');
    } catch (e) {
      toastBad(e.message);
    }
  };

  const handleToggleTask = async (id, active) => {
    try {
      await api(`/api/admin/tasks/${id}`, {
        method: 'PATCH',
        body: { active: !active },
      });
      toastGood(!active ? 'Đã bật nhiệm vụ' : 'Đã tắt nhiệm vụ');
      loadTabData('tasks');
    } catch (e) {
      toastBad(e.message);
    }
  };

  const handleSetRole = async (u, role) => {
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'POST', body: { role } });
      toastGood(`Đã đổi ${u.displayName} thành ${ROLE_LABEL[role]}`);
      loadUsers({ reset: true });
    } catch (e) {
      toastBad(e.message);
    }
  };

  const handleBan = async (u, banned) => {
    if (banned && !window.confirm(`Khoá tài khoản ${u.displayName}? Mọi phiên đăng nhập sẽ bị đăng xuất.`)) return;
    try {
      await api(`/api/admin/users/${u.id}`, { method: 'POST', body: { banned } });
      toastGood(banned ? `Đã khoá ${u.displayName}` : `Đã mở khoá ${u.displayName}`);
      loadUsers({ reset: true });
    } catch (e) {
      toastBad(e.message);
    }
  };

  // Ai được làm gì với một người dùng (khớp với quy tắc phía máy chủ)
  const canRole = u => can('manage_roles') && u.id !== user.id;
  const canBan = u => can('ban_users') && u.id !== user.id && (u.role === 'user' || user.role === 'admin');

  return (
    <div>
      <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
        <Icon name="shield" /> Quản trị GameHub
      </h1>

      {/* Overview Stats */}
      {stats && (
        <div className="stats" style={{ marginBottom: '20px' }}>
          <div className="stat">
            <b>{stats.pending}</b>
            <span>Chờ duyệt</span>
          </div>
          <div className="stat">
            <b>{stats.games}</b>
            <span>Game đang chạy</span>
          </div>
          <div className="stat">
            <b>{stats.users}</b>
            <span>Người dùng</span>
          </div>
          <div className="stat">
            <b>{num(stats.plays)}</b>
            <span>Lượt chơi</span>
          </div>
          <div className="stat">
            <b>{num(stats.matches)}</b>
            <span>Trận online</span>
          </div>
          <div className="stat">
            <b>{stats.playersOnline}</b>
            <span>Người online</span>
          </div>
          <div className="stat">
            <b>{stats.tasksToday}</b>
            <span>Nhiệm vụ xong (24h)</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="chips" style={{ marginBottom: '16px' }}>
        {visibleTabs.map(t => (
          <button key={t.key} className={`chip ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === 'users' && ` (${stats?.users ?? 0})`}
            {t.key === 'pending' && stats?.pending ? ` (${stats.pending})` : ''}
          </button>
        ))}
      </div>

      {/* Tab Panes */}
      {loading ? (
        <div className="center" style={{ padding: '40px' }}>
          <div className="spin" />
          <p className="muted">Đang nạp dữ liệu...</p>
        </div>
      ) : (
        <div>
          {/* Tab: Pending Submissions */}
          {tab === 'pending' && (
            <div className="stack">
              {pendingSubs.length === 0 ? (
                <div className="panel center muted">
                  <Icon name="party-popper" size={32} />
                  <p>Không có game nào đang chờ duyệt.</p>
                </div>
              ) : (
                pendingSubs.map(s => (
                  <div key={s.id} className="panel">
                    <div className="subcard">
                      <div className="thumb">
                        <Icon name="gamepad-2" size={48} />
                      </div>
                      <div>
                        <h3>
                          {s.manifest.name} <span className="status pending">Chờ duyệt</span>
                        </h3>
                        <p className="muted">{s.manifest.description}</p>

                        <dl className="kv">
                          <dt>Slug</dt>
                          <dd>
                            <code>{s.slug}</code>
                          </dd>
                          <dt>Phiên bản</dt>
                          <dd>{s.version}</dd>
                          <dt>Tác giả</dt>
                          <dd>
                            {s.manifest.author} (@{s.owner?.username})
                          </dd>
                          <dt>Thể loại</dt>
                          <dd>
                            {s.manifest.categories?.map(c => (
                              <span key={c} className="tag">
                                {CAT[c] || c}
                              </span>
                            ))}
                          </dd>
                          <dt>Quyền</dt>
                          <dd>{s.manifest.permissions?.join(', ') || '—'}</dd>
                          <dt>Gói</dt>
                          <dd>
                            {s.files} files · {(s.size / 1024).toFixed(0)} KB
                          </dd>
                          <dt>Gửi lúc</dt>
                          <dd>{new Date(s.createdAt).toLocaleString('vi-VN')}</dd>
                        </dl>

                        {s.report?.warnings?.length > 0 ? (
                          <div className="report warn">
                            <b>Cảnh báo tự động:</b>
                            <ul>
                              {s.report.warnings.map((w, i) => (
                                <li key={i}>{w}</li>
                              ))}
                            </ul>
                          </div>
                        ) : (
                          <div className="report ok">
                            <Icon name="circle-check" size={14} /> Không có cảnh báo tự động.
                          </div>
                        )}

                        <label className="field" style={{ marginTop: '12px' }}>
                          Ghi chú gửi nhà phát triển (bắt buộc khi từ chối)
                          <textarea
                            rows={2}
                            maxLength={500}
                            placeholder="Nhập phản hồi..."
                            value={reviewNote[s.id] || ''}
                            onChange={e =>
                              setReviewNote({ ...reviewNote, [s.id]: e.target.value })
                            }
                          />
                        </label>

                        <div className="row" style={{ marginTop: '12px' }}>
                          <button
                            className="btn good"
                            onClick={() => handleReview(s.id, 'approve')}
                          >
                            <Icon name="circle-check" /> Duyệt & xuất bản
                          </button>
                          <button
                            className="btn bad"
                            onClick={() => handleReview(s.id, 'reject')}
                          >
                            <Icon name="x" /> Từ chối
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab: Done Submissions */}
          {tab === 'done' && (
            <div className="panel">
              {doneSubs.length === 0 ? (
                <p className="muted">Chưa có lịch sử duyệt nào.</p>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Game</th>
                      <th>Phiên bản</th>
                      <th>Tác giả</th>
                      <th>Kết quả</th>
                      <th>Ghi chú</th>
                      <th>Ngày</th>
                    </tr>
                  </thead>
                  <tbody>
                    {doneSubs.map(s => (
                      <tr key={s.id}>
                        <td>{s.manifest.name}</td>
                        <td>{s.version}</td>
                        <td>@{s.owner?.username}</td>
                        <td>
                          <span className={`status ${s.status}`}>
                            {s.status === 'approved' ? 'Đã duyệt' : 'Từ chối'}
                          </span>
                        </td>
                        <td>{s.note || '—'}</td>
                        <td>{s.reviewedAt ? dateStr(s.reviewedAt) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {/* Tab: Games Management */}
          {tab === 'games' && (
            <div className="panel">
              <table>
                <thead>
                  <tr>
                    <th>Game</th>
                    <th>Tác giả</th>
                    <th>Phiên bản</th>
                    <th>Lượt chơi</th>
                    <th>Trạng thái</th>
                    <th>Hành động</th>
                  </tr>
                </thead>
                <tbody>
                  {games.map(g => (
                    <tr key={g.slug}>
                      <td>
                        <a href={`#/game/${encodeURIComponent(g.slug)}`}>{g.name}</a>{' '}
                        {g.builtin && <span className="tag">có sẵn</span>}
                      </td>
                      <td>{g.author}</td>
                      <td>{g.version}</td>
                      <td>{num(g.plays)}</td>
                      <td>
                        <span className={`status ${g.status}`}>
                          {g.status === 'live' ? 'Đang chạy' : 'Đã gỡ'}
                        </span>
                      </td>
                      <td>
                        <button
                          className={`btn sm ${g.status === 'live' ? 'bad' : 'good'}`}
                          onClick={() =>
                            handleToggleGameStatus(
                              g.slug,
                              g.status === 'live' ? 'unpublished' : 'live'
                            )
                          }
                        >
                          {g.status === 'live' ? 'Gỡ game' : 'Đăng lại'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab: Tasks Management */}
          {tab === 'tasks' && (
            <div className="stack">
              <div
                className="panel row"
                style={{ alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div>
                  <h3 style={{ margin: 0 }}>Chế độ thử nghiệm nhiệm vụ</h3>
                  <p className="muted small" style={{ margin: '4px 0 0' }}>
                    Bỏ cooldown và mọi giới hạn lượt, mỗi nhiệm vụ chỉ chờ tối đa 5 giây (tiện cho kiểm thử).
                  </p>
                </div>
                <button
                  className={`btn ${testMode ? 'bad' : 'good'}`}
                  onClick={handleToggleTestMode}
                  disabled={!can('manage_settings')}
                >
                  {testMode ? 'Đang BẬT — Bấm để tắt' : 'Đang TẮT — Bấm để bật'}
                </button>
              </div>

              <div className="panel">
                <h3>Danh sách nhiệm vụ thưởng</h3>
                <table>
                  <thead>
                    <tr>
                      <th>Tiêu đề</th>
                      <th>Loại</th>
                      <th>Thời gian</th>
                      <th>Giới hạn/ngày</th>
                      <th>Trạng thái</th>
                      <th>Hành động</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map(t => (
                      <tr key={t.id}>
                        <td>
                          <b>{t.title}</b>
                        </td>
                        <td>{t.typeLabel || t.type}</td>
                        <td>{t.durationSec}s</td>
                        <td>{t.dailyLimit || 'Không'}</td>
                        <td>
                          <span className={`status ${t.active ? 'approved' : 'rejected'}`}>
                            {t.active ? 'Đang bật' : 'Đang tắt'}
                          </span>
                        </td>
                        <td>
                          <button
                            className="btn sm"
                            onClick={() => handleToggleTask(t.id, t.active)}
                          >
                            {t.active ? 'Tắt' : 'Bật'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Tab: Audit Logs */}
          {tab === 'audit' && (
            <div className="panel">
              <table>
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Quản trị viên</th>
                    <th>Hành động</th>
                    <th>Mục tiêu</th>
                    <th>Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLogs.map(l => (
                    <tr key={l.id}>
                      <td className="small muted">{new Date(l.createdAt).toLocaleString('vi-VN')}</td>
                      <td>@{l.adminUsername}</td>
                      <td>
                        <b>{l.action}</b>
                      </td>
                      <td>{l.target}</td>
                      <td className="small">{JSON.stringify(l.details || {})}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Tab: Users */}
          {tab === 'users' && (
            <div className="panel">
              <form
                className="row"
                style={{ gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}
                onSubmit={e => {
                  e.preventDefault();
                  loadUsers({ reset: true });
                }}
              >
                <input
                  type="text"
                  placeholder="Tìm theo tên đăng nhập hoặc tên hiển thị"
                  value={userQuery}
                  onChange={e => setUserQuery(e.target.value)}
                  style={{ flex: '1 1 240px' }}
                />
                <select
                  value={userRole}
                  onChange={e => {
                    setUserRole(e.target.value);
                    loadUsers({ reset: true, role: e.target.value });
                  }}
                  style={{ width: 'auto' }}
                >
                  <option value="">Tất cả vai trò</option>
                  {Object.keys(ROLE_LABEL).map(r => (
                    <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                  ))}
                </select>
                <button className="btn" type="submit">Tìm</button>
              </form>
              <p className="muted small">{userTotal} người dùng</p>
              <table>
                <thead>
                  <tr>
                    <th>Tên hiển thị</th>
                    <th>Username</th>
                    <th>Vai trò</th>
                    <th>Trạng thái</th>
                    <th>Cấp độ / XP</th>
                    <th>Ngày tham gia</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => (
                    <tr key={u.id}>
                      <td>
                        <a href={`#/u/${encodeURIComponent(u.username)}`}>{u.displayName}</a>
                        {u.id === user.id && <span className="muted small"> (bạn)</span>}
                      </td>
                      <td>@{u.username}</td>
                      <td>
                        {canRole(u) ? (
                          <select
                            value={u.role}
                            onChange={e => handleSetRole(u, e.target.value)}
                            style={{ width: 'auto', padding: '4px 8px' }}
                          >
                            {Object.keys(ROLE_LABEL).map(r => (
                              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                            ))}
                          </select>
                        ) : (
                          <span className={`status ${u.role === 'admin' ? 'approved' : ''}`}>{ROLE_LABEL[u.role] || u.role}</span>
                        )}
                      </td>
                      <td>{u.banned ? <span className="status rejected">Đã khoá</span> : <span className="muted small">Hoạt động</span>}</td>
                      <td>Lv {u.level} · {num(u.xp)} XP</td>
                      <td>{dateStr(u.createdAt)}</td>
                      <td>
                        {canBan(u) && (
                          <button className={`btn sm ${u.banned ? 'good' : 'bad'}`} onClick={() => handleBan(u, !u.banned)}>
                            {u.banned ? 'Mở khoá' : 'Khoá'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length < userTotal && (
                <div className="center" style={{ marginTop: '12px' }}>
                  <button className="btn" onClick={() => loadUsers({ reset: false })}>Tải thêm</button>
                </div>
              )}
            </div>
          )}

          {tab === 'roles' && roleMatrix && (
            <div className="panel">
              <h3 style={{ marginTop: 0 }}>Quyền theo vai trò</h3>
              <p className="muted small">
                Đây là ma trận quyền hiện hành. Muốn đổi quyền của một vai trò, sửa <code>server/permissions.js</code> và khởi động lại máy chủ.
                Vai trò của từng người được đổi ở tab Người dùng.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Năng lực</th>
                    {roleMatrix.roles.map(r => (
                      <th key={r.role} style={{ textAlign: 'center' }}>{ROLE_LABEL[r.role]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {roleMatrix.capabilities.map(cap => (
                    <tr key={cap}>
                      <td>{CAP_LABEL[cap] || cap}</td>
                      {roleMatrix.roles.map(r => (
                        <td key={r.role} style={{ textAlign: 'center' }}>
                          {r.capabilities.includes(cap) ? <Icon name="check" /> : <span className="muted">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
