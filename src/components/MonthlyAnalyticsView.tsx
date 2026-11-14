import { useEffect, useMemo, useState } from 'react';
import { api, type MonthlyAnalyticsItem } from '../api';
import { formatBRL } from '../format';
import { Card, Spinner } from './ui';

export default function MonthlyAnalyticsView({ currentMonth }: { currentMonth: string }) {
  const [data, setData] = useState<MonthlyAnalyticsItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError('');
    api<MonthlyAnalyticsItem[]>(`/analytics/monthly?months=6&month=${currentMonth}`)
      .then((res) => {
        setData(res);
        if (res && res.length > 0) {
          setSelectedMonth(res[res.length - 1].month);
        }
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }, [currentMonth]);

  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    const totalExpenses = data.reduce((acc, curr) => acc + curr.expenses_cents, 0);
    const totalInflows = data.reduce((acc, curr) => acc + curr.inflows_cents, 0);
    const totalNet = totalInflows - totalExpenses;
    const avgExpenses = Math.round(totalExpenses / data.length);

    // Mês mais econômico (com gastos > 0) e mês mais alto
    const validExpenseMonths = data.filter((d) => d.expenses_cents > 0);
    const lowest = validExpenseMonths.length > 0
      ? validExpenseMonths.reduce((min, curr) => (curr.expenses_cents < min.expenses_cents ? curr : min), validExpenseMonths[0])
      : null;
    const highest = validExpenseMonths.length > 0
      ? validExpenseMonths.reduce((max, curr) => (curr.expenses_cents > max.expenses_cents ? curr : max), validExpenseMonths[0])
      : null;

    // Comparativo do mês atual vs mês anterior
    const currentItem = data[data.length - 1];
    const prevItem = data.length >= 2 ? data[data.length - 2] : null;
    let expenseDiffPct = 0;
    if (prevItem && prevItem.expenses_cents > 0) {
      expenseDiffPct = Math.round(
        ((currentItem.expenses_cents - prevItem.expenses_cents) / prevItem.expenses_cents) * 100
      );
    }

    // Valor máximo para escala do gráfico de barras
    const maxVal = Math.max(
      1,
      ...data.map((d) => Math.max(d.expenses_cents, d.inflows_cents))
    );

    return {
      totalExpenses,
      totalInflows,
      totalNet,
      avgExpenses,
      lowest,
      highest,
      expenseDiffPct,
      maxVal,
      currentItem,
      prevItem,
    };
  }, [data]);

  if (loading) return <Spinner />;

  if (error) {
    return (
      <div className="rounded-2xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-300">
        Falha ao carregar comparativo: {error}
      </div>
    );
  }

  if (!data || data.length === 0 || !stats) {
    return (
      <Card className="text-center py-12 text-zinc-500">
        Nenhum dado histórico encontrado para o período.
      </Card>
    );
  }

  const activeItem = data.find((d) => d.month === selectedMonth) || stats.currentItem;

  return (
    <div className="space-y-6">
      {/* Cards de Métricas Históricas */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/85 p-4 shadow-xl">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Média Mensal de Gastos
          </span>
          <p className="mt-1 text-lg sm:text-xl font-black text-white tabular-nums">
            {formatBRL(stats.avgExpenses)}
          </p>
          <span className="text-[11px] text-zinc-500 block mt-0.5">Últimos 6 meses</span>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/85 p-4 shadow-xl">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 block">
            Saldo Líquido Acumulado
          </span>
          <p className={`mt-1 text-lg sm:text-xl font-black tabular-nums ${
            stats.totalNet >= 0 ? 'text-emerald-400' : 'text-red-400'
          }`}>
            {stats.totalNet >= 0 ? '+' : ''}{formatBRL(stats.totalNet)}
          </p>
          <span className="text-[11px] text-zinc-500 block mt-0.5">Entradas menos saídas</span>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/85 p-4 shadow-xl">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Mês Mais Econômico
          </span>
          <p className="mt-1 text-lg sm:text-xl font-black text-teal-300 tabular-nums">
            {stats.lowest ? formatBRL(stats.lowest.expenses_cents) : '—'}
          </p>
          <span className="text-[11px] text-zinc-500 block mt-0.5">
            {stats.lowest?.month_label ?? 'Sem dados'}
          </span>
        </div>

        <div className="rounded-2xl border border-white/[0.08] bg-zinc-950/85 p-4 shadow-xl">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
            Variação vs Mês Anterior
          </span>
          <p className={`mt-1 text-lg sm:text-xl font-black tabular-nums ${
            stats.expenseDiffPct <= 0 ? 'text-emerald-400' : 'text-amber-400'
          }`}>
            {stats.expenseDiffPct > 0 ? `+${stats.expenseDiffPct}%` : `${stats.expenseDiffPct}%`}
          </p>
          <span className="text-[11px] text-zinc-500 block mt-0.5">
            {stats.expenseDiffPct <= 0 ? 'Gastou menos' : 'Gastou mais'} que o mês passado
          </span>
        </div>
      </div>

      {/* Gráfico Visual Comparativo: Entradas vs Saídas */}
      <Card className="p-5 sm:p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.06] pb-4">
          <div>
            <h3 className="text-base font-extrabold text-white">
              Evolução Mensal: Entradas vs Saídas
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Comparativo lado a lado de receitas e despesas nos últimos 6 meses
            </p>
          </div>
          {/* Legenda */}
          <div className="flex items-center gap-4 text-xs font-semibold">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-md bg-emerald-400 ring-2 ring-emerald-500/20" />
              <span className="text-zinc-300">Entradas</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-md bg-rose-500 ring-2 ring-rose-500/20" />
              <span className="text-zinc-300">Saídas</span>
            </div>
          </div>
        </div>

        {/* Barras do Gráfico */}
        <div className="grid grid-cols-6 gap-2 sm:gap-4 pt-4 pb-2 items-end h-64">
          {data.map((item) => {
            const inflowHeightPct = Math.max(4, Math.round((item.inflows_cents / stats.maxVal) * 100));
            const expenseHeightPct = Math.max(4, Math.round((item.expenses_cents / stats.maxVal) * 100));
            const isSelected = selectedMonth === item.month;

            return (
              <div
                key={item.month}
                onClick={() => setSelectedMonth(item.month)}
                className={`group flex flex-col items-center h-full justify-end cursor-pointer rounded-2xl p-2 transition-all ${
                  isSelected
                    ? 'bg-zinc-900/90 border border-emerald-500/30 ring-2 ring-emerald-500/20'
                    : 'hover:bg-zinc-900/40'
                }`}
              >
                {/* Barras Lado a Lado */}
                <div className="flex items-end justify-center gap-1.5 sm:gap-2.5 w-full h-44">
                  {/* Barra Entradas (Verde) */}
                  <div
                    style={{ height: `${inflowHeightPct}%` }}
                    className="w-full max-w-[20px] rounded-t-lg bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all duration-300 group-hover:brightness-110 shadow-lg shadow-emerald-500/20"
                    title={`Entradas: ${formatBRL(item.inflows_cents)}`}
                  />
                  {/* Barra Saídas (Rose) */}
                  <div
                    style={{ height: `${expenseHeightPct}%` }}
                    className="w-full max-w-[20px] rounded-t-lg bg-gradient-to-t from-rose-600 to-rose-400 transition-all duration-300 group-hover:brightness-110 shadow-lg shadow-rose-500/20"
                    title={`Saídas: ${formatBRL(item.expenses_cents)}`}
                  />
                </div>

                {/* Rótulo do Mês */}
                <span className={`text-[11px] sm:text-xs font-bold mt-2.5 transition ${
                  isSelected ? 'text-emerald-300' : 'text-zinc-400 group-hover:text-zinc-200'
                }`}>
                  {item.month_label}
                </span>

                {/* Saldo Líquido no Rodapé */}
                <span className={`text-[10px] font-extrabold tabular-nums mt-0.5 ${
                  item.net_cents >= 0 ? 'text-emerald-400' : 'text-red-400'
                }`}>
                  {item.net_cents >= 0 ? '+' : ''}{formatBRL(item.net_cents)}
                </span>
              </div>
            );
          })}
        </div>

        {/* Detalhe do Mês Selecionado */}
        {activeItem && (
          <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/60 p-4 flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-bold uppercase tracking-widest text-emerald-400">
                Mês em Destaque
              </span>
              <h4 className="text-base font-extrabold text-white mt-0.5">
                Resumo de {activeItem.month_label}
              </h4>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs font-semibold">
              <div>
                <span className="text-zinc-500 block text-[10px]">Entradas</span>
                <span className="text-emerald-400 font-bold">{formatBRL(activeItem.inflows_cents)}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">Saídas Totais</span>
                <span className="text-rose-400 font-bold">{formatBRL(activeItem.expenses_cents)}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">No Cartão de Crédito</span>
                <span className="text-purple-300 font-bold">{formatBRL(activeItem.credit_card_cents)}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">No Débito / Pix</span>
                <span className="text-blue-300 font-bold">{formatBRL(activeItem.debit_cents)}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">Saldo do Mês</span>
                <span className={`font-black ${activeItem.net_cents >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                  {activeItem.net_cents >= 0 ? '+' : ''}{formatBRL(activeItem.net_cents)}
                </span>
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* Tabela Comparativa Completa */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-white/[0.06] flex items-center justify-between">
          <h4 className="text-sm font-bold text-white">Tabela Comparativa Mês a Mês</h4>
          <span className="text-xs text-zinc-500">Últimos {data.length} meses</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900/60 text-zinc-400 uppercase text-[10px] tracking-wider font-semibold border-b border-white/[0.04]">
              <tr>
                <th className="px-4 py-3">Mês</th>
                <th className="px-4 py-3">Entradas</th>
                <th className="px-4 py-3">Saídas Totais</th>
                <th className="px-4 py-3">Cartão de Crédito</th>
                <th className="px-4 py-3">Débito / Pix</th>
                <th className="px-4 py-3">Investimentos</th>
                <th className="px-4 py-3 text-right">Saldo do Mês</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04] font-medium text-zinc-300">
              {data.map((row) => (
                <tr key={row.month} className="hover:bg-zinc-900/30 transition">
                  <td className="px-4 py-3 font-bold text-white">{row.month_label}</td>
                  <td className="px-4 py-3 text-emerald-400 font-semibold tabular-nums">
                    +{formatBRL(row.inflows_cents)}
                  </td>
                  <td className="px-4 py-3 text-rose-400 font-semibold tabular-nums">
                    -{formatBRL(row.expenses_cents)}
                  </td>
                  <td className="px-4 py-3 text-purple-300 tabular-nums">
                    {formatBRL(row.credit_card_cents)}
                  </td>
                  <td className="px-4 py-3 text-zinc-300 tabular-nums">
                    {formatBRL(row.debit_cents)}
                  </td>
                  <td className="px-4 py-3 text-teal-300 tabular-nums">
                    {row.investments_cents > 0 ? formatBRL(row.investments_cents) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={`inline-block rounded-md px-2 py-0.5 font-bold ${
                      row.net_cents >= 0
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                        : 'bg-red-500/15 text-red-300 border border-red-500/25'
                    }`}>
                      {row.net_cents >= 0 ? '+' : ''}{formatBRL(row.net_cents)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
