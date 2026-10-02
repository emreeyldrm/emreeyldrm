import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { api, clearToken, getToken, setToken, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (token: string, user: User) => void;
  signOut: () => void;
}
const Ctx = createContext<AuthState>({ user: null, loading: true, signIn: () => {}, signOut: () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(!!getToken());

  useEffect(() => {
    if (!getToken()) return;
    let alive = true;
    api.me().then((u) => alive && setUser(u)).catch(() => clearToken()).finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, []);

  const signIn = useCallback((token: string, u: User) => { setToken(token); setUser(u); }, []);
  const signOut = useCallback(() => { clearToken(); setUser(null); }, []);
  return <Ctx.Provider value={{ user, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <p className="muted center" role="status">Yükleniyor…</p>;
  if (!user) return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  return <>{children}</>;
}
