import { useState, type ReactNode, type InputHTMLAttributes } from 'react';
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
export const IconChevronDown = (p: { className?: string }) => (
  <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>
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
export const IconSearch = (p: { className?: string }) => (
  <Svg {...p}><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></Svg>
);
export const IconCalendar = (p: { className?: string }) => (
  <Svg {...p}><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></Svg>
);
export const IconDownload = (p: { className?: string }) => (
  <Svg {...p}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></Svg>
);
export const IconCheck = (p: { className?: string }) => (
  <Svg {...p}><polyline points="20 6 9 17 4 12" /></Svg>
);
export const IconArrowDownLeft = (p: { className?: string }) => (
  <Svg {...p}><line x1="17" y1="7" x2="7" y2="17" /><polyline points="17 17 7 17 7 7" /></Svg>
);
export const IconArrowUpRight = (p: { className?: string }) => (
  <Svg {...p}><line x1="7" y1="17" x2="17" y2="7" /><polyline points="7 7 17 7 17 17" /></Svg>
);
export const IconSparkles = (p: { className?: string }) => (
  <Svg {...p}><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z" /></Svg>
);
export const IconEye = (p: { className?: string }) => (
  <Svg {...p}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Svg>
);
export const IconEyeOff = (p: { className?: string }) => (
  <Svg {...p}><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></Svg>
);

// ---------- Seletor de mês ----------
export function MonthPicker() {
  const { month, setMonth } = useMonth();
  const isCurrent = month === currentMonth();
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.08] bg-zinc-950/90 p-1.5 shadow-lg shadow-black/40 backdrop-blur-md">
      <button
        onClick={() => setMonth(shiftMonth(month, -1))}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white active:scale-95"
        aria-label="Mês anterior"
      >
        <IconChevron dir="left" className="h-5 w-5" />
      </button>

      <button
        onClick={() => setMonth(currentMonth())}
        className="group flex flex-1 items-center justify-center gap-2 py-1 text-center"
        title="Voltar para o mês atual"
      >
        <IconCalendar className="h-4 w-4 text-emerald-400/80 transition group-hover:scale-110" />
        <span className="text-sm font-bold tracking-tight text-zinc-100 capitalize">
          {monthLabel(month)}
        </span>
        {!isCurrent && (
          <span className="rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-300 transition hover:bg-emerald-500/25">
            Ir p/ atual
          </span>
        )}
      </button>

      <button
        onClick={() => setMonth(shiftMonth(month, 1))}
        className="flex h-9 w-9 items-center justify-center rounded-xl text-zinc-400 transition hover:bg-zinc-900 hover:text-white active:scale-95"
        aria-label="Próximo mês"
      >
        <IconChevron dir="right" className="h-5 w-5" />
      </button>
    </div>
  );
}

// ---------- Barra de progresso ----------
export const barColor = (pct: number) =>
  pct >= 100
    ? 'bg-gradient-to-r from-red-500 to-rose-500 shadow-[0_0_10px_rgba(239,68,68,0.4)]'
    : pct >= 80
    ? 'bg-gradient-to-r from-amber-400 to-orange-400 shadow-[0_0_10px_rgba(245,158,11,0.3)]'
    : 'bg-gradient-to-r from-emerald-400 to-teal-400 shadow-[0_0_10px_rgba(16,185,129,0.3)]';

export const textColor = (pct: number) =>
  pct >= 100 ? 'text-red-400' : pct >= 80 ? 'text-amber-300' : 'text-emerald-400';

export function ProgressBar({ spent, budget, className = 'h-2' }: { spent: number; budget: number; className?: string }) {
  const pct = percent(spent, budget);
  return (
    <div className={`w-full overflow-hidden rounded-full bg-zinc-900/90 ring-1 ring-inset ring-white/[0.05] ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-500 ${barColor(pct)}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

// ---------- Blocos ----------
export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-2xl border border-white/[0.08] bg-zinc-950/85 p-4 shadow-xl shadow-black/30 backdrop-blur-sm ${className}`}>
    {children}
  </div>
);

export const PageTitle = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div>
    <h1 className="text-xl sm:text-2xl font-extrabold tracking-tight text-white">{title}</h1>
    {subtitle && <p className="mt-0.5 text-xs sm:text-sm text-zinc-400">{subtitle}</p>}
  </div>
);

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full rounded-xl border border-white/[0.08] bg-zinc-900/90 px-3.5 py-2.5 text-sm sm:text-base text-zinc-100 placeholder:text-zinc-600 outline-none transition focus:border-emerald-500/60 focus:bg-zinc-900 focus:ring-2 focus:ring-emerald-500/20 ${props.className ?? ''}`}
    />
  );
}

export const Spinner = () => (
  <div className="flex flex-col items-center justify-center gap-3 py-16">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-zinc-800 border-t-emerald-400" />
    <span className="text-xs font-medium text-zinc-500 animate-pulse">Carregando dados...</span>
  </div>
);

// ---------- Retração / Expansão de Blocos ----------
export function useCollapsible(storageKey: string, defaultOpen = true) {
  const fullKey = `capi_collapse_${storageKey}`;
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const stored = localStorage.getItem(fullKey);
        if (stored !== null) return stored === 'true';
      }
    } catch {
      // Fallback
    }
    return defaultOpen;
  });

  const toggle = () => {
    setIsOpen((prev) => {
      const next = !prev;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          localStorage.setItem(fullKey, String(next));
        }
      } catch {
        // Fallback
      }
      return next;
    });
  };

  return { isOpen, toggle, setIsOpen };
}

export function CollapseButton({
  isOpen,
  onToggle,
  title,
  className = '',
}: {
  isOpen: boolean;
  onToggle: () => void;
  title?: string;
  className?: string;
}) {
  const label = title || (isOpen ? 'Recolher seção' : 'Expandir seção');
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      title={label}
      aria-label={label}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-zinc-900/80 text-zinc-400 transition hover:border-white/20 hover:bg-zinc-800 hover:text-white active:scale-95 ${className}`}
    >
      <IconChevronDown
        className={`h-4 w-4 transition-transform duration-200 ${isOpen ? 'rotate-180' : 'rotate-0'}`}
      />
    </button>
  );
}
