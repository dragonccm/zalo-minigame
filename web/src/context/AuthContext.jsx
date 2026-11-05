import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import { useToast } from './ToastContext';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [authModal, setAuthModal] = useState(null); // 'login' | 'register' | null
  const { toastGood, toastBad } = useToast();

  const refreshUser = useCallback(async () => {
    try {
      const res = await api('/api/me');
      setUser(res.user);
      return res.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = async (username, password) => {
    const res = await api('/api/auth/login', { method: 'POST', body: { username, password } });
    setUser(res.user);
    setAuthModal(null);
    toastGood(`Xin chào <b>${res.user.displayName}</b>!`);
    return res.user;
  };

  const register = async ({ username, password, displayName, avatar }) => {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: { username, password, displayName, avatar },
    });
    setUser(res.user);
    setAuthModal(null);
    toastGood(`Tài khoản đã tạo thành công! Xin chào <b>${res.user.displayName}</b>!`);
    return res.user;
  };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    toastGood('Đã đăng xuất');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        authModal,
        openLogin: () => setAuthModal('login'),
        openRegister: () => setAuthModal('register'),
        closeAuth: () => setAuthModal(null),
        login,
        register,
        logout,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
