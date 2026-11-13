import { useMemo, useState } from 'react';
import { formatBRL } from '../format';
import { IconArrowDownLeft, IconEdit, IconTrash } from './ui';

export type DistributionItem = {
  id?: number;
  name: string;
  amount_cents: number;
  color?: string;
  onRedeem?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
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

  // Mapeia todos os itens (não remove os com saldo 0 para permitir visualizar e gerenciar todas as corretoras)
  const allItems = useMemo(() => {
    return (items || []).map((it, idx) => ({
      ...it,
      name: it.name || 'Sem nome',
      amount_cents: Math.max(0, Number(it.amount_cents || 0)),
      color: it.color || getPaletteColor(idx),
    }));
  }, [items]);

  const totalCents = useMemo(() => {
    return allItems.reduce((acc, it) => acc + it.amount_cents, 0);
  }, [allItems]);

  // Itens com saldo positivo para a barra colorida proporcional
  const positiveItems = useMemo(() => {
    return allItems.filter((it) => it.amount_cents > 0);
  }, [allItems]);

  if (!items || items.length === 0) {
    return null;
  }

  const activeItem = hoveredIdx !== null ? allItems[hoveredIdx] : null;

  return (
    <div className={`rounded-2xl border border-white/[0.08] bg-zinc-950/90 p-4 sm:p-5 shadow-xl shadow-black/40 backdrop-blur-sm ${className}`}>
      {/* Cabeçalho do Gráfico */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm sm:text-base font-bold tracking-tight text-white">{title}</h3>
            <span className="rounded-full bg-zinc-900 border border-white/[0.07] px-2 py-0.5 text-[10px] font-semibold text-zinc-400">
              {allItems.length} {allItems.length === 1 ? 'instituição' : 'instituições'}
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
              ? `${formatBRL(activeItem.amount_cents)}${
                  totalCents > 0
                    ? ` (${((activeItem.amount_cents / totalCents) * 100).toFixed(1)}%)`
                    : ''
                }`
              : formatBRL(totalCents)}
          </p>
        </div>
      </div>

      {/* Barra Multicolorida Segmentada Interativa */}
      <div className="mt-4">
        <div className="h-4 w-full overflow-hidden rounded-full bg-zinc-900 p-0.5 flex gap-0.5 ring-1 ring-inset ring-white/[0.06]">
          {positiveItems.length === 0 ? (
            <div className="h-full w-full rounded-full bg-zinc-900 flex items-center justify-center text-[10px] text-zinc-600 font-medium">
              Sem saldo distribuído neste período
            </div>
          ) : (
            positiveItems.map((it, idx) => {
              const pct = totalCents > 0 ? (it.amount_cents / totalCents) * 100 : 0;
              const isDimmed = hoveredIdx !== null && allItems[hoveredIdx]?.name !== it.name;
              return (
                <div
                  key={`segment-${it.name}-${idx}`}
                  onMouseEnter={() => setHoveredIdx(allItems.findIndex((a) => a.name === it.name))}
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
            })
          )}
        </div>
      </div>

      {/* Grid de Cards ("Quadradinhos") de Cada Carteira / Corretora */}
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {allItems.map((it, idx) => {
          const pct = totalCents > 0 ? (it.amount_cents / totalCents) * 100 : 0;
          const isHovered = hoveredIdx === idx;
          return (
            <div
              key={`legend-${it.name}-${idx}`}
              onMouseEnter={() => setHoveredIdx(idx)}
              onMouseLeave={() => setHoveredIdx(null)}
              className={`group relative overflow-hidden rounded-xl border p-3 transition-all duration-200 ${
                isHovered
                  ? 'border-white/20 bg-zinc-900/90 shadow-md scale-[1.01]'
                  : 'border-white/[0.06] bg-zinc-900/35 hover:border-white/15 hover:bg-zinc-900/60'
              }`}
            >
              {/* Topo do Card: Nome, Ações de Edição e Porcentagem */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="shrink-0 h-3 w-3 rounded-full ring-2 ring-white/10"
                    style={{ backgroundColor: it.color }}
                  />
                  <span className="truncate text-xs font-bold text-zinc-100" title={it.name}>
                    {it.name}
                  </span>
                  {/* Botões de Ação rápida (Editar / Excluir Corretora) */}
                  <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100 transition">
                    {it.onEdit && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          it.onEdit?.();
                        }}
                        className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition"
                        title={`Editar corretora ${it.name}`}
                      >
                        <IconEdit className="h-3 w-3" />
                      </button>
                    )}
                    {it.onDelete && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          it.onDelete?.();
                        }}
                        className="rounded p-1 text-zinc-500 hover:bg-red-500/20 hover:text-red-400 transition"
                        title={`Excluir corretora ${it.name}`}
                      >
                        <IconTrash className="h-3 w-3" />
                      </button>
                    )}
                  </div>
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

              {/* Barra de Progresso e Valor */}
              <div className="mt-2.5 flex items-center justify-between gap-2">
                <div className="h-1 flex-1 overflow-hidden rounded-full bg-zinc-800/80">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, pct)}%`,
                      backgroundColor: it.color,
                    }}
                  />
                </div>
                <span className="text-xs font-bold text-zinc-100 tabular-nums shrink-0">
                  {formatBRL(it.amount_cents)}
                </span>
              </div>

              {/* Botão de SAQUE direto no Quadradinho */}
              {it.onRedeem && (
                <div className="mt-3 pt-2.5 border-t border-white/[0.06] flex items-center justify-end">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      it.onRedeem?.();
                    }}
                    disabled={it.amount_cents <= 0}
                    className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition active:scale-95 ${
                      it.amount_cents > 0
                        ? 'border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 hover:border-amber-500/50'
                        : 'border border-white/[0.06] bg-zinc-900 text-zinc-600 cursor-not-allowed'
                    }`}
                    title={
                      it.amount_cents > 0
                        ? `Sacar / Resgatar de ${it.name}`
                        : `Sem saldo disponível para saque em ${it.name}`
                    }
                  >
                    <IconArrowDownLeft className="h-3.5 w-3.5" />
                    <span>Sacar</span>
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
