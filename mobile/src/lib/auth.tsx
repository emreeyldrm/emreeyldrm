import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearToken, loadToken, setToken, setUnauthorizedHandler, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (token: string, user: User) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState>({
  user: null,
  loading: true,
  signIn: async () => undefined,
  signOut: async () => undefined,
});

export const useAuth = (): AuthState => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setUnauthorizedHandler(() => setUser(null));
    (async () => {
      const t = await loadToken();
      if (!t) {
        if (alive) setLoading(false);
        return;
      }
      try {
        const me = await api.me();
        if (alive) setUser(me);
      } catch {
        await clearToken();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      setUnauthorizedHandler(null);
    };
  }, []);

  const signIn = useCallback(async (token: string, u: User) => {
    await setToken(token);
    setUser(u);
  }, []);

  const signOut = useCallback(async () => {
    await clearToken();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
