import { useEffect, useState } from 'react';
import { NavLink, Outlet, Link, useLocation } from 'react-router';
import { useAuth, useConfirm, usePrivacy, useToast, useViewMode } from '../context';
import {
  IconCalendar,
  IconCreditCard,
  IconEye,
  IconEyeOff,
  IconHome,
  IconList,
  IconLogout,
  IconPlus,
  IconTrendingUp,
  IconWallet,
} from './ui';
import InstallPwaModal, { usePwaInstall } from './InstallPwaModal';
import AutomationModal from './AutomationModal';
import { getReminders, playSuccessSound, syncOfflineExpenses, updateUserPin } from '../api';
import { scheduleRemindersNotifications } from '../notifications';

const NAV = [
  { to: '/', label: 'Início', icon: IconHome, end: true },
  { to: '/orcamento', label: 'Orçamento', icon: IconWallet, end: false },
  { to: '/calendario', label: 'Calendário', icon: IconCalendar, end: false },
  { to: '/lancar', label: 'Lançar', icon: IconPlus, end: false },
  { to: '/cartao', label: 'Cartão', icon: IconCreditCard, end: false },
  { to: '/extrato', label: 'Extrato', icon: IconList, end: false },
  { to: '/investimentos', label: 'Investir', icon: IconTrendingUp, end: false },
];

const ACCENT_THEMES = [
  { id: 'emerald', label: 'Esmeralda Capi', color: '#10b981' },
  { id: 'purple', label: 'Roxo Nubank', color: '#8b5cf6' },
  { id: 'ocean', label: 'Azul Oceano', color: '#06b6d4' },
  { id: 'gold', label: 'Ouro Imperial', color: '#f59e0b' },
  { id: 'rose', label: 'Rosa Neon', color: '#f43f5e' },
];

