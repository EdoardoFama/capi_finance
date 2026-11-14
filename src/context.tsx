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

// ---------- Modal de Confirmação Customizado ----------
export type ConfirmDialogOptions = {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary';
  secondaryText?: string;
};

type ConfirmChoiceResult = 'confirm' | 'secondary' | false;

type ConfirmContextType = {
  confirm: (opts: string | ConfirmDialogOptions) => Promise<boolean>;
  confirmChoice: (opts: ConfirmDialogOptions) => Promise<ConfirmChoiceResult>;
};

const ConfirmContext = createContext<ConfirmContextType>(null!);
export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  return ctx.confirm;
};
export const useConfirmChoice = () => {
  const ctx = useContext(ConfirmContext);
  return ctx.confirmChoice;
};

type ActiveConfirm = ConfirmDialogOptions & {
  resolve: (res: ConfirmChoiceResult) => void;
};

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveConfirm | null>(null);

  const confirm = useCallback((opts: string | ConfirmDialogOptions): Promise<boolean> => {
    const dialogOpts: ConfirmDialogOptions =
      typeof opts === 'string'
        ? { message: opts, variant: 'danger' }
        : { variant: 'danger', ...opts };

    return new Promise<boolean>((resolve) => {
      setActive({
        ...dialogOpts,
        resolve: (choice) => resolve(choice === 'confirm'),
      });
    });
  }, []);

  const confirmChoice = useCallback((opts: ConfirmDialogOptions): Promise<ConfirmChoiceResult> => {
    return new Promise<ConfirmChoiceResult>((resolve) => {
      setActive({
        variant: 'danger',
        ...opts,
        resolve,
      });
    });
  }, []);

  // Teclado: Escape fecha, Enter confirma
  useEffect(() => {
    if (!active) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        active.resolve(false);
        setActive(null);
      } else if (e.key === 'Enter') {
        active.resolve('confirm');
        setActive(null);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [active]);

  const handleAction = (res: ConfirmChoiceResult) => {
    if (active) {
      active.resolve(res);
      setActive(null);
    }
  };

  return (
    <ConfirmContext.Provider value={{ confirm, confirmChoice }}>
      {children}
      {active && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div
            className="relative w-full max-w-sm sm:max-w-md overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl shadow-black/80"
            role="dialog"
            aria-modal="true"
          >
            {/* Ambient glow */}
            <div
              className={`pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full blur-3xl ${
                active.variant === 'warning'
                  ? 'bg-amber-500/20'
                  : active.variant === 'primary'
                  ? 'bg-emerald-500/20'
                  : 'bg-red-500/20'
              }`}
            />

            <div className="flex items-start gap-4">
              <div
                className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${
                  active.variant === 'warning'
                    ? 'border-amber-500/30 bg-amber-500/15 text-amber-300'
                    : active.variant === 'primary'
                    ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-400'
                    : 'border-red-500/30 bg-red-500/15 text-red-400'
                }`}
              >
                {active.variant === 'warning' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
                    <path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  </svg>
                ) : active.variant === 'primary' ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
                    <path d="M4 7h16" />
                    <path d="M10 11v6M14 11v6" />
                    <path d="M6 7l1 13h10l1-13" />
                    <path d="M9 7V4h6v3" />
                  </svg>
                )}
              </div>

              <div className="min-w-0 flex-1 pt-0.5">
                <h3 className="text-base sm:text-lg font-extrabold text-white">
                  {active.title || (active.variant === 'warning' ? 'Confirmação' : active.variant === 'primary' ? 'Atenção' : 'Confirmar Exclusão')}
                </h3>
                <p className="mt-1.5 text-xs sm:text-sm text-zinc-300 whitespace-pre-line leading-relaxed">
                  {active.message}
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-col sm:flex-row-reverse items-stretch sm:items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => handleAction('confirm')}
                className={`flex items-center justify-center rounded-xl px-4 py-2.5 text-xs sm:text-sm font-bold transition shadow-lg ${
                  active.variant === 'warning'
                    ? 'bg-amber-400 text-black hover:bg-amber-300 shadow-amber-400/20 active:scale-95'
                    : active.variant === 'primary'
                    ? 'bg-emerald-400 text-black hover:bg-emerald-300 shadow-emerald-400/20 active:scale-95'
                    : 'bg-red-500 text-white hover:bg-red-400 shadow-red-500/20 active:scale-95'
                }`}
              >
                {active.confirmText || (active.variant === 'danger' ? 'Excluir' : 'Confirmar')}
              </button>

              {active.secondaryText && (
                <button
                  type="button"
                  onClick={() => handleAction('secondary')}
                  className="flex items-center justify-center rounded-xl border border-white/10 bg-zinc-900 px-4 py-2.5 text-xs sm:text-sm font-bold text-zinc-200 transition hover:bg-zinc-800 hover:border-white/20 active:scale-95"
                >
                  {active.secondaryText}
                </button>
              )}

              <button
                type="button"
                onClick={() => handleAction(false)}
                className="flex items-center justify-center rounded-xl border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-xs sm:text-sm font-medium text-zinc-400 transition hover:bg-zinc-900 hover:text-white active:scale-95"
              >
                {active.cancelText || 'Cancelar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

