import { NavLink, Outlet, Link } from 'react-router';
import { useAuth } from '../context';
import { IconCreditCard, IconHome, IconList, IconLogout, IconPlus, IconTrendingUp, IconWallet } from './ui';

const NAV = [
  { to: '/', label: 'Início', icon: IconHome, end: true },
  { to: '/orcamento', label: 'Orçamento', icon: IconWallet, end: false },
  { to: '/lancar', label: 'Lançar', icon: IconPlus, end: false },
  { to: '/cartao', label: 'Cartão', icon: IconCreditCard, end: false },
  { to: '/extrato', label: 'Extrato', icon: IconList, end: false },
  { to: '/investimentos', label: 'Investir', icon: IconTrendingUp, end: false },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const initial = (user?.username?.[0] ?? 'U').toUpperCase();

  return (
    <div className="min-h-dvh flex flex-col">
      {/* Header Superior Glassmorphic */}
      <header className="pt-safe sticky top-0 z-30 border-b border-white/[0.07] bg-[#060609]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-4xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2.5 group">
            <div className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-zinc-900 border border-emerald-500/30 p-1 shadow-inner transition group-hover:border-emerald-400/60">
              <img src="/logo.png" alt="Capi Finance" className="h-7 w-7 object-contain" />
            </div>
            <div className="flex flex-col">
              <span className="text-base font-extrabold tracking-tight leading-none text-white">
                Capi <span className="bg-gradient-to-r from-emerald-400 to-teal-300 bg-clip-text text-transparent">Finance</span>
              </span>
              <span className="text-[10px] font-medium text-zinc-500 tracking-wider uppercase mt-0.5">
                Gestão Pessoal
              </span>
            </div>
          </Link>

          {/* Navegação Desktop */}
          <nav className="hidden items-center gap-1 rounded-2xl border border-white/[0.06] bg-zinc-950/80 p-1 md:flex">
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
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
                  `rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
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

          {/* Perfil & Sair */}
          <div className="flex items-center gap-2">
            {user?.is_admin && (
              <NavLink
                to="/admin"
                className="md:hidden rounded-lg px-2 py-1 text-[11px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/25"
                title="Painel Admin"
              >
                Admin
              </NavLink>
            )}
            <div className="hidden sm:flex items-center gap-2 rounded-full border border-white/[0.07] bg-zinc-900/70 py-1 pl-1.5 pr-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-300 border border-emerald-500/30">
                {initial}
              </span>
              <span className="text-xs font-medium text-zinc-300 max-w-28 truncate">{user?.username}</span>
            </div>
            <button
              onClick={() => confirm('Sair da conta?') && logout()}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-zinc-400 transition hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-400"
              title="Sair da conta"
              aria-label="Sair da conta"
            >
              <IconLogout className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Conteúdo Principal */}
      <main className="mx-auto w-full max-w-4xl flex-1 px-4 pt-5 pb-32 md:pb-14">
        <Outlet />
      </main>

      {/* Navegação Inferior Flutuante (Mobile) */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-white/[0.08] bg-[#060609]/90 backdrop-blur-xl md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-6 items-center px-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `relative flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-semibold transition-all ${
                  isActive ? 'text-emerald-400' : 'text-zinc-500 hover:text-zinc-300'
                }`
              }
            >
              {({ isActive }) =>
                to === '/lancar' ? (
                  <>
                    <span
                      className={`-mt-4 flex h-11 w-11 items-center justify-center rounded-2xl border shadow-lg transition-transform active:scale-95 ${
                        isActive
                          ? 'border-emerald-300 bg-emerald-400 text-black shadow-emerald-500/30'
                          : 'border-emerald-500/40 bg-gradient-to-br from-emerald-400 to-teal-500 text-black shadow-emerald-500/20'
                      }`}
                    >
                      <Icon className="h-5 w-5 stroke-[2.4]" />
                    </span>
                    <span className={isActive ? 'text-emerald-400 font-bold' : 'text-zinc-300'}>{label}</span>
                  </>
                ) : (
                  <>
                    <div className={`relative rounded-xl px-2.5 py-1 transition-all ${isActive ? 'bg-emerald-500/15' : ''}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <span>{label}</span>
                  </>
                )
              }
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
