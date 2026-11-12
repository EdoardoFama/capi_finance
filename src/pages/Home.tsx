import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type Dashboard, type AccountBalance, type AccountId, ACCOUNT_DEFINITIONS } from '../api';
import { useMonth, useToast } from '../context';
import { formatBRL, parseBRL, percent, currentMonth } from '../format';
import {
  Card,
  IconCreditCard,
  IconList,
  IconPlus,
  IconWallet,
  MonthPicker,
  ProgressBar,
  Spinner,
  textColor,
} from '../components/ui';

function AccountCard({
  account,
  month,
  onUpdate,
}: {
  account: AccountBalance;
  month: string;
  onUpdate: (accountId: AccountId, newInitialCents: number) => void;
}) {
  const info = ACCOUNT_DEFINITIONS.find((a) => a.id === account.account_id) ?? {
    id: account.account_id,
    name: account.name,
    tag: account.name,
    color: '#10b981',
    badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700',
    borderClass: 'border-zinc-800',
  };

  const toast = useToast();
  const [val, setVal] = useState(
    account.initial_cents ? (account.initial_cents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setVal(account.initial_cents ? (account.initial_cents / 100).toFixed(2).replace('.', ',') : '');
  }, [account.initial_cents]);

  async function handleSave() {
    const parsed = parseBRL(val);
    const newCents = parsed ?? 0;
    if (newCents === account.initial_cents) return;

    setIsSaving(true);
    try {
      await api('/accounts/balance', {
        method: 'PUT',
        body: { month, account_id: account.account_id, initial_cents: newCents },
      });
      onUpdate(account.account_id, newCents);
      toast(`Saldo de ${info.name} atualizado!`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  const isNegative = account.current_cents < 0;
  const spentPct =
    account.initial_cents > 0
      ? Math.min(100, Math.round((account.spent_cents / account.initial_cents) * 100))
      : account.spent_cents > 0
      ? 100
      : 0;

  return (
    <div
      className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-950/90 p-4 shadow-lg transition-all duration-200 hover:border-white/20 hover:shadow-xl"
      style={{
        backgroundImage: `radial-gradient(circle at 100% 0%, ${info.color}18, transparent 65%)`,
      }}
    >
      <div>
        {/* Header da Conta */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/10"
              style={{ backgroundColor: info.color }}
            />
            <span className="truncate text-xs font-extrabold tracking-wider text-zinc-200 uppercase">
              {info.name}
            </span>
          </div>
          <Link
            to={`/lancar?conta=${account.account_id}`}
            title={`Lançar gasto em ${info.name}`}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.06] bg-zinc-900/80 text-zinc-400 transition hover:border-emerald-500/40 hover:bg-emerald-500/15 hover:text-emerald-300"
          >
            <IconPlus className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Saldo Atual (Restante) */}
        <div className="mt-3.5">
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            Saldo Disponível
          </p>
          <p
            className={`mt-0.5 text-2xl font-extrabold tracking-tight tabular-nums ${
              isNegative ? 'text-red-400' : 'text-white'
            }`}
          >
            {formatBRL(account.current_cents)}
          </p>
        </div>

        {/* Barra de progresso de consumo */}
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900 ring-1 ring-inset ring-white/[0.05]">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isNegative ? 'bg-red-500' : ''}`}
              style={{
                width: `${spentPct}%`,
                backgroundColor: isNegative ? undefined : info.color,
              }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium text-zinc-500">
            <span>{spentPct}% usado</span>
            <span className="tabular-nums">
              {account.spent_cents > 0 ? `-${formatBRL(account.spent_cents)}` : 'Sem gastos'}
            </span>
          </div>
        </div>
      </div>

      {/* Campo aberto para editar o Saldo em Conta */}
      <div className="mt-3.5 border-t border-white/[0.06] pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-medium text-zinc-400">Saldo base:</label>
          <div className="relative flex items-center rounded-lg border border-white/[0.08] bg-zinc-900/90 px-2 py-1 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-400">
            <span className="text-[10px] font-semibold text-zinc-500 mr-1 select-none">R$</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={val}
              onChange={(e) => setVal(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              disabled={isSaving}
              className="w-20 bg-transparent text-right text-xs font-bold text-zinc-100 tabular-nums outline-none disabled:opacity-50"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { month } = useMonth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');
  const [fixedFilter, setFixedFilter] = useState<'all' | 'available' | 'done'>('all');

  const loadDashboard = useCallback(() => {
    let alive = true;
    setError('');
    api<Dashboard>(`/dashboard?month=${month}`)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [month]);

  useEffect(() => {
    setData(null);
    return loadDashboard();
  }, [loadDashboard]);

  function handleAccountInitialUpdate(accountId: AccountId, newInitialCents: number) {
    setData((prev) => {
      if (!prev) return prev;
      const updatedAccounts = (prev.accounts ?? []).map((acc) => {
        if (acc.account_id === accountId) {
          return {
            ...acc,
            initial_cents: newInitialCents,
            spent_cents: 0,
            current_cents: newInitialCents,
          };
        }
        return acc;
      });
      return { ...prev, accounts: updatedAccounts };
    });
  }

  // Cálculos de Resumo Inteligente
  const metrics = useMemo(() => {
    if (!data) return null;
    const fixedCats = data.categories.filter((c) => c.is_fixed === 1);
    const variableCats = data.categories.filter((c) => c.is_fixed === 0);

    // Quanto ainda falta gastar nas categorias fixas que não estouraram
    const fixedRemaining = fixedCats.reduce(
      (acc, c) => acc + Math.max(0, c.budget_cents - c.spent_cents),
      0,
    );
    const porForaRemaining = data.por_fora_remaining_cents;
    // Potencial total ainda disponível no mês (Fixos pendentes + Por Fora restante)
    const totalAvailableToSpend = Math.max(0, fixedRemaining + porForaRemaining);

    // Soma dos saldos atuais das contas
    const totalAccountBalances = (data.accounts ?? []).reduce(
      (acc, a) => acc + Math.max(0, a.current_cents),
      0,
    );

    // Dias restantes no mês para cálculo de ritmo diário do "Por Fora"
    const now = new Date();
    const isCurrentMonth = month === currentMonth();
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const daysLeft = isCurrentMonth ? Math.max(1, daysInMonth - now.getDate() + 1) : daysInMonth;
    const dailyPorFora = porForaRemaining > 0 ? Math.floor(porForaRemaining / daysLeft) : 0;

    return {
      fixedCats,
      variableCats,
      fixedRemaining,
      porForaRemaining,
      totalAvailableToSpend,
      totalAccountBalances,
      daysLeft,
      dailyPorFora,
      isCurrentMonth,
    };
  }, [data, month]);

  const totalPct = data ? percent(data.total_spent_cents, data.total_income_cents || data.total_budget_cents) : 0;

  const displayedFixedCats = useMemo(() => {
    if (!metrics) return [];
    if (fixedFilter === 'available') {
      return metrics.fixedCats.filter((c) => c.spent_cents < c.budget_cents);
    }
    if (fixedFilter === 'done') {
      return metrics.fixedCats.filter((c) => c.spent_cents >= c.budget_cents);
    }
    return metrics.fixedCats;
  }, [metrics, fixedFilter]);

  return (
    <div className="space-y-6">
      {/* Seletor de Mês */}
      <MonthPicker />

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}
      {!data && !error && <Spinner />}

      {data && metrics && (
        <>
          {/* ================= HERO CARD: VISÃO EXECUTIVA DO MÊS ================= */}
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.09] bg-gradient-to-br from-zinc-900/95 via-zinc-950 to-black p-5 sm:p-6 shadow-2xl">
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -left-16 -bottom-16 h-56 w-56 rounded-full bg-purple-500/10 blur-3xl" />

            <div className="relative flex flex-col gap-5">
              {/* Topo do Hero */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-emerald-300 uppercase">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    Balanço Mensal
                  </span>
                  <p className="mt-2.5 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                    Gasto Total Acumulado
                  </p>
                  <div className="mt-0.5 flex items-baseline gap-3">
                    <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums">
                      {formatBRL(data.total_spent_cents)}
                    </h1>
                    <span className={`rounded-lg px-2 py-0.5 text-xs font-extrabold border ${
                      totalPct >= 100
                        ? 'bg-red-500/15 text-red-300 border-red-500/30'
                        : totalPct >= 80
                        ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                        : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    }`}>
                      {totalPct}% da renda
                    </span>
                  </div>
                </div>

                {/* Destaque: Quanto ainda pode gastar no mês */}
                <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/70 px-4 py-3 sm:text-right backdrop-blur-md">
                  <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Disponível no Orçamento
                  </p>
                  <p className="mt-0.5 text-xl sm:text-2xl font-extrabold text-emerald-400 tabular-nums">
                    {formatBRL(metrics.totalAvailableToSpend)}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {formatBRL(metrics.fixedRemaining)} nos fixos + {formatBRL(Math.max(0, metrics.porForaRemaining))} por fora
                  </p>
                </div>
              </div>

              {/* Barra de Progresso Geral */}
              <div>
                <ProgressBar
                  spent={data.total_spent_cents}
                  budget={data.total_income_cents || data.total_budget_cents}
                  className="h-3"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                  <span>
                    Fixos consumidos: <strong className="text-zinc-200">{formatBRL(data.fixed_spent_cents)}</strong> de {formatBRL(data.fixed_budget_cents)}
                  </span>
                  <span>
                    Variáveis (Por Fora): <strong className="text-purple-300">{formatBRL(data.variable_spent_cents)}</strong>
                  </span>
                </div>
              </div>

              {/* 3 Pilares do Orçamento */}
              <div className="grid grid-cols-3 gap-2.5 border-t border-white/[0.07] pt-4">
                <div className="rounded-xl bg-zinc-900/50 border border-white/[0.05] p-3">
                  <p className="text-[10px] sm:text-xs font-medium text-zinc-400">Ganhos Previstos</p>
                  <p className="mt-1 text-sm sm:text-lg font-extrabold text-emerald-400 tabular-nums">
                    {formatBRL(data.total_income_cents)}
                  </p>
                </div>
                <div className="rounded-xl bg-zinc-900/50 border border-white/[0.05] p-3">
                  <p className="text-[10px] sm:text-xs font-medium text-zinc-400">Teto Fixos</p>
                  <p className="mt-1 text-sm sm:text-lg font-extrabold text-blue-300 tabular-nums">
                    {formatBRL(data.fixed_budget_cents)}
                  </p>
                </div>
                <div className="rounded-xl bg-zinc-900/50 border border-white/[0.05] p-3">
                  <p className="text-[10px] sm:text-xs font-medium text-zinc-400">Livre "Por Fora"</p>
                  <p
                    className={`mt-1 text-sm sm:text-lg font-extrabold tabular-nums ${
                      data.por_fora_remaining_cents < 0 ? 'text-red-400' : 'text-purple-300'
                    }`}
                  >
                    {formatBRL(data.por_fora_remaining_cents)}
                  </p>
                </div>
              </div>

              {/* Ações Rápidas */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <Link
                  to="/lancar"
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-400 py-2.5 px-3 text-xs font-bold text-black shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 active:scale-[0.99]"
                >
                  <IconPlus className="h-4 w-4 stroke-[2.5]" />
                  <span>Lançar Gasto</span>
                </Link>
                <Link
                  to="/cartao"
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-purple-500/30 bg-purple-500/10 py-2.5 px-3 text-xs font-semibold text-purple-200 transition hover:bg-purple-500/20"
                >
                  <IconCreditCard className="h-4 w-4 text-purple-300" />
                  <span>Ver Fatura</span>
                </Link>
                <Link
                  to="/extrato"
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-900/80 py-2.5 px-3 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
                >
                  <IconList className="h-4 w-4 text-zinc-400" />
                  <span>Extrato</span>
                </Link>
              </div>
            </div>
          </div>

          {/* ================= SALDO EM CONTA & BENEFÍCIOS ================= */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <IconWallet className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold tracking-tight text-white">
                    Contas & Vale-Benefícios
                  </h2>
                  <p className="text-[11px] text-zinc-500">
                    Toque no saldo base para redefinir quando cair dinheiro novo
                  </p>
                </div>
              </div>
              <div className="rounded-xl border border-white/[0.07] bg-zinc-900/70 px-3 py-1.5 text-right">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 block">
                  Soma disponível
                </span>
                <span className="text-xs font-extrabold text-emerald-400 tabular-nums">
                  {formatBRL(metrics.totalAccountBalances)}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {(data.accounts ?? []).map((acc) => (
                <AccountCard
                  key={acc.account_id}
                  account={acc}
                  month={month}
                  onUpdate={handleAccountInitialUpdate}
                />
              ))}
            </div>
          </section>

          {/* ================= CATEGORIAS FIXAS ================= */}
          <section className="space-y-3 pt-1">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 ring-4 ring-blue-500/15" />
                  <h2 className="text-base font-bold text-white">Categorias Fixas</h2>
                  <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-[10px] font-bold text-blue-300 border border-blue-500/25">
                    {formatBRL(data.fixed_spent_cents)} / {formatBRL(data.fixed_budget_cents)}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Despesas planejadas com meta ou teto mensal. Clique em uma categoria para lançar.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {/* Filtro rápido de Fixas */}
                <div className="flex rounded-xl border border-white/[0.07] bg-zinc-950 p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setFixedFilter('all')}
                    className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                      fixedFilter === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Todas ({metrics.fixedCats.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFixedFilter('available')}
                    className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                      fixedFilter === 'available' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Com saldo ({metrics.fixedCats.filter((c) => c.spent_cents < c.budget_cents).length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFixedFilter('done')}
                    className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                      fixedFilter === 'done' ? 'bg-blue-500/20 text-blue-300' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Quitadas ({metrics.fixedCats.filter((c) => c.spent_cents >= c.budget_cents).length})
                  </button>
                </div>

                <Link
                  to="/orcamento"
                  className="rounded-xl border border-white/[0.08] bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                >
                  Configurar
                </Link>
              </div>
            </div>

            {displayedFixedCats.length === 0 ? (
              <Card className="text-center text-sm text-zinc-500 py-8">
                Nenhuma categoria fixa encontrada neste filtro.
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {displayedFixedCats.map((c) => {
                  const pct = percent(c.spent_cents, c.budget_cents);
                  const left = c.budget_cents - c.spent_cents;
                  return (
                    <Link key={c.id} to={`/lancar?categoria=${c.id}`} className="group block">
                      <Card className="h-full transition-all duration-200 hover:border-white/20 hover:bg-zinc-900/50 active:scale-[0.99]">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="truncate font-bold text-zinc-100 group-hover:text-emerald-300 transition">
                                {c.name}
                              </p>
                              {c.count > 0 && (
                                <span className="shrink-0 rounded-full bg-zinc-900 border border-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                                  {c.count}x
                                </span>
                              )}
                            </div>
                            {c.note && (
                              <p className="truncate text-[11px] text-zinc-500 mt-0.5" title={c.note}>
                                {c.note}
                              </p>
                            )}
                          </div>
                          <span
                            className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-extrabold tabular-nums ${textColor(
                              pct,
                            )} bg-zinc-900/90 border border-white/[0.05]`}
                          >
                            {pct}%
                          </span>
                        </div>

                        <ProgressBar spent={c.spent_cents} budget={c.budget_cents} className="mt-3 h-2" />

                        <div className="mt-2.5 flex items-center justify-between text-xs">
                          <span className="text-zinc-300 font-semibold tabular-nums">
                            {formatBRL(c.spent_cents)}{' '}
                            <span className="text-zinc-500 font-normal">/ {formatBRL(c.budget_cents)}</span>
                          </span>
                          <span
                            className={`font-semibold tabular-nums ${
                              left < 0 ? 'text-red-400' : left === 0 ? 'text-zinc-500' : 'text-emerald-400/90'
                            }`}
                          >
                            {left < 0
                              ? `Excedeu ${formatBRL(-left)}`
                              : left === 0
                              ? 'Meta atingida ✓'
                              : `Resta ${formatBRL(left)}`}
                          </span>
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>

          {/* ================= CATEGORIAS VARIÁVEIS (POR FORA) ================= */}
          <section className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-purple-500 ring-4 ring-purple-500/15" />
                  <h2 className="text-base font-bold text-white">Categorias Variáveis ("Por Fora")</h2>
                  <span className="rounded-full bg-purple-500/15 px-2.5 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/25">
                    Saldo Livre
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Despesas flexíveis que consomem o saldo livre (Ganhos − Teto Fixo)
                </p>
              </div>
            </div>

            {/* Card Resumo do 'Por Fora' */}
            <div className="relative overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-zinc-950 via-zinc-950 to-purple-950/30 p-5 shadow-xl">
              <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-purple-600/10 blur-2xl" />

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-b border-white/[0.06] pb-4">
                <div>
                  <p className="text-[11px] text-purple-300 uppercase font-bold tracking-wider">
                    Orçamento "Por Fora"
                  </p>
                  <p className="text-2xl font-extrabold tracking-tight text-white mt-0.5 tabular-nums">
                    {formatBRL(data.por_fora_budget_cents)}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">Ganhos − Fixos previstos</p>
                </div>

                <div>
                  <p className="text-[11px] text-zinc-400 uppercase font-bold tracking-wider">
                    Já Consumido
                  </p>
                  <p className="text-2xl font-extrabold text-purple-300 mt-0.5 tabular-nums">
                    {formatBRL(data.por_fora_spent_cents)}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {data.por_fora_budget_cents > 0
                      ? `${percent(data.por_fora_spent_cents, data.por_fora_budget_cents)}% do saldo livre`
                      : 'Sem margem'}
                  </p>
                </div>

                <div className="sm:text-right">
                  <p className="text-[11px] text-zinc-400 uppercase font-bold tracking-wider">
                    Saldo Livre Restante
                  </p>
                  <p
                    className={`text-2xl font-extrabold mt-0.5 tabular-nums ${
                      data.por_fora_remaining_cents < 0 ? 'text-red-400' : 'text-emerald-400'
                    }`}
                  >
                    {formatBRL(data.por_fora_remaining_cents)}
                  </p>
                  {metrics.dailyPorFora > 0 && (
                    <p className="text-[11px] text-emerald-400/80 mt-0.5">
                      ~{formatBRL(metrics.dailyPorFora)}/dia ({metrics.daysLeft}d restantes)
                    </p>
                  )}
                </div>
              </div>

              {/* Barra de Progresso do Por Fora */}
              <div className="mt-4">
                <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-900 ring-1 ring-inset ring-white/[0.06]">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      data.por_fora_remaining_cents < 0
                        ? 'bg-gradient-to-r from-red-500 to-rose-500'
                        : 'bg-gradient-to-r from-purple-500 to-indigo-400'
                    }`}
                    style={{
                      width: `${
                        data.por_fora_budget_cents > 0
                          ? Math.min(100, Math.round((data.por_fora_spent_cents / data.por_fora_budget_cents) * 100))
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Grid das Categorias Variáveis com o consumo de cada uma */}
            {metrics.variableCats.length === 0 ? (
              <Card className="text-center text-sm text-zinc-500">
                Nenhuma categoria variável cadastrada.{' '}
                <Link to="/orcamento" className="text-purple-400 hover:underline">
                  Criar categoria variável
                </Link>
                .
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {metrics.variableCats.map((c) => {
                  const sharePct =
                    data.por_fora_budget_cents > 0
                      ? Math.round((c.spent_cents / data.por_fora_budget_cents) * 100)
                      : 0;
                  return (
                    <Link key={c.id} to={`/lancar?categoria=${c.id}`} className="group block">
                      <Card className="h-full transition-all duration-200 hover:border-purple-500/40 hover:bg-zinc-900/50 active:scale-[0.99]">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate font-bold text-zinc-100 group-hover:text-purple-300 transition">
                              {c.name}
                            </p>
                            <p className="text-[11px] text-zinc-500">
                              {c.count} {c.count === 1 ? 'lançamento' : 'lançamentos'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-extrabold text-base text-purple-300 tabular-nums">
                              {formatBRL(c.spent_cents)}
                            </p>
                            {data.por_fora_budget_cents > 0 && c.spent_cents > 0 && (
                              <p className="text-[10px] font-semibold text-purple-400/80">
                                {sharePct}% do Por Fora
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                          <div
                            className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-500 rounded-full transition-all duration-500"
                            style={{ width: `${Math.min(100, sharePct)}%` }}
                          />
                        </div>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      {/* Botão flutuante (desktop) */}
      <Link
        to="/lancar"
        className="fixed right-6 bottom-6 z-20 hidden items-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 px-5 py-3.5 text-sm font-bold text-black shadow-xl shadow-emerald-500/25 transition hover:scale-105 hover:brightness-110 active:scale-95 md:flex"
      >
        <IconPlus className="h-5 w-5 stroke-[2.5]" /> Lançar gasto
      </Link>
    </div>
  );
}
