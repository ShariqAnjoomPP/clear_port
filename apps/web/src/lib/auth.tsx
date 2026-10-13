import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { can, type Permission, type Role } from '@clearport/kernel';
import { api, onSessionChange, refreshSession, setSession, type SessionUser } from './api';
import { setLanguage } from './i18n';

type AuthState = {
  user: SessionUser | null;
  ready: boolean;
  login: (email: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
  has: (r: Role) => boolean;
  home: string;
};

const Ctx = createContext<AuthState | null>(null);

/** Where each role lands after login: field staff → mobile task list, customers → portal, everyone else → board. */
export function homeFor(user: SessionUser | null): string {
  if (!user) return '/login';
  const roles = user.roles as Role[];
  if (roles.includes('CUSTOMER')) return '/portal';
  const office = roles.some((r) => ['OWNER', 'ADMIN', 'COORDINATOR', 'ACCOUNTS'].includes(r));
  return office ? (roles.includes('ACCOUNTS') && roles.length === 1 ? '/finance' : roles.includes('ADMIN') && roles.length === 1 ? '/settings' : '/board') : '/field';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const off = onSessionChange((u) => setUser(u));
    refreshSession().finally(() => setReady(true));
    return () => {
      off();
    };
  }, []);

  useEffect(() => {
    if (user?.locale) setLanguage(localStorage.getItem('cp.lang') ?? user.locale);
  }, [user?.locale]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      ready,
      home: homeFor(user),
      async login(email: string) {
        const d = await api.post<{ accessToken: string; user: SessionUser }>('/auth/dev-login', { email });
        setSession(d.accessToken, d.user);
        return d.user;
      },
      async logout() {
        await api.post('/auth/logout').catch(() => undefined);
        setSession(null, null);
      },
      can: (p) => !!user && can(user.roles as Role[], p),
      has: (r) => !!user?.roles.includes(r),
    }),
    [user, ready],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
