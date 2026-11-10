import { NavLink, Outlet } from 'react-router';
import { useAuth } from '../context';
import { IconHome, IconList, IconLogout, IconPlus, IconTrendingUp, IconWallet } from './ui';

const NAV = [
  { to: '/', label: 'Início', icon: IconHome, end: true },
  { to: '/orcamento', label: 'Orçamento', icon: IconWallet, end: false },
  { to: '/lancar', label: 'Lançar', icon: IconPlus, end: false },
  { to: '/extrato', label: 'Extrato', icon: IconList, end: false },
  { to: '/investimentos', label: 'Investimentos', icon: IconTrendingUp, end: false },
];

export default function Layout() {
  const { user, logout } = useAuth();
  return (
    <div className="min-h-dvh">
      <header className="pt-safe sticky top-0 z-30 border-b border-zinc-900 bg-black/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
          <div className="flex items-center gap-2.5">
            <img src="/logo.png" alt="Capi Finance" className="h-8 w-8 object-contain" />
            <span className="font-bold tracking-tight">
              Capi <span className="text-emerald-400">Finance</span>
            </span>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map(({ to, label, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive ? 'bg-zinc-900 text-white' : 'text-zinc-400 hover:text-white'
                  }`
                }
              >
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-zinc-500 sm:inline">{user?.username}</span>
            <button
              onClick={() => confirm('Sair da conta?') && logout()}
              className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-900 hover:text-white"
              title="Sair"
            >
              <IconLogout className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-5 pb-32 md:pb-12">
        <Outlet />
      </main>

      {/* Navegação inferior (mobile) */}
      <nav className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-zinc-900 bg-black/90 backdrop-blur md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition ${
                  isActive ? 'text-emerald-400' : 'text-zinc-500'
                }`
              }
            >
              {({ isActive }) =>
                to === '/lancar' ? (
                  <>
                    <span className={`-mt-1 rounded-full p-1.5 ${isActive ? 'bg-emerald-400 text-black' : 'bg-zinc-800 text-zinc-200'}`}>
                      <Icon className="h-5 w-5" />
                    </span>
                    {label}
                  </>
                ) : (
                  <>
                    <Icon className="h-6 w-6" />
                    {label}
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

