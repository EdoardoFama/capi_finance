import { useState, type FormEvent } from 'react';
import { api, type User } from '../api';
import { useAuth, useToast } from '../context';
import { Input } from '../components/ui';

type Mode = 'login' | 'signup_data' | 'signup_otp' | 'forgot_email' | 'forgot_otp';

function PasswordField({
  value,
  onChange,
  placeholder = 'Senha',
  label,
  required = true,
  autoComplete,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  required?: boolean;
  autoComplete?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      {label && <label className="text-[11px] text-zinc-400 uppercase font-semibold block mb-1">{label}</label>}
      <div className="relative">
        <Input
          type={show ? 'text' : 'password'}
          placeholder={placeholder}
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="pr-11"
          required={required}
        />
        <button
          type="button"
          onClick={() => setShow((prev) => !prev)}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-zinc-400 hover:text-zinc-200 transition"
          aria-label={show ? 'Ocultar senha' : 'Ver senha'}
          tabIndex={-1}
        >
          {show ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <line x1="1" y1="1" x2="23" y2="23" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-5 w-5">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

export default function Login() {
  const { setUser } = useAuth();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('login');

  // Campos
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 1. Submit de Login
  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      setUser(await api<User>('/auth/login', { method: 'POST', body: { username, password } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // 2. Solicitar código para Cadastro
  async function requestSignupOtp(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (password !== confirmPassword) {
      setError('As senhas não coincidem. Digite a mesma senha nos dois campos.');
      return;
    }

    setLoading(true);
    try {
      await api('/auth/signup/request', {
        method: 'POST',
        body: { username, email, password },
      });
      toast(`Código enviado para ${email}`);
      setMode('signup_otp');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // 3. Confirmar código e finalizar Cadastro
  async function confirmSignup(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const u = await api<User>('/auth/signup/confirm', {
        method: 'POST',
        body: { email, code: otpCode },
      });
      toast('Conta criada com sucesso!');
      setUser(u);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // 4. Solicitar recuperação de senha
  async function requestForgotOtp(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await api('/auth/password/request', {
        method: 'POST',
        body: { email },
      });
      toast(`Se o e-mail existir, enviamos o código.`);
      setMode('forgot_otp');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // 5. Redefinir senha com o código
  async function confirmResetPassword(e: FormEvent) {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('As senhas não coincidem. Digite a mesma senha nos dois campos.');
      return;
    }

    setLoading(true);
    try {
      await api('/auth/password/reset', {
        method: 'POST',
        body: { email, code: otpCode, new_password: newPassword },
      });
      toast('Senha redefinida com sucesso!');
      setMode('login');
      setPassword('');
      setConfirmPassword('');
      setOtpCode('');
      setNewPassword('');
      setConfirmNewPassword('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        {/* Logo e cabeçalho */}
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/logo.png" alt="Capi Finance" className="mb-3 h-24 w-24 object-contain" />
          <h1 className="text-2xl font-bold tracking-tight">
            Capi <span className="text-emerald-400">Finance</span>
          </h1>
          <p className="mt-1 text-xs text-zinc-500">
            {mode === 'login' && 'Controle de gastos pessoais'}
            {mode === 'signup_data' && 'Criar sua conta'}
            {mode === 'signup_otp' && 'Confirmação por e-mail'}
            {mode === 'forgot_email' && 'Recuperar senha'}
            {mode === 'forgot_otp' && 'Definir nova senha'}
          </p>
        </div>

        {/* ================= TELA: LOGIN ================= */}
        {mode === 'login' && (
          <form onSubmit={submitLogin} className="space-y-3">
            <div>
              <Input
                placeholder="Usuário ou E-mail"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <PasswordField
              placeholder="Senha"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
            />

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setMode('forgot_email');
                }}
                className="text-xs text-zinc-400 hover:text-emerald-400 transition"
              >
                Esqueci minha senha
              </button>
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              disabled={loading}
              className="w-full rounded-xl bg-emerald-400 py-3 font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-60"
            >
              {loading ? 'Entrando…' : 'Entrar'}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setMode('signup_data');
                }}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Não tem uma conta? <span className="text-emerald-400 font-semibold">Cadastre-se</span>
              </button>
            </div>
          </form>
        )}

        {/* ================= TELA: CADASTRO - DADOS ================= */}
        {mode === 'signup_data' && (
          <form onSubmit={requestSignupOtp} className="space-y-3">
            <div>
              <label className="text-[11px] text-zinc-400 uppercase font-semibold block mb-1">Nome de usuário</label>
              <Input
                placeholder="Ex: joao_silva"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 uppercase font-semibold block mb-1">E-mail</label>
              <Input
                type="email"
                placeholder="seuemail@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            <PasswordField
              label="Senha"
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={setPassword}
            />

            <PasswordField
              label="Confirmar Senha"
              placeholder="Digite a senha novamente"
              value={confirmPassword}
              onChange={setConfirmPassword}
            />

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              disabled={loading}
              className="w-full rounded-xl bg-emerald-400 py-3 font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-60"
            >
              {loading ? 'Enviando código…' : 'Continuar'}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setMode('login');
                }}
                className="text-xs text-zinc-400 hover:text-white"
              >
                Já possui conta? <span className="text-emerald-400 font-semibold">Fazer login</span>
              </button>
            </div>
          </form>
        )}

        {/* ================= TELA: CADASTRO - CONFIRMAÇÃO OTP ================= */}
        {mode === 'signup_otp' && (
          <form onSubmit={confirmSignup} className="space-y-4">
            <div className="rounded-xl bg-zinc-900/60 border border-zinc-850 p-3.5 text-center">
              <p className="text-xs text-zinc-300">
                Enviamos um código de 6 dígitos para:
              </p>
              <p className="font-semibold text-emerald-400 text-sm mt-0.5">{email}</p>
            </div>

            <div>
              <label className="text-xs text-zinc-400 block mb-1 text-center">Digite o código de 6 dígitos</label>
              <input
                type="text"
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                placeholder="000000"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 py-3 text-center text-3xl font-bold tracking-[10px] text-emerald-400 outline-none focus:border-emerald-500"
                required
              />
            </div>

            {error && <p className="text-xs text-red-400 text-center">{error}</p>}

            <button
              disabled={loading || otpCode.length < 6}
              className="w-full rounded-xl bg-emerald-400 py-3 font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-50"
            >
              {loading ? 'Confirmando…' : 'Ativar e Entrar'}
            </button>

            <div className="flex items-center justify-between pt-1 text-xs">
              <button
                type="button"
                onClick={() => setMode('signup_data')}
                className="text-zinc-500 hover:text-zinc-300"
              >
                ← Alterar dados
              </button>
              <button
                type="button"
                onClick={requestSignupOtp}
                className="text-emerald-400 hover:underline"
              >
                Reenviar código
              </button>
            </div>
          </form>
        )}

        {/* ================= TELA: ESQUECI MINHA SENHA - EMAIL ================= */}
        {mode === 'forgot_email' && (
          <form onSubmit={requestForgotOtp} className="space-y-3">
            <div>
              <label className="text-xs text-zinc-400 block mb-1">Informe seu e-mail cadastrado</label>
              <Input
                type="email"
                placeholder="seuemail@exemplo.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              disabled={loading}
              className="w-full rounded-xl bg-emerald-400 py-3 font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-60"
            >
              {loading ? 'Enviando…' : 'Enviar código de recuperação'}
            </button>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setError('');
                  setMode('login');
                }}
                className="text-xs text-zinc-400 hover:text-white"
              >
                ← Voltar para o login
              </button>
            </div>
          </form>
        )}

        {/* ================= TELA: ESQUECI MINHA SENHA - CÓDIGO E NOVA SENHA ================= */}
        {mode === 'forgot_otp' && (
          <form onSubmit={confirmResetPassword} className="space-y-3">
            <div className="rounded-xl bg-zinc-900/60 border border-zinc-850 p-3 text-center">
              <p className="text-xs text-zinc-300">Código enviado para:</p>
              <p className="font-semibold text-emerald-400 text-xs mt-0.5">{email}</p>
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 uppercase font-semibold block mb-1">Código de 6 dígitos</label>
              <Input
                type="text"
                maxLength={6}
                inputMode="numeric"
                placeholder="000000"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                className="text-center font-bold tracking-widest text-lg"
                required
              />
            </div>

            <PasswordField
              label="Nova Senha"
              placeholder="Mínimo 6 caracteres"
              value={newPassword}
              onChange={setNewPassword}
            />

            <PasswordField
              label="Confirmar Nova Senha"
              placeholder="Digite a nova senha novamente"
              value={confirmNewPassword}
              onChange={setConfirmNewPassword}
            />

            {error && <p className="text-xs text-red-400">{error}</p>}

            <button
              disabled={loading}
              className="w-full rounded-xl bg-emerald-400 py-3 font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-60"
            >
              {loading ? 'Salvando…' : 'Redefinir senha'}
            </button>

            <div className="pt-1 text-center">
              <button
                type="button"
                onClick={() => setMode('login')}
                className="text-xs text-zinc-400 hover:text-white"
              >
                ← Voltar ao login
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
