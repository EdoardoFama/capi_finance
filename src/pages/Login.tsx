import { useState, type FormEvent } from 'react';
import { api, type User } from '../api';
import { useAuth } from '../context';
import { Input } from '../components/ui';

export default function Login() {
  const { setUser } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e: FormEvent) {
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

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <img src="/icon.svg" alt="" className="mb-4 h-16 w-16" />
          <h1 className="text-2xl font-bold tracking-tight">
            Capi <span className="text-emerald-400">Finance</span>
          </h1>
          <p className="mt-1 text-sm text-zinc-500">Controle de gastos pessoais</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Input
            placeholder="Usuário"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <Input
            type="password"
            placeholder="Senha"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            disabled={loading}
            className="w-full rounded-xl bg-emerald-400 py-3 font-semibold text-black transition hover:bg-emerald-300 disabled:opacity-60"
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}

