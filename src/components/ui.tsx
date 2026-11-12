import type { ReactNode, InputHTMLAttributes } from 'react';
import { useMonth } from '../context';
import { monthLabel, shiftMonth, currentMonth, percent } from '../format';

// ---------- Ícones (inline SVG) ----------
const Svg = ({ children, className = 'h-6 w-6' }: { children: ReactNode; className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className}>
    {children}
  </svg>
);
export const IconHome = (p: { className?: string }) => (
  <Svg {...p}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M10 21v-6h4v6" /></Svg>
);
export const IconWallet = (p: { className?: string }) => (
  <Svg {...p}><rect x="3" y="6" width="18" height="14" rx="2" /><path d="M3 10h18" /><path d="M16 15h2" /><path d="M6 6V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" /></Svg>
);
export const IconPlus = (p: { className?: string }) => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
);
export const IconList = (p: { className?: string }) => (
  <Svg {...p}><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" strokeWidth={3} /><line x1="3" y1="12" x2="3.01" y2="12" strokeWidth={3} /><line x1="3" y1="18" x2="3.01" y2="18" strokeWidth={3} /></Svg>
);
export const IconTrendingUp = (p: { className?: string }) => (
  <Svg {...p}><polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" /></Svg>
);
export const IconTrash = (p: { className?: string }) => (
  <Svg {...p}><path d="M4 7h16" /><path d="M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></Svg>
);
export const IconChevron = ({ dir = 'left', className }: { dir?: 'left' | 'right'; className?: string }) => (
  <Svg className={className}><path d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 6l6 6-6 6'} /></Svg>
);
export const IconLogout = (p: { className?: string }) => (
  <Svg {...p}><path d="M15 4h4v16h-4" /><path d="M10 8l-4 4 4 4" /><path d="M6 12h10" /></Svg>
);
export const IconCreditCard = (p: { className?: string }) => (
  <Svg {...p}><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></Svg>
);
export const IconEdit = (p: { className?: string }) => (
  <Svg {...p}><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></Svg>
);

// ---------- Seletor de mês ----------
export function MonthPicker() {
  const { month, setMonth } = useMonth();
  const isCurrent = month === currentMonth();
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-zinc-800 bg-zinc-950 p-1">
      <button onClick={() => setMonth(shiftMonth(month, -1))} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white" aria-label="Mês anterior">
        <IconChevron dir="left" className="h-5 w-5" />
      </button>
      <button
        onClick={() => setMonth(currentMonth())}
        className="flex-1 text-center text-sm font-semibold"
        title="Voltar para o mês atual"
      >
        {monthLabel(month)}
        {!isCurrent && <span className="ml-2 text-xs font-normal text-emerald-400">ir p/ atual</span>}
      </button>
      <button onClick={() => setMonth(shiftMonth(month, 1))} className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white" aria-label="Próximo mês">
        <IconChevron dir="right" className="h-5 w-5" />
      </button>
    </div>
  );
}

// ---------- Barra de progresso ----------
export const barColor = (pct: number) =>
  pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-400';
export const textColor = (pct: number) =>
  pct >= 100 ? 'text-red-400' : pct >= 80 ? 'text-amber-300' : 'text-emerald-400';

export function ProgressBar({ spent, budget, className = 'h-2' }: { spent: number; budget: number; className?: string }) {
  const pct = percent(spent, budget);
  return (
    <div className={`w-full overflow-hidden rounded-full bg-zinc-800 ${className}`}>
      <div className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

// ---------- Blocos ----------
export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-2xl border border-zinc-800 bg-zinc-950 p-4 ${className}`}>{children}</div>
);

export const PageTitle = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div className="mb-4">
    <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
    {subtitle && <p className="mt-0.5 text-sm text-zinc-500">{subtitle}</p>}
  </div>
);

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2.5 text-base text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20 ${props.className ?? ''}`}
    />
  );
}

export const Spinner = () => (
  <div className="flex justify-center py-16">
    <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-700 border-t-emerald-400" />
  </div>
);

