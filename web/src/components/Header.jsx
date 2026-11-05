import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useRoute } from '../App';
import Icon from './Icon';

export default function Header({ currentPath, onSearch, searchQuery }) {
  const { user, openLogin, openRegister, logout } = useAuth();
  const { navigate } = useRoute();
  const [val, setVal] = useState(searchQuery || '');

  const handleSearchSubmit = e => {
    e.preventDefault();
    if (onSearch) onSearch(val.trim());
    navigate('');
  };

  const navKey = currentPath === '' || currentPath.startsWith('game') || currentPath.startsWith('u') ? 'home' : currentPath;

  const handleNav = (path, param = '') => e => {
    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      navigate(path, param);
    }
  };

  return (
    <header id="top">
      <a className="logo" href="#/" onClick={handleNav('')}>
        <span className="logo-mark">
          <Icon name="gamepad-2" />
        </span>{' '}
        Game<b>Hub</b>
      </a>

      <nav id="nav">
        <a href="#/" className={navKey === 'home' ? 'active' : ''} onClick={handleNav('')}>
          <Icon name="gamepad-2" /> Game
        </a>
        <a href="#/upload" className={navKey === 'upload' ? 'active' : ''} onClick={handleNav('upload')}>
          <Icon name="upload-cloud" /> Đăng game
        </a>
        <a href="#/docs" className={navKey === 'docs' ? 'active' : ''} onClick={handleNav('docs')}>
          <Icon name="file-text" /> Tài liệu
        </a>
        {user?.capabilities?.length > 0 && (
          <a href="#/admin" className={navKey === 'admin' ? 'active' : ''} onClick={handleNav('admin')}>
            <Icon name="shield" /> Quản trị
          </a>
        )}
      </nav>

      <form id="searchForm" role="search" onSubmit={handleSearchSubmit}>
        <input
          id="searchInput"
          type="search"
          placeholder="Tìm game..."
          autoComplete="off"
          value={val}
          onChange={e => {
            setVal(e.target.value);
            if (onSearch) onSearch(e.target.value.trim());
          }}
        />
      </form>

      <div id="userbox">
        {user ? (
          <>
            <a
              className="userchip"
              href={`#/u/${encodeURIComponent(user.username)}`}
              onClick={handleNav('u', user.username)}
            >
              <span className="avatar">
                <Icon name={user.avatar || 'smile'} />
              </span>
              <span>{user.displayName}</span>
              <span className="lvl">Lv {user.level || 1}</span>
            </a>
            <button className="btn sm" onClick={logout}>
              Thoát
            </button>
          </>
        ) : (
          <div style={{ display: 'flex', gap: '6px' }}>
            <button className="btn sm primary" onClick={openLogin}>
              Đăng nhập
            </button>
            <button className="btn sm" onClick={openRegister}>
              Đăng ký
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
