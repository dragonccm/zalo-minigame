import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import Icon from './Icon';

export default function AuthModal() {
  const { authModal, closeAuth, login, register, openLogin, openRegister } = useAuth();
  const { toastBad } = useToast();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  if (!authModal) return null;
  const isReg = authModal === 'register';

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      if (isReg) {
        await register({ username, displayName, password });
      } else {
        await login(username, password);
      }
    } catch (err) {
      toastBad(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal" onClick={e => e.target === e.currentTarget && closeAuth()}>
      <div className="modal-card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h2 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Icon name={isReg ? 'sparkles' : 'key-round'} />
            {isReg ? 'Tạo tài khoản' : 'Đăng nhập'}
          </h2>
          <button className="tk-x" onClick={closeAuth} style={{ border: 0, background: 'none', cursor: 'pointer' }}>
            <Icon name="x" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="field">
            Tên đăng nhập
            <input
              name="username"
              type="text"
              required
              minLength={3}
              maxLength={20}
              autoComplete="username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="ví dụ: gamer123"
            />
          </label>

          {isReg && (
            <label className="field">
              Tên hiển thị (tùy chọn)
              <input
                name="displayName"
                type="text"
                maxLength={24}
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Tên của bạn"
              />
            </label>
          )}

          <label className="field">
            Mật khẩu
            <input
              name="password"
              type="password"
              required
              minLength={isReg ? 8 : 1}
              autoComplete={isReg ? 'new-password' : 'current-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
          </label>

          {isReg && (
            <p className="muted small" style={{ margin: '6px 0 12px' }}>
              Mật khẩu từ 8 ký tự. Tài khoản giúp lưu điểm, thành tựu và tiến trình game của bạn.
            </p>
          )}

          <button className="btn primary" style={{ width: '100%', marginTop: '12px' }} type="submit" disabled={busy}>
            {busy ? 'Đang xử lý...' : isReg ? 'Đăng ký' : 'Đăng nhập'}
          </button>
        </form>

        <p className="center muted small" style={{ margin: '14px 0 0' }}>
          {isReg ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}{' '}
          <a
            href="#"
            onClick={e => {
              e.preventDefault();
              isReg ? openLogin() : openRegister();
            }}
          >
            {isReg ? 'Đăng nhập' : 'Đăng ký'}
          </a>
        </p>
      </div>
    </div>
  );
}
