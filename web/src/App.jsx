import React, { useState, useEffect, createContext, useContext } from 'react';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Header from './components/Header';
import AuthModal from './components/AuthModal';
import HomePage from './pages/HomePage';
import GamePage from './pages/GamePage';
import ProfilePage from './pages/ProfilePage';
import UploadPage from './pages/UploadPage';
import DocsPage from './pages/DocsPage';
import AdminPage from './pages/AdminPage';

export const RouteContext = createContext({
  route: { path: '', param: '' },
  navigate: () => {},
});

export const useRoute = () => useContext(RouteContext);

function parseCurrentHash() {
  const hash = window.location.hash.slice(1) || '/';
  const parts = hash.split('?')[0].split('/'); // ['', 'game', 'slug']
  const [, a, b] = parts;
  return { path: a || '', param: b ? decodeURIComponent(b) : '' };
}

function AppContent() {
  const [route, setRoute] = useState(parseCurrentHash);
  const [searchQuery, setSearchQuery] = useState('');

  const navigate = (path, param = '') => {
    const targetHash = path
      ? param
        ? `#/${path}/${encodeURIComponent(param)}`
        : `#/${path}`
      : '#/';
    setRoute({ path, param });
    if (window.location.hash !== targetHash) {
      window.location.hash = targetHash;
    }
    window.scrollTo(0, 0);
  };

  useEffect(() => {
    const onHashChange = () => {
      setRoute(parseCurrentHash());
      window.scrollTo(0, 0);
    };

    window.addEventListener('hashchange', onHashChange);
    window.addEventListener('popstate', onHashChange);
    return () => {
      window.removeEventListener('hashchange', onHashChange);
      window.removeEventListener('popstate', onHashChange);
    };
  }, []);

  return (
    <RouteContext.Provider value={{ route, navigate }}>
      <div className="app-shell">
        <Header
          currentPath={route.path}
          searchQuery={searchQuery}
          onSearch={q => setSearchQuery(q)}
        />

        <main id="view">
          {route.path === '' && <HomePage searchQuery={searchQuery} />}
          {route.path === 'game' && route.param && <GamePage slug={route.param} />}
          {route.path === 'u' && route.param && <ProfilePage username={route.param} />}
          {route.path === 'upload' && <UploadPage />}
          {route.path === 'docs' && <DocsPage />}
          {route.path === 'admin' && <AdminPage />}
          {route.path !== '' &&
            route.path !== 'game' &&
            route.path !== 'u' &&
            route.path !== 'upload' &&
            route.path !== 'docs' &&
            route.path !== 'admin' && (
              <div className="panel center" style={{ margin: '40px auto', maxWidth: '400px' }}>
                <h2>404</h2>
                <p className="muted">Không tìm thấy trang yêu cầu.</p>
                <a className="btn" href="#/" onClick={e => { e.preventDefault(); navigate(''); }}>
                  Về trang chủ
                </a>
              </div>
            )}
        </main>

        <footer id="foot">
          GameHub · Game chạy trong sandbox an toàn ·{' '}
          <a href="#/docs" onClick={e => { e.preventDefault(); navigate('docs'); }}>
            Dành cho nhà phát triển
          </a>
        </footer>

        <AuthModal />
      </div>
    </RouteContext.Provider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ToastProvider>
  );
}
