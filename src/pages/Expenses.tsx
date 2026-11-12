import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, type Dashboard, type Expense, type PaymentMethod, type AccountId, ACCOUNT_DEFINITIONS } from '../api';
import { useMonth, useToast } from '../context';
import { dayLabel, formatBRL, parseBRL, percent, todayISO } from '../format';
import { Card, IconEdit, IconTrash, Input, MonthPicker, PageTitle, ProgressBar, Spinner, textColor } from '../components/ui';
import EditExpenseModal from '../components/EditExpenseModal';

export default function Expenses() {
  const { month, setMonth } = useMonth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [dash, setDash] = useState<Dashboard | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(Number(params.get('categoria')) || null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayISO);
  const [accountId, setAccountId] = useState<AccountId>(
    (params.get('conta') as AccountId) &&
      ['nubank', 'pluxe_alimentacao', 'pluxe_refeicao', 'alelo'].includes(params.get('conta') as string)
      ? (params.get('conta') as AccountId)
      : 'nubank',
  );
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    params.get('conta') && params.get('conta') !== 'nubank' ? 'voucher' : 'debit',
  );
  const [installments, setInstallments] = useState(1);
  const [isInstallmentModalOpen, setIsInstallmentModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [d, e] = await Promise.all([
      api<Dashboard>(`/dashboard?month=${month}`),
      api<Expense[]>(`/expenses?month=${month}`),
    ]);
    setDash(d);
    setExpenses(e);
  }, [month]);

  useEffect(() => {
    setExpenses(null);
    load().catch((e) => toast(e.message, 'error'));
  }, [load, toast]);

  useEffect(() => {
    if (params.has('categoria') || params.has('conta')) {
      setParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = dash?.categories.find((c) => c.id === categoryId);

  function handleSelectPaymentMethod(method: PaymentMethod) {
    setPaymentMethod(method);
    if (method === 'credit') {
      setIsInstallmentModalOpen(true);
    } else {
      setInstallments(1);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (!cents) return toast('Informe um valor válido', 'error');
    if (!title.trim()) return toast('Informe o título do gasto', 'error');
    if (!categoryId) return toast('Escolha uma categoria', 'error');
    setBusy(true);
    try {
      await api<Expense>('/expenses', {
        method: 'POST',
        body: {
          amount_cents: cents,
          category_id: categoryId,
          title: title.trim(),
          description: description.trim(),
          spent_on: date,
          account_id: accountId,
          payment_method: paymentMethod,
          installments: accountId === 'nubank' && paymentMethod === 'credit' ? installments : 1,
        },
      });

      const accInfo = ACCOUNT_DEFINITIONS.find((a) => a.id === accountId);
      if (accountId === 'nubank' && paymentMethod === 'credit' && installments > 1) {
        toast(`${formatBRL(cents)} parcelado em ${installments}x de ${formatBRL(Math.round(cents / installments))}`);
      } else {
        toast(`${formatBRL(cents)} lançado em ${accInfo?.name ?? 'Conta'}`);
      }

      setAmount('');
      setTitle('');
      setDescription('');
      if (accountId === 'nubank') {
        setPaymentMethod('debit');
      }
      setInstallments(1);

      if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7));
      else await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(exp: Expense) {
    if (exp.installment_total > 1 && exp.installment_group_id) {
      const deleteAll = confirm(
        `Este gasto é parcelado (${exp.installment_current}/${exp.installment_total}).\n\n` +
          `Deseja excluir TODAS as ${exp.installment_total} parcelas?\n\n` +
          `[OK] = Excluir todas as parcelas\n[Cancelar] = Excluir apenas esta parcela`,
      );
      try {
        await api(`/expenses/${exp.id}?all_installments=${deleteAll}`, { method: 'DELETE' });
        toast(deleteAll ? 'Todas as parcelas foram excluídas' : 'Parcela excluída');
        await load();
      } catch (err) {
        toast((err as Error).message, 'error');
      }
      return;
    }

    if (!confirm(`Excluir ${formatBRL(exp.amount_cents)} de ${exp.category_name}?`)) return;
    try {
      await api(`/expenses/${exp.id}`, { method: 'DELETE' });
      toast('Lançamento excluído');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of expenses ?? []) map.set(e.spent_on, [...(map.get(e.spent_on) ?? []), e]);
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [expenses]);

  const fixedCategories = useMemo(
    () => (dash?.categories ?? []).filter((c) => c.is_fixed === 1),
    [dash],
  );
  const variableCategories = useMemo(
    () => (dash?.categories ?? []).filter((c) => c.is_fixed === 0),
    [dash],
  );

  const parsedAmount = parseBRL(amount) ?? 0;
  const currentInstallmentValue = parsedAmount
    ? paymentMethod === 'credit' && installments > 1
      ? Math.round(parsedAmount / installments)
      : parsedAmount
    : 0;

  return (
    <div className="space-y-5">
      <PageTitle
        title="Novo Lançamento"
        subtitle="Registre um gasto e acompanhe o impacto imediato no seu orçamento"
      />

      <Card className="!p-5 sm:!p-6">
        <form onSubmit={submit} className="space-y-5">
          {/* 1. VALOR EM DESTAQUE */}
          <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-zinc-900/90 to-zinc-950 p-4 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20 transition">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                Valor do Gasto
              </label>
              {accountId === 'nubank' && paymentMethod === 'credit' && installments > 1 && (
                <button
                  type="button"
                  onClick={() => setIsInstallmentModalOpen(true)}
                  className="rounded-full bg-purple-500/20 border border-purple-500/40 px-2.5 py-0.5 text-xs font-bold text-purple-300 hover:bg-purple-500/30 transition"
                >
                  {installments}x {parsedAmount ? `de ${formatBRL(currentInstallmentValue)}` : ''} • alterar
                </button>
              )}
            </div>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-emerald-400 select-none">R$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className="w-full bg-transparent py-1 text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums outline-none placeholder:text-zinc-700"
              />
            </div>
          </div>

          {/* 2. CONTA E FORMA DE PAGAMENTO */}
          <div className="space-y-2.5">
            <label className="block text-xs font-bold tracking-wider text-zinc-400 uppercase">
              Origem do Pagamento (Conta / Benefício)
            </label>

            {/* 4 Mostradores/Botões de Conta */}
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {ACCOUNT_DEFINITIONS.map((acc) => {
                const active = accountId === acc.id;
                const accBalance = dash?.accounts?.find((a) => a.account_id === acc.id);
                return (
                  <button
                    type="button"
                    key={acc.id}
                    onClick={() => {
                      setAccountId(acc.id);
                      if (acc.id !== 'nubank') {
                        setPaymentMethod('voucher');
                        setInstallments(1);
                      } else if (paymentMethod === 'voucher') {
                        setPaymentMethod('debit');
                      }
                    }}
                    className={`flex flex-col items-start justify-between rounded-2xl border p-3 text-left transition-all ${
                      active
                        ? `${acc.badgeClass} ring-2 ring-current border-current shadow-lg`
                        : 'border-white/[0.07] bg-zinc-900/70 text-zinc-400 hover:border-white/15 hover:bg-zinc-900'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: acc.color }}
                      />
                      <span className="font-extrabold text-[11px] sm:text-xs text-zinc-100 truncate">
                        {acc.tag}
                      </span>
                    </div>
                    <span className="mt-2 text-[11px] font-semibold tabular-nums text-zinc-400">
                      {accBalance ? formatBRL(accBalance.current_cents) : '—'}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Sub-opções se a conta for Nubank */}
            {accountId === 'nubank' && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleSelectPaymentMethod('debit')}
                  className={`flex flex-col items-center justify-center rounded-xl border py-2.5 text-xs font-bold transition ${
                    paymentMethod === 'debit'
                      ? 'border-purple-400 bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/50'
                      : 'border-white/[0.07] bg-zinc-900/50 text-zinc-400 hover:border-white/15'
                  }`}
                >
                  <span>Débito</span>
                  <span className="text-[10px] font-normal text-zinc-500">Abate na hora</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectPaymentMethod('pix')}
                  className={`flex flex-col items-center justify-center rounded-xl border py-2.5 text-xs font-bold transition ${
                    paymentMethod === 'pix'
                      ? 'border-purple-400 bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/50'
                      : 'border-white/[0.07] bg-zinc-900/50 text-zinc-400 hover:border-white/15'
                  }`}
                >
                  <span>Pix</span>
                  <span className="text-[10px] font-normal text-zinc-500">Transferência</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectPaymentMethod('credit')}
                  className={`flex flex-col items-center justify-center rounded-xl border py-2.5 text-xs font-bold transition ${
                    paymentMethod === 'credit'
                      ? 'border-purple-400 bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/50'
                      : 'border-white/[0.07] bg-zinc-900/50 text-zinc-400 hover:border-white/15'
                  }`}
                >
                  <span>Crédito</span>
                  <span className="text-[10px] font-normal text-zinc-400">
                    {installments > 1 ? `${installments}x parcelas` : 'Vai p/ fatura'}
                  </span>
                </button>
              </div>
            )}
          </div>

          {/* 3. SELEÇÃO DE CATEGORIA (AGRUPADA POR FIXAS E VARIÁVEIS) */}
          <div className="space-y-3">
            <label className="block text-xs font-bold tracking-wider text-zinc-400 uppercase">
              Categoria do Gasto <span className="text-emerald-400">*</span>
            </label>

            {!dash ? (
              <p className="text-sm text-zinc-500">Carregando categorias…</p>
            ) : dash.categories.length === 0 ? (
              <p className="text-sm text-zinc-500">Crie categorias na tela de Orçamento.</p>
            ) : (
              <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-3.5">
                {/* Fixas */}
                {fixedCategories.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                      Fixas (Com Meta / Teto)
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {fixedCategories.map((c) => {
                        const pct = percent(c.spent_cents, c.budget_cents);
                        const active = c.id === categoryId;
                        return (
                          <button
                            type="button"
                            key={c.id}
                            onClick={() => setCategoryId(c.id)}
                            className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                              active
                                ? 'border-emerald-400 bg-emerald-400 text-black shadow-md shadow-emerald-500/20 scale-[1.02]'
                                : 'border-white/[0.07] bg-zinc-900 text-zinc-300 hover:border-white/20 hover:bg-zinc-800'
                            }`}
                          >
                            {c.name}
                            {pct >= 100 && !active && (
                              <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-400" title="Teto atingido" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Variáveis */}
                {variableCategories.length > 0 && (
                  <div className={fixedCategories.length > 0 ? 'border-t border-white/[0.06] pt-3' : ''}>
                    <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-purple-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                      Variáveis (Consomem do "Por Fora")
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {variableCategories.map((c) => {
                        const active = c.id === categoryId;
                        return (
                          <button
                            type="button"
                            key={c.id}
                            onClick={() => setCategoryId(c.id)}
                            className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                              active
                                ? 'border-purple-400 bg-purple-400 text-black shadow-md shadow-purple-500/20 scale-[1.02]'
                                : 'border-purple-500/20 bg-purple-950/20 text-purple-200 hover:border-purple-500/40 hover:bg-purple-900/30'
                            }`}
                          >
                            {c.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Preview Inteligente do Impacto no Orçamento */}
            {selected && dash && (
              <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/75 p-3.5">
                {selected.is_fixed === 1 ? (
                  (() => {
                    const selPct = percent(selected.spent_cents, selected.budget_cents);
                    const previewSpent = selected.spent_cents + currentInstallmentValue;
                    const previewPct = percent(previewSpent, selected.budget_cents);
                    const remainingAfter = selected.budget_cents - previewSpent;
                    return (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-zinc-300">
                            {selected.name}: <span className="text-zinc-400">{formatBRL(selected.spent_cents)} de {formatBRL(selected.budget_cents)}</span>
                          </span>
                          <span className={`font-extrabold ${textColor(selPct)}`}>{selPct}%</span>
                        </div>
                        <ProgressBar spent={previewSpent} budget={selected.budget_cents} className="mt-2 h-2" />
                        {currentInstallmentValue > 0 && (
                          <p className={`mt-2 text-xs font-medium ${remainingAfter < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                            Após lançar +{formatBRL(currentInstallmentValue)}:{' '}
                            {remainingAfter >= 0
                              ? `Ainda restarão ${formatBRL(remainingAfter)} (${previewPct}% do teto)`
                              : `Excederá o teto em ${formatBRL(-remainingAfter)} (${previewPct}%)`}
                          </p>
                        )}
                      </>
                    );
                  })()
                ) : (
                  (() => {
                    const porForaBudget = dash.por_fora_budget_cents;
                    const porForaSpent = dash.por_fora_spent_cents;
                    const previewPorForaSpent = porForaSpent + currentInstallmentValue;
                    const remainingPorForaAfter = porForaBudget - previewPorForaSpent;
                    return (
                      <>
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-purple-200">
                            {selected.name} <span className="text-zinc-400 font-normal">(Variável • acumulado no mês: {formatBRL(selected.spent_cents)})</span>
                          </span>
                          <span className="font-bold text-purple-300">
                            Livre Por Fora: {formatBRL(dash.por_fora_remaining_cents)}
                          </span>
                        </div>
                        {currentInstallmentValue > 0 && (
                          <p className={`mt-2 text-xs font-medium ${remainingPorForaAfter < 0 ? 'text-red-400' : 'text-purple-300'}`}>
                            Após lançar +{formatBRL(currentInstallmentValue)}:{' '}
                            {remainingPorForaAfter >= 0
                              ? `Seu saldo livre "Por Fora" ficará em ${formatBRL(remainingPorForaAfter)}`
                              : `Seu saldo "Por Fora" ficará negativo em ${formatBRL(remainingPorForaAfter)}`}
                          </p>
                        )}
                      </>
                    );
                  })()
                )}
              </div>
            )}
          </div>

          {/* 4. TÍTULO, DESCRIÇÃO E DATA */}
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                Título / Estabelecimento <span className="text-emerald-400">*</span>
              </label>
              <Input
                placeholder="Ex: Supermercado, Uber, iFood, Farmácia..."
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                required
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-1 block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                  Observação / Detalhe (opcional)
                </label>
                <Input
                  placeholder="Ex: Compra da semana, Jantar de sexta..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={200}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                  Data da Compra
                </label>
                <Input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  required
                  className="sm:w-44"
                />
              </div>
            </div>
          </div>

          <button
            disabled={busy}
            className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 py-3.5 text-sm font-extrabold text-black shadow-lg shadow-emerald-500/20 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
          >
            {busy
              ? 'Registrando lançamento…'
              : paymentMethod === 'credit' && installments > 1
              ? `Confirmar Compra em ${installments}x no Cartão`
              : 'Confirmar e Lançar Gasto'}
          </button>
        </form>
      </Card>

      {/* Pop-up Modal de Parcelas do Cartão */}
      {isInstallmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Parcelamento no Cartão</h3>
            <p className="mt-1 text-xs text-zinc-400">
              {parsedAmount
                ? `Valor total da compra: ${formatBRL(parsedAmount)}`
                : 'Selecione em quantas parcelas deseja dividir'}
            </p>

            <div className="mt-4 max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24].map((n) => {
                const perMonth = parsedAmount ? Math.round(parsedAmount / n) : 0;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setInstallments(n);
                      setIsInstallmentModalOpen(false);
                    }}
                    className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm transition ${
                      installments === n
                        ? 'bg-emerald-400 text-black font-bold'
                        : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <span>{n === 1 ? '1x à vista na fatura' : `${n}x sem juros`}</span>
                    {parsedAmount > 0 && (
                      <span
                        className={`text-xs tabular-nums ${
                          installments === n ? 'text-black font-semibold' : 'text-zinc-400'
                        }`}
                      >
                        {formatBRL(perMonth)} /mês
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setIsInstallmentModalOpen(false)}
              className="mt-4 w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {/* Lista de lançamentos do mês */}
      <div className="flex items-center justify-between pt-3">
        <div>
          <h2 className="text-base font-bold text-white">Últimos Lançamentos do Mês</h2>
          <p className="text-xs text-zinc-500">Toque no lápis para editar qualquer registro</p>
        </div>
        {dash && (
          <span className="rounded-xl border border-white/[0.07] bg-zinc-900/80 px-3 py-1 text-xs font-bold text-zinc-300 tabular-nums">
            Total: {formatBRL(dash.total_spent_cents)}
          </span>
        )}
      </div>

      <MonthPicker />

      {!expenses ? (
        <Spinner />
      ) : expenses.length === 0 ? (
        <Card className="text-center text-sm text-zinc-500 py-10">
          Nenhum gasto lançado neste mês.
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, items]) => (
            <div key={day}>
              <div className="mb-1.5 flex justify-between px-1 text-xs font-semibold text-zinc-400">
                <span className="capitalize">{dayLabel(day)}</span>
                <span className="tabular-nums text-zinc-300">
                  {formatBRL(items.reduce((s, x) => s + x.amount_cents, 0))}
                </span>
              </div>
              <Card className="divide-y divide-white/[0.06] !p-0 overflow-hidden">
                {items.map((exp) => (
                  <div
                    key={exp.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50 transition"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="truncate font-bold text-sm text-zinc-100">
                          {exp.title || exp.category_name}
                        </p>
                        <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-white/[0.07]">
                          {exp.category_name}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-semibold border ${
                            exp.account_id === 'nubank'
                              ? 'bg-purple-500/10 text-purple-300 border-purple-500/20'
                              : exp.account_id === 'pluxe_alimentacao'
                              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/20'
                              : exp.account_id === 'pluxe_refeicao'
                              ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/20'
                              : 'bg-orange-500/10 text-orange-300 border-orange-500/20'
                          }`}
                        >
                          {exp.account_id === 'nubank'
                            ? `Nubank • ${
                                exp.payment_method === 'credit'
                                  ? exp.installment_total > 1
                                    ? `Crédito (${exp.installment_current}/${exp.installment_total})`
                                    : 'Crédito'
                                  : exp.payment_method === 'pix'
                                  ? 'Pix'
                                  : 'Débito'
                              }`
                            : exp.account_id === 'pluxe_alimentacao'
                            ? 'Pluxe Alim.'
                            : exp.account_id === 'pluxe_refeicao'
                            ? 'Pluxe Ref.'
                            : 'Alelo'}
                        </span>
                      </div>
                      {exp.description && (
                        <p className="truncate text-xs text-zinc-400 mt-0.5">{exp.description}</p>
                      )}
                    </div>
                    <span className="font-bold text-sm sm:text-base tabular-nums text-white">
                      {formatBRL(exp.amount_cents)}
                    </span>
                    <button
                      onClick={() => setEditingExpense(exp)}
                      className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition"
                      title="Editar lançamento"
                      aria-label="Editar"
                    >
                      <IconEdit className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(exp)}
                      className="rounded-lg p-1.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition"
                      aria-label="Excluir"
                      title="Excluir"
                    >
                      <IconTrash className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </Card>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Edição */}
      <EditExpenseModal
        expense={editingExpense}
        categories={dash?.categories ?? []}
        isOpen={Boolean(editingExpense)}
        onClose={() => setEditingExpense(null)}
        onSaved={load}
      />
    </div>
  );
}
