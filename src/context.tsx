import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type User } from './api';
import { currentMonth } from './format';

// ---------- Auth ----------
type AuthCtx = { user: User | null; setUser: (u: User | null) => void; logout: () => Promise<void> };
const AuthContext = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<User>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    const onUnauthorized = () => setUser(null);
    window.addEventListener('capi:unauthorized', onUnauthorized);
    return () => window.removeEventListener('capi:unauthorized', onUnauthorized);
  }, []);

  const logout = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-400" />
      </div>
    );
  }
  return <AuthContext.Provider value={{ user, setUser, logout }}>{children}</AuthContext.Provider>;
}

// ---------- Mês selecionado (compartilhado entre telas) ----------
type MonthCtx = { month: string; setMonth: (m: string) => void };
const MonthContext = createContext<MonthCtx>(null!);
export const useMonth = () => useContext(MonthContext);

export function MonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState(currentMonth);
  return <MonthContext.Provider value={{ month, setMonth }}>{children}</MonthContext.Provider>;
}

// ---------- Toast ----------
type Toast = { id: number; message: string; kind: 'ok' | 'error' };
type ToastCtx = (message: string, kind?: Toast['kind']) => void;
const ToastContext = createContext<ToastCtx>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback<ToastCtx>((message, kind = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl border px-4 py-2.5 text-sm font-medium shadow-lg backdrop-blur ${
              t.kind === 'ok'
                ? 'border-emerald-500/30 bg-emerald-950/90 text-emerald-200'
                : 'border-red-500/30 bg-red-950/90 text-red-200'
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

