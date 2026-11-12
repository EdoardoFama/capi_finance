import { useMemo, useState } from 'react';
import { formatBRL } from '../format';

export type DistributionItem = {
  name: string;
  amount_cents: number;
  color?: string;
};

const PALETTE = [
  '#10b981', // emerald
  '#8b5cf6', // purple
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
  className = '',
}: Props) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Filtra itens com valor > 0 e ordena do maior para o menor
  const sortedItems = useMemo(() => {
    return (items || [])
      .map((it) => ({
        ...it,
        name: it.name || 'Sem categoria',
        amount_cents: Number(it.amount_cents || 0),
      }))
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

  const activeItem = hoveredIdx !== null ? sortedItems[hoveredIdx] : null;

  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-zinc-950/90 p-4 sm:p-5 shadow-xl shadow-black/40 backdrop-blur-sm ${className}`}>
      {/* Cabeçalho do Gráfico */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm sm:text-base font-bold tracking-tight text-white">{title}</h3>
            <span className="rounded-full bg-zinc-900 border border-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
              {sortedItems.length} {sortedItems.length === 1 ? 'categoria' : 'categorias'}
            </span>
          </div>
          {subtitle && <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>}
        </div>
        <div className="text-right">
          <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-semibold">
            {activeItem ? activeItem.name : 'Total analisado'}
          </p>
          <p className="text-base sm:text-lg font-extrabold text-white tabular-nums">
            {activeItem
              ? `${formatBRL(activeItem.amount_cents)} (${((activeItem.amount_cents / totalCents) * 100).toFixed(1)}%)`
              : formatBRL(totalCents)}
          </p>
        </div>
      </div>

      {/* Barra Multicolorida Segmentada Interativa */}
      <div className="mt-4">
        <div className="h-4 w-full overflow-hidden rounded-full bg-zinc-900 p-0.5 flex gap-0.5 ring-1 ring-inset ring-white/[0.06]">
          {sortedItems.map((it, idx) => {
            const pct = (it.amount_cents / totalCents) * 100;
            const isDimmed = hoveredIdx !== null && hoveredIdx !== idx;
            return (
              <div
                key={`segment-${it.name}-${idx}`}
                onMouseEnter={() => setHoveredIdx(idx)}
                onMouseLeave={() => setHoveredIdx(null)}
                style={{
                  width: `${Math.max(pct, 1.2)}%`,
                  backgroundColor: it.color,
                  opacity: isDimmed ? 0.3 : 1,
                }}
                className="h-full cursor-pointer transition-all duration-300 first:rounded-l-full last:rounded-r-full"
                title={`${it.name}: ${formatBRL(it.amount_cents)} (${pct.toFixed(1)}%)`}
              />
            );
          })}
        </div>
      </div>

      {/* Grid de Legendas com Mini Barra, Porcentagem e Valores */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {sortedItems.map((it, idx) => {
          const pct = (it.amount_cents / totalCents) * 100;
          const isHovered = hoveredIdx === idx;
          return (
            <div
              key={`legend-${it.name}-${idx}`}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={`group relative overflow-hidden rounded-xl border p-2.5 transition-all duration-200 ${
                isHovered
                  ? 'border-white/20 bg-zinc-900/90 shadow-md scale-[1.01]'
                  : 'border-white/[0.06] bg-zinc-900/35 hover:border-white/15 hover:bg-zinc-900/60'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="shrink-0 h-3 w-3 rounded-full ring-2 ring-white/10"
                    style={{ backgroundColor: it.color }}
                  />
                  <span className="truncate text-xs font-bold text-zinc-100" title={it.name}>
                    {it.name}
                  </span>
                </div>

                <span
                  className="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-extrabold tabular-nums"
                  style={{
                    backgroundColor: `${it.color}20`,
                    color: it.color,
                  }}
                >
                  {pct.toFixed(1)}%
                </span>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800/80">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      backgroundColor: it.color,
                    }}
                  />
                </div>
                <span className="text-[11px] font-semibold text-zinc-300 tabular-nums shrink-0">
                  {formatBRL(it.amount_cents)}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