export default function Layout() {
  const { user, setUser, logout } = useAuth();
  const confirm = useConfirm();
  const toast = useToast();
  const location = useLocation();
  const { isPrivate, togglePrivacy } = usePrivacy();
  const { isSimple, setViewMode } = useViewMode();
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showAutomationModal, setShowAutomationModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const { deferredPrompt, isStandalone, isIos } = usePwaInstall();
  const initial = (user?.username?.[0] ?? 'U').toUpperCase();

  // Item 81 & 80: Bloqueio por PIN ('1201') e Biometria
  const userPin = user?.pin_code || '1201';
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem('capi:is_locked') === '1';
    } catch {
      return false;
    }
  });
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [autoLockEnabled, setAutoLockEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('capi:auto_lock') !== '0';
    } catch {
      return true;
    }
  });
  const [newPinField, setNewPinField] = useState(userPin);

  // Item 77, 95, 96, 99: Preferências de Tema, OLED, Sons e Lembrete Noturno
  const [oledMode, setOledMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem('capi:oled') === '1';
    } catch {
      return false;
    }
  });
  const [accentTheme, setAccentTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('capi:accent') || 'emerald';
    } catch {
      return 'emerald';
    }
  });
  const [soundMuted, setSoundMuted] = useState<boolean>(() => {
    try {
      return localStorage.getItem('capi:sound_muted') === '1';
    } catch {
      return false;
    }
  });
  const [eveningRem, setEveningRem] = useState<boolean>(() => {
    try {
      return localStorage.getItem('capi:evening_reminder') !== '0';
    } catch {
      return true;
    }
  });
  const [dismissFailedLoginBanner, setDismissFailedLoginBanner] = useState(false);

  // Aplica classes de OLED e Cor de Destaque no HTML
  useEffect(() => {
    try {
      document.documentElement.classList.toggle('oled-mode', oledMode);
      localStorage.setItem('capi:oled', oledMode ? '1' : '0');
    } catch {}
  }, [oledMode]);

  useEffect(() => {
    try {
      if (accentTheme === 'emerald') {
        document.documentElement.removeAttribute('data-accent');
      } else {
        document.documentElement.setAttribute('data-accent', accentTheme);
      }
      localStorage.setItem('capi:accent', accentTheme);
    } catch {}
  }, [accentTheme]);

  // Item 73: Sincroniza fila offline ao voltar a ficar online
  useEffect(() => {
    const runSync = () => {
      syncOfflineExpenses().then((count) => {
        if (count > 0) {
          playSuccessSound('coin');
          toast(`🌐 Conexão restaurada! ${count} lançamento(s) offline sincronizado(s).`);
        }
      });
    };
    runSync();
    window.addEventListener('online', runSync);
    return () => window.removeEventListener('online', runSync);
  }, [toast]);

  // Item 81: Auto-bloqueio por inatividade (3 minutos)
  useEffect(() => {
    if (!autoLockEnabled || isLocked) return;
    let timer: number;
    const resetTimer = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setIsLocked(true);
        try {
          sessionStorage.setItem('capi:is_locked', '1');
        } catch {}
      }, 3 * 60 * 1000);
    };
    resetTimer();
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    events.forEach((ev) => window.addEventListener(ev, resetTimer, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((ev) => window.removeEventListener(ev, resetTimer));
    };
  }, [autoLockEnabled, isLocked]);

  // Agenda lembretes do dia para disparar notificações pontualmente
  useEffect(() => {
    if (!user) return;
    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    getReminders(month)
      .then((reminders) => scheduleRemindersNotifications(reminders))
      .catch(() => {});
  }, [user]);

  function handleLockNow() {
    setPinInput('');
    setPinError(false);
    setIsLocked(true);
    try {
      sessionStorage.setItem('capi:is_locked', '1');
    } catch {}
  }

  function handlePinDigit(digit: string) {
    if (pinInput.length >= 8) return;
    const next = pinInput + digit;
    setPinInput(next);
    setPinError(false);

    if (next === userPin) {
      playSuccessSound('unlock');
      setIsLocked(false);
      setPinInput('');
      try {
        sessionStorage.removeItem('capi:is_locked');
      } catch {}
    } else if (next.length >= userPin.length) {
      setPinError(true);
      setTimeout(() => setPinInput(''), 450);
    }
  }

  // Item 80: Desbloqueio Biométrico (WebAuthn / Passkey / Biometria do Dispositivo)
  async function handleBiometricUnlock() {
    if (!window.PublicKeyCredential) {
      toast('Biometria não suportada neste navegador. Use o PIN.', 'error');
      return;
    }
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const credIdRaw = localStorage.getItem('capi:biometric_cred_id');
      if (!credIdRaw) {
        // Registra credencial biométrica local do aparelho na primeira vez
        const created = (await navigator.credentials.create({
          publicKey: {
            challenge,
            rp: { name: 'Capi Finance' },
            user: {
              id: new TextEncoder().encode(String(user?.id || 1)),
              name: user?.username || 'user',
              displayName: user?.username || 'Usuário',
            },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
            authenticatorSelection: {
              authenticatorAttachment: 'platform',
              userVerification: 'required',
            },
            timeout: 30000,
          },
        })) as PublicKeyCredential | null;

        if (created) {
          const b64 = btoa(String.fromCharCode(...new Uint8Array(created.rawId)));
          localStorage.setItem('capi:biometric_cred_id', b64);
          playSuccessSound('unlock');
          setIsLocked(false);
          sessionStorage.removeItem('capi:is_locked');
          toast('Biometria vinculada e desbloqueada com sucesso! 🔓');
        }
      } else {
        const rawId = Uint8Array.from(atob(credIdRaw), (c) => c.charCodeAt(0));
        const assertion = await navigator.credentials.get({
          publicKey: {
            challenge,
            allowCredentials: [{ id: rawId, type: 'public-key' }],
            userVerification: 'required',
            timeout: 30000,
          },
        });
        if (assertion) {
          playSuccessSound('unlock');
          setIsLocked(false);
          sessionStorage.removeItem('capi:is_locked');
        }
      }
    } catch {
      toast('Autenticação biométrica cancelada. Digite seu PIN.', 'error');
    }
  }

  async function handleSavePin() {
    if (!/^\d{4,8}$/.test(newPinField)) {
      toast('O PIN deve ter de 4 a 8 números', 'error');
      return;
    }
    try {
      await updateUserPin(newPinField);
      if (user) setUser({ ...user, pin_code: newPinField });
      toast(`PIN de segurança atualizado para ${newPinField}! 🔒`);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function handleLogout() {
    const ok = await confirm({
      title: 'Sair da Conta?',
      message: 'Deseja realmente encerrar sua sessão no Capi Finance?',
      confirmText: 'Sair da Conta',
      cancelText: 'Permanecer Conectado',
      variant: 'warning',
    });
    if (ok) logout();
  }

  return (
    <div className="min-h-dvh flex flex-col w-full max-w-full overflow-x-hidden">
      {/* TELA DE BLOQUEIO POR PIN & BIOMETRIA (Itens 80 e 81) */}
      {isLocked && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#050508]/98 p-6 backdrop-blur-2xl select-none">
          <div className="w-full max-w-xs text-center space-y-6">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl border border-emerald-500/40 bg-emerald-500/15 shadow-lg shadow-emerald-500/20">
              <img src="/logo.png" alt="Capi" className="h-11 w-11 object-contain" />
            </div>

            <div>
              <h2 className="text-lg font-black text-white">Capi Finance Protegido</h2>
              <p className="text-xs text-zinc-400 mt-1">
                Olá, <strong className="text-emerald-300">{user?.username}</strong>. Digite seu PIN para desbloquear.
              </p>
            </div>

            {/* Indicadores de dígitos */}
            <div className="flex justify-center gap-3 py-2">
              {Array.from({ length: userPin.length }).map((_, i) => (
                <div
                  key={i}
                  className={`h-3.5 w-3.5 rounded-full transition-all duration-150 ${
                    pinError
                      ? 'bg-red-500 scale-110'
                      : i < pinInput.length
                      ? 'bg-emerald-400 scale-110 shadow-[0_0_10px_rgba(16,185,129,0.6)]'
                      : 'bg-zinc-800 border border-white/15'
                  }`}
                />
              ))}
            </div>
            {pinError && <p className="text-xs font-bold text-red-400">PIN incorreto. Tente novamente.</p>}

            {/* Teclado Numérico */}
            <div className="grid grid-cols-3 gap-3">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => handlePinDigit(d)}
                  className="h-14 rounded-2xl border border-white/[0.08] bg-zinc-900/80 text-lg font-extrabold text-white transition hover:bg-zinc-800 active:scale-95"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={handleBiometricUnlock}
                className="h-14 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/20 active:scale-95 flex flex-col items-center justify-center"
                title="Desbloquear com Biometria / Digital / Face ID"
              >
                <span className="text-base">🫆</span>
                <span className="text-[9px]">Biometria</span>
              </button>
              <button
                type="button"
                onClick={() => handlePinDigit('0')}
                className="h-14 rounded-2xl border border-white/[0.08] bg-zinc-900/80 text-lg font-extrabold text-white transition hover:bg-zinc-800 active:scale-95"
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setPinInput((p) => p.slice(0, -1))}
                className="h-14 rounded-2xl border border-white/[0.08] bg-zinc-900/50 text-xs font-bold text-zinc-400 transition hover:bg-zinc-800 hover:text-white active:scale-95"
              >
                ⌫ Apagar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header Superior Glassmorphic */}
      <header className="pt-safe sticky top-0 z-30 w-full border-b border-white/[0.07] bg-[#060609]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 gap-4 w-full">
          {/* Logo & Marca (Nunca encolhe) */}
          <Link to="/" className="flex items-center gap-2.5 group shrink-0">
            <div className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-zinc-900 border border-emerald-500/30 p-1 shadow-inner transition group-hover:border-emerald-400/60">
              <img src="/logo.png" alt="Capi Finance" className="h-7 w-7 object-contain" />
            </div>
            <div className="flex flex-col whitespace-nowrap">
              <span className="text-base font-extrabold tracking-tight text-white leading-tight">
                Capi <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">Finance</span>
              </span>
              <span className="text-[10px] font-medium text-zinc-400 tracking-wider uppercase leading-none hidden sm:inline mt-0.5">
                Gestão Pessoal
              </span>
            </div>
          </Link>

          {/* Navegação Desktop */}
          <nav className="hidden items-center gap-1 rounded-2xl border border-white/[0.06] bg-zinc-950/80 p-1 md:flex shrink-0">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition-all ${
                    to === '/lancar'
                      ? isActive
                        ? 'bg-emerald-400 text-black shadow-md shadow-emerald-500/20'
                        : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25'
                      : isActive
                      ? 'bg-zinc-800/90 text-white shadow-sm'
                      : 'text-zinc-400 hover:bg-zinc-900/60 hover:text-zinc-200'
                  }`
                }
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </NavLink>
            ))}
            {user?.is_admin && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `rounded-xl px-2.5 py-1.5 text-xs font-semibold transition ${
                    isActive
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                      : 'text-amber-400/80 hover:text-amber-300'
                  }`
                }
              >
                Admin
              </NavLink>
            )}
          </nav>

          {/* Ações Rápidas & Perfil */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Interruptor: Modo Simples vs Detalhado */}
            <div
              className="flex items-center rounded-xl border border-white/[0.1] bg-zinc-950/90 p-0.5 shadow-inner"
              role="group"
              aria-label="Modo de visualização"
            >
              <button
                type="button"
                onClick={() => {
                  if (!isSimple) {
                    setViewMode('simple');
                    toast('🌿 Modo Simples ativado! Visual limpo e direto.');
                  }
                }}
                className={`rounded-lg px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-extrabold transition-all ${
                  isSimple
                    ? 'bg-emerald-400 text-black shadow-sm shadow-emerald-500/30'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Modo Simples: ideal para iniciantes ou idosos, com menos detalhes e leitura fácil"
              >
                Simples
              </button>
              <button
                type="button"
                onClick={() => {
                  if (isSimple) {
                    setViewMode('detailed');
                    toast('📊 Modo Detalhado ativado! Visão completa com gráficos.');
                  }
                }}
                className={`rounded-lg px-2 sm:px-2.5 py-1 text-[10px] sm:text-[11px] font-extrabold transition-all ${
                  !isSimple
                    ? 'bg-zinc-800 text-white border border-white/10 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title="Modo Detalhado: visão completa com gráficos, projeções e filtros avançados"
              >
                Detalhado
              </button>
            </div>

            {/* Botão Modo Privacidade (Olhinho) */}
            <button
              type="button"
              onClick={togglePrivacy}
              className={`flex h-9 w-9 items-center justify-center rounded-xl border transition active:scale-95 ${
                isPrivate
                  ? 'border-amber-500/40 bg-amber-500/20 text-amber-300 shadow-sm shadow-amber-500/15'
                  : 'border-white/[0.08] bg-zinc-900/60 text-zinc-400 hover:text-white hover:bg-zinc-800'
              }`}
              title={
                isPrivate
                  ? 'Modo Privacidade ATIVO (valores borrados) — Clique para mostrar'
                  : 'Ativar Modo Privacidade (ocultar valores na tela)'
              }
              aria-label="Modo Privacidade"
            >
              {isPrivate ? <IconEyeOff className="h-4 w-4" /> : <IconEye className="h-4 w-4" />}
            </button>

            {/* Botão Bloquear Tela (PIN 1201 / Biometria) */}
            <button
              type="button"
              onClick={handleLockNow}
              className="hidden sm:flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-zinc-900/60 text-zinc-400 transition hover:bg-zinc-800 hover:text-emerald-300 active:scale-95"
              title="Bloquear aplicativo agora (PIN / Biometria)"
              aria-label="Bloquear tela"
            >
              <span className="text-xs">🔒</span>
            </button>

            {/* Botão Personalização & Ferramentas (Temas, OLED, Som, PIN, Automação, Admin) */}
            <button
              type="button"
              onClick={() => setShowSettingsModal(true)}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-zinc-900/60 text-zinc-400 transition hover:bg-zinc-800 hover:text-white active:scale-95"
              title="Configurações, Temas, PIN e Ferramentas"
              aria-label="Configurações e Ferramentas"
            >
              <span className="text-xs">⚙️</span>
            </button>

            {/* Desktop Only: Botão Automação Nubank */}
            <button
              type="button"
              onClick={() => setShowAutomationModal(true)}
              className="hidden lg:flex items-center gap-1.5 rounded-xl border border-purple-500/30 bg-purple-500/10 px-2.5 py-1.5 text-xs font-bold text-purple-300 transition hover:bg-purple-500/20 active:scale-95 shadow-sm shadow-purple-500/10"
              title="Automação Nubank (MacroDroid)"
            >
              <span>⚡</span>
              <span>Automação</span>
            </button>

            {/* Desktop Only: Perfil */}
            <div className="hidden xl:flex items-center gap-2 rounded-full border border-white/[0.07] bg-zinc-900/70 py-1 pl-1.5 pr-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-300 border border-emerald-500/30">
                {initial}
              </span>
              <span className="text-xs font-medium text-zinc-300 max-w-28 truncate">{user?.username}</span>
            </div>

            {/* Botão Sair */}
            <button
              onClick={handleLogout}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-zinc-400 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400 active:scale-95"
              title="Sair da conta"
              aria-label="Sair da conta"
            >
              <IconLogout className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Item 87: Alerta de Tentativas de Login com Senha Incorreta */}
      {!dismissFailedLoginBanner && (user?.recent_failed_logins ?? 0) > 0 && (
        <div className="mx-auto mt-3 w-full max-w-5xl px-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-red-500/40 bg-red-950/40 px-4 py-2.5 text-xs text-red-200 shadow-lg">
            <div className="flex items-center gap-2">
              <span className="text-base">🛡️</span>
              <span>
                <strong>Alerta de Segurança:</strong> Detectamos{' '}
                <strong>{user?.recent_failed_logins} tentativa(s)</strong> de login com senha incorreta nas últimas 24h
                {user?.last_failed_login_ip ? ` (IP: ${user.last_failed_login_ip})` : ''}.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDismissFailedLoginBanner(true)}
              className="shrink-0 rounded-lg bg-red-500/20 px-2.5 py-1 text-[11px] font-bold text-red-200 hover:bg-red-500/30"
            >
              Entendi
            </button>
          </div>
        </div>
      )}

      {/* Modal de Personalização, Temas, OLED, Sons e PIN (Itens 77, 81, 95, 96, 99) */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <h3 className="text-base font-extrabold text-white flex items-center gap-2">
                <span>⚙️</span> Ajustes & Ferramentas
              </h3>
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="rounded-lg p-1 text-zinc-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Ferramentas Rápidas (Mobile & Desktop) */}
            <div className="space-y-2">
              <label className="block text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                Ferramentas Rápidas
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsModal(false);
                    setShowAutomationModal(true);
                  }}
                  className="flex items-center gap-2.5 rounded-xl border border-purple-500/30 bg-purple-500/10 p-2.5 text-left text-xs font-bold text-purple-300 hover:bg-purple-500/20 transition active:scale-95"
                >
                  <span className="text-lg">⚡</span>
                  <div className="min-w-0">
                    <div className="text-white truncate">Automação Nubank</div>
                    <div className="text-[10px] font-normal text-purple-300/80 truncate">MacroDroid & Logs</div>
                  </div>
                </button>

                {user?.is_admin ? (
                  <Link
                    to="/admin"
                    onClick={() => setShowSettingsModal(false)}
                    className="flex items-center gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-2.5 text-left text-xs font-bold text-amber-300 hover:bg-amber-500/20 transition active:scale-95"
                  >
                    <span className="text-lg">👑</span>
                    <div className="min-w-0">
                      <div className="text-white truncate">Painel Admin</div>
                      <div className="text-[10px] font-normal text-amber-300/80 truncate">Usuários & Sistema</div>
                    </div>
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSettingsModal(false);
                      handleLockNow();
                    }}
                    className="flex items-center gap-2.5 rounded-xl border border-white/10 bg-zinc-900/70 p-2.5 text-left text-xs font-bold text-zinc-300 hover:bg-zinc-800 transition active:scale-95"
                  >
                    <span className="text-lg">🔒</span>
                    <div className="min-w-0">
                      <div className="text-white truncate">Bloquear Tela</div>
                      <div className="text-[10px] font-normal text-zinc-400 truncate">PIN 1201 / Digital</div>
                    </div>
                  </button>
                )}
              </div>

              {!isStandalone && (deferredPrompt || isIos) && (
                <button
                  type="button"
                  onClick={() => {
                    setShowSettingsModal(false);
                    setShowInstallModal(true);
                  }}
                  className="w-full flex items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500/20 transition active:scale-95"
                >
                  <span>📱</span>
                  <span>Instalar Capi Finance no Celular</span>
                </button>
              )}
            </div>

            {/* Cor de Destaque (Item 96) */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-zinc-300">Cor de Destaque do Sistema</label>
              <div className="grid grid-cols-5 gap-2">
                {ACCENT_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setAccentTheme(t.id)}
                    className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-[10px] font-semibold transition ${
                      accentTheme === t.id
                        ? 'border-white bg-zinc-800 text-white'
                        : 'border-white/10 bg-zinc-900/60 text-zinc-400 hover:text-white'
                    }`}
                  >
                    <span className="h-4 w-4 rounded-full" style={{ backgroundColor: t.color }} />
                    <span className="truncate w-full text-center">{t.label.split(' ')[0]}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Toggles: OLED, Sons, Lembrete 21h, Auto-lock */}
            <div className="space-y-2.5 text-xs">
              <label className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-zinc-900/50 p-3 cursor-pointer">
                <div>
                  <p className="font-bold text-white">🌑 Modo Preto Puro (OLED / True Black)</p>
                  <p className="text-[11px] text-zinc-400">Fundo #000000 para máxima economia de bateria</p>
                </div>
                <input
                  type="checkbox"
                  checked={oledMode}
                  onChange={(e) => setOledMode(e.target.checked)}
                  className="h-4 w-4 accent-emerald-400"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-zinc-900/50 p-3 cursor-pointer">
                <div>
                  <p className="font-bold text-white">🔊 Sons de Sucesso e Moeda</p>
                  <p className="text-[11px] text-zinc-400">Efeito sonoro sutil ao lançar gastos ou quitar metas</p>
                </div>
                <input
                  type="checkbox"
                  checked={!soundMuted}
                  onChange={(e) => {
                    const nextMuted = !e.target.checked;
                    setSoundMuted(nextMuted);
                    localStorage.setItem('capi:sound_muted', nextMuted ? '1' : '0');
                    if (!nextMuted) playSuccessSound('coin');
                  }}
                  className="h-4 w-4 accent-emerald-400"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-zinc-900/50 p-3 cursor-pointer">
                <div>
                  <p className="font-bold text-white">🌙 Lembrete Noturno (21:00)</p>
                  <p className="text-[11px] text-zinc-400">Notificação diária para revisar os gastos do dia</p>
                </div>
                <input
                  type="checkbox"
                  checked={eveningRem}
                  onChange={(e) => {
                    setEveningRem(e.target.checked);
                    localStorage.setItem('capi:evening_reminder', e.target.checked ? '1' : '0');
                  }}
                  className="h-4 w-4 accent-emerald-400"
                />
              </label>

              <label className="flex items-center justify-between rounded-xl border border-white/[0.07] bg-zinc-900/50 p-3 cursor-pointer">
                <div>
                  <p className="font-bold text-white">🔒 Bloqueio Automático por Inatividade</p>
                  <p className="text-[11px] text-zinc-400">Pede o PIN após 3 minutos sem mexer</p>
                </div>
                <input
                  type="checkbox"
                  checked={autoLockEnabled}
                  onChange={(e) => {
                    setAutoLockEnabled(e.target.checked);
                    localStorage.setItem('capi:auto_lock', e.target.checked ? '1' : '0');
                  }}
                  className="h-4 w-4 accent-emerald-400"
                />
              </label>
            </div>

            {/* Configuração do PIN (Item 81) */}
            <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-3.5 space-y-2">
              <label className="block text-xs font-bold text-zinc-300">
                🔑 PIN de Bloqueio Rápido (Atual: {userPin})
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={8}
                  value={newPinField}
                  onChange={(e) => setNewPinField(e.target.value.replace(/\D/g, ''))}
                  placeholder="1201"
                  className="flex-1 rounded-xl border border-white/10 bg-black px-3 py-1.5 text-xs font-mono text-white"
                />
                <button
                  type="button"
                  onClick={handleSavePin}
                  className="rounded-xl bg-emerald-400 px-3 py-1.5 text-xs font-extrabold text-black hover:bg-emerald-300"
                >
                  Salvar PIN
                </button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowSettingsModal(false)}
                className="rounded-xl bg-zinc-800 px-4 py-2 text-xs font-bold text-white hover:bg-zinc-700"
              >
                Concluído
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Instalação PWA */}
      <InstallPwaModal
        isOpen={showInstallModal}
        onClose={() => setShowInstallModal(false)}
        deferredPrompt={deferredPrompt}
        isIos={isIos}
      />

      {/* Modal de Automação Nubank */}
      <AutomationModal
        isOpen={showAutomationModal}
        onClose={() => setShowAutomationModal(false)}
      />

      {/* Conteúdo Principal com Transição Suave (Item 76) */}
      <main key={location.pathname} className="mx-auto w-full max-w-5xl flex-1 px-3 sm:px-4 pt-4 sm:pt-5 pb-24 md:pb-14 animate-page-in overflow-x-hidden">
        <Outlet />
      </main>

      {/* Navegação Inferior (Mobile) */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 w-full max-w-full overflow-hidden border-t border-white/[0.08] bg-[#060609]/95 backdrop-blur-xl md:hidden">
        <div className="grid w-full grid-cols-7 items-center px-0.5 py-1 select-none">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `group relative flex flex-col items-center justify-center py-0.5 transition-all ${
                  isActive ? 'text-emerald-400 font-bold' : 'text-zinc-400 hover:text-zinc-200 font-medium'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <div
                    className={`flex items-center justify-center rounded-xl transition-all ${
                      to === '/lancar'
                        ? isActive
                          ? 'h-8 w-8 bg-emerald-400 text-black shadow-md shadow-emerald-500/30 scale-105'
                          : 'h-8 w-8 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                        : isActive
                        ? 'h-7 w-7 bg-emerald-500/15 text-emerald-400'
                        : 'h-7 w-7 text-zinc-400 group-hover:text-zinc-200'
                    }`}
                  >
                    <Icon className={to === '/lancar' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
                  </div>
                  <span className="w-full truncate px-0.5 text-center text-[8px] leading-tight mt-0.5">
                    {label === 'Calendário' ? 'Agenda' : label}
                  </span>
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
