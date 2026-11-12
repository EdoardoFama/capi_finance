import { useMemo } from 'react';
import { formatBRL } from '../format';

export type DistributionItem = {
  name: string;
  amount_cents: number;
  color?: string;
};

const PALETTE = [
  '#8b5cf6', // purple
  '#10b981', // emerald
  '#3b82f6', // blue
  '#f59e0b', // amber
  '#06b6d4', // cyan
  '#ec4899', // pink
  '#f97316', // orange
  '#6366f1', // indigo
  '#14b8a6', // teal
  '#d946ef', // fuchsia
  '#84cc16', // lime
  '#ef4444', // red
  '#0ea5e9', // sky
  '#a855f7', // violet
  '#eab308', // yellow
  '#64748b', // slate
];

export function getPaletteColor(index: number): string {
  return PALETTE[index % PALETTE.length];
}

type Props = {
  title: string;
  subtitle?: string;
  items: DistributionItem[];
  emptyMessage?: string;
  className?: string;
};

export default function DistributionChart({
  title,
  subtitle,
  items,
  emptyMessage = 'Nenhum dado registrado para exibir a distribuição.',
  className = '',
}: Props) {
  // Filtra itens com valor > 0 e ordena do maior para o menor
  const sortedItems = useMemo(() => {
    return items
      .filter((it) => it.amount_cents > 0)
      .sort((a, b) => b.amount_cents - a.amount_cents)
      .map((it, idx) => ({
        ...it,
        color: it.color || getPaletteColor(idx),
      }));
  }, [items]);

  const totalCents = useMemo(() => {
    return sortedItems.reduce((acc, it) => acc + it.amount_cents, 0);
  }, [sortedItems]);

  if (totalCents <= 0 || sortedItems.length === 0) {
    return null;
  }

  return (
    <div className={`rounded-2xl border border-zinc-800 bg-zinc-950 p-4 shadow-lg ${className}`}>
      {/* Cabeçalho do Gráfico */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-900 pb-3">
        <div>
          <h3 className="text-sm font-bold tracking-tight text-white">{title}</h3>
          {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="text-right">
          <p className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Total analisado</p>
          <p className="text-sm font-extrabold text-white tabular-nums">{formatBRL(totalCents)}</p>
        </div>
      </div>

      {/* Barra Multicolorida Segmentada */}
      <div className="mt-4">
        <div className="h-3.5 w-full overflow-hidden rounded-full bg-zinc-900 flex shadow-inner">
          {sortedItems.map((it) => {
            const pct = (it.amount_cents / totalCents) * 100;
            return (
              <div
                key={it.name}
                style={{
                  width: `${pct}%`,
                  backgroundColor: it.color,
                }}
                className="h-full transition-all duration-500 first:rounded-l-full last:rounded-r-full border-r border-zinc-950/60 last:border-none hover:opacity-90"
                title={`${it.name}: ${formatBRL(it.amount_cents)} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
      </div>

      {/* Grid de Legendas com Porcentagem e Valores */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {sortedItems.map((it) => {
          const pct = (it.amount_cents / totalCents) * 100;
          return (
            <div
              key={it.name}
              className="flex items-center justify-between gap-2 rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-2.5 transition hover:border-zinc-700 hover:bg-zinc-900/70"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  className="shrink-0 h-3 w-3 rounded-full shadow-sm"
                  style={{ backgroundColor: it.color }}
                />
                <span className="truncate text-xs font-semibold text-zinc-200" title={it.name}>
                  {it.name}
                </span>
              </div>

              <div className="text-right shrink-0">
                <div className="flex items-center justify-end gap-1.5">
                  <span className="text-xs font-bold text-white tabular-nums">
                    {pct >= 10 ? pct.toFixed(1) : pct.toFixed(1)}%
                  </span>
                </div>
                <p className="text-[11px] text-zinc-400 tabular-nums">
                  {formatBRL(it.amount_cents)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

