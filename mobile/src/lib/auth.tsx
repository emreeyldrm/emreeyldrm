import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, clearToken, isNetworkError, loadToken, setToken, setUnauthorizedHandler, type User } from './api';
import { clearOffline, setUser as setOfflineUser, writeCache } from './offlineStore';

interface AuthState {
  user: User | null;
  loading: boolean;
  signIn: (token: string, user: User) => Promise<void>;
  /** Çıkış; `deleted` hesap silindiyse (cihazdaki planlar da silinir). Önbellek ve bekleyen sıra silinir (AC-OFF-5). */
  signOut: (opts?: { deleted?: boolean }) => Promise<void>;
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
        // Çevrimdışıysa son saklanan kullanıcı döner (AC-OFF-1): oturum korunur.
        const me = await api.me();
        await setOfflineUser(me);
        void writeCache('/me', me, true);
        if (alive) setUser(me);
      } catch (e) {
        // Ağ yok ve kullanıcı hiç saklanmamış: token silinmez, bağlantı gelince yeniden açılışta oturum sürer.
        if (!isNetworkError(e)) await clearToken();
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
    await setOfflineUser(u);
    await writeCache('/me', u, true);
    setUser(u);
  }, []);

  const signOut = useCallback(async (opts?: { deleted?: boolean }) => {
    await clearToken();
    await clearOffline({ plans: !!opts?.deleted });
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
