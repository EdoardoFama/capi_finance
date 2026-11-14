import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type Category, type CreditCardInvoice, type Expense } from '../api';
import { useMonth, useToast, useConfirm, useConfirmChoice } from '../context';
import { centsToInput, dayLabel, formatBRL, formatCurrencyInput, monthLabel, parseBRL } from '../format';
import {
  Card,
  CollapseButton,
  CustomSelect,
  IconCreditCard,
  IconEdit,
  IconPlus,
  IconSearch,
  IconTrash,
  MonthPicker,
  PageTitle,
  Spinner,
  useCollapsible,
} from '../components/ui';
import EditExpenseModal from '../components/EditExpenseModal';
import DistributionChart from '../components/DistributionChart';

export default function CreditCard() {
  const { month } = useMonth();
  const toast = useToast();
  const confirm = useConfirm();
  const confirmChoice = useConfirmChoice();

  const [invoice, setInvoice] = useState<CreditCardInvoice | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [installmentFilter, setInstallmentFilter] = useState<'all' | 'single' | 'installment'>('all');
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [paying, setPaying] = useState<boolean>(false);
  const [showPayModal, setShowPayModal] = useState<boolean>(false);
  const [payInput, setPayInput] = useState<string>('');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const heroCollapse = useCollapsible('card_hero', true);
  const expensesCollapse = useCollapsible('card_expenses', true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [invData, cats] = await Promise.all([
        api<CreditCardInvoice>(`/credit-card/invoice?month=${month}`),
        api<Category[]>('/categories'),
      ]);
      setInvoice(invData);
      setCategories(cats);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setLoading(false);
    }
  }, [month, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(exp: Expense) {
    if (exp.installment_total > 1 && exp.installment_group_id) {
      const choice = await confirmChoice({
        title: 'Excluir Gasto Parcelado',
        message: `Este gasto é parcelado (${exp.installment_current}/${exp.installment_total}) no valor de ${formatBRL(exp.amount_cents)}.\n\nComo você deseja excluir?`,
        confirmText: 'Excluir todas as parcelas',
        secondaryText: 'Apenas esta parcela',
        cancelText: 'Cancelar',
        variant: 'danger',
      });
      if (!choice) return;
      const deleteAll = choice === 'confirm';
      try {
        await api(`/expenses/${exp.id}?all_installments=${deleteAll}`, { method: 'DELETE' });
        toast(deleteAll ? 'Todas as parcelas foram excluídas' : 'Parcela excluída');
        await load();
      } catch (err) {
        toast((err as Error).message, 'error');
      }
      return;
    }

    const ok = await confirm({
      title: 'Excluir Gasto do Cartão',
      message: `Deseja realmente excluir o lançamento de ${formatBRL(exp.amount_cents)} (${exp.title || exp.category_name})?`,
      confirmText: 'Excluir Lançamento',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await api(`/expenses/${exp.id}`, { method: 'DELETE' });
      toast('Lançamento excluído com sucesso');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  function handleOpenPayModal() {
    const rem =
      invoice?.remaining_cents ??
      Math.max(0, (invoice?.total_cents ?? 0) - (invoice?.paid_amount_cents ?? 0));
    setPayInput(centsToInput(rem));
    setShowPayModal(true);
  }

  async function handlePayInvoice(forcedAmountCents?: number) {
    if (!invoice || invoice.total_cents <= 0) return;
    const rem =
      invoice.remaining_cents ??
      Math.max(0, invoice.total_cents - (invoice.paid_amount_cents ?? 0));
    const toPay =
      forcedAmountCents !== undefined
        ? forcedAmountCents
        : (parseBRL(payInput) ?? rem);

    if (!toPay || toPay <= 0) {
      toast('Informe um valor válido para pagar', 'error');
      return;
    }
    if (toPay > rem) {
      toast(`O valor máximo a pagar é ${formatBRL(rem)}`, 'error');
      return;
    }

    setPaying(true);
    try {
      await api('/credit-card/pay', {
        method: 'POST',
        body: { month, amount_cents: toPay },
      });
      toast(`Pagamento de ${formatBRL(toPay)} registrado com sucesso!`);
      setShowPayModal(false);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPaying(false);
    }
  }

  async function handleReopenInvoice() {
    const ok = await confirm({
      title: 'Desfazer Pagamento da Fatura?',
      message: `Deseja desfazer o pagamento da fatura de ${monthLabel(month)}?\n\nO valor pago será restaurado automaticamente no seu saldo da conta Nubank.`,
      confirmText: 'Desfazer Pagamento',
      cancelText: 'Voltar',
      variant: 'warning',
    });
    if (!ok) return;

    setPaying(true);
    try {
      await api('/credit-card/reopen', {
        method: 'POST',
        body: { month },
      });
      toast(`Pagamento da fatura desfeito. Saldo Nubank restaurado.`);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPaying(false);
    }
  }

  // Estatísticas de à vista vs parcelado na fatura
  const invoiceStats = useMemo(() => {
    const list = invoice?.expenses ?? [];
    let installmentsTotal = 0;
    let singleTotal = 0;
    for (const e of list) {
      if (e.installment_total > 1) installmentsTotal += e.amount_cents;
      else singleTotal += e.amount_cents;
    }
    return { installmentsTotal, singleTotal };
  }, [invoice]);

  // Filtragem
  const filtered = useMemo(() => {
    if (!invoice?.expenses) return [];
    return invoice.expenses.filter((item) => {
      const matchesCategory =
        selectedCategory === 'all' || item.category_id === Number(selectedCategory);
      const matchesInstallment =
        installmentFilter === 'all' ||
        (installmentFilter === 'installment' && item.installment_total > 1) ||
        (installmentFilter === 'single' && item.installment_total <= 1);
      const matchesSearch =
        !search.trim() ||
        (item.title && item.title.toLowerCase().includes(search.toLowerCase())) ||
        (item.description && item.description.toLowerCase().includes(search.toLowerCase())) ||
        item.category_name.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesInstallment && matchesSearch;
    });
  }, [invoice, selectedCategory, installmentFilter, search]);

  const totalFiltered = useMemo(() => {
    return filtered.reduce((acc, curr) => acc + curr.amount_cents, 0);
  }, [filtered]);

  const invoiceCategoryDistribution = useMemo(() => {
    if (!invoice?.expenses) return [];
    const map = new Map<string, { amount: number; id: number | string }>();
    for (const exp of invoice.expenses) {
      const catName = exp.category_name || 'Outros';
      const prev = map.get(catName);
      if (prev) {
        prev.amount += exp.amount_cents;
      } else {
        map.set(catName, { amount: exp.amount_cents, id: exp.category_id });
      }
    }
    return [...map.entries()].map(([name, data]) => {
      const isSelected = String(selectedCategory) === String(data.id);
      return {
        id: data.id,
        name,
        amount_cents: data.amount,
        isSelected,
        onClick: () => {
          if (String(selectedCategory) === String(data.id)) {
            setSelectedCategory('all');
          } else {
            setSelectedCategory(String(data.id));
            if (!expensesCollapse.isOpen) {
              expensesCollapse.setIsOpen(true);
            }
            setTimeout(() => {
              const el = document.getElementById('fatura-lancamentos-section');
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }, 60);
          }
        },
      };
    });
  }, [invoice, selectedCategory, expensesCollapse]);

  const grouped = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of filtered) {
      map.set(e.spent_on, [...(map.get(e.spent_on) ?? []), e]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const currentNubankBalance = invoice?.nubank_balance_cents ?? 0;
  const invoiceTotal = invoice?.total_cents ?? 0;
  const paidAmount = invoice?.paid_amount_cents ?? 0;
  const remainingAmount =
    invoice?.remaining_cents ?? Math.max(0, invoiceTotal - paidAmount);
  const isPaid = Boolean(
    (invoice?.is_paid && remainingAmount === 0) ||
      (invoiceTotal > 0 && paidAmount >= invoiceTotal),
  );
  const isPartial = Boolean(
    invoice?.is_partial || (paidAmount > 0 && remainingAmount > 0),
  );

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle
          title="Cartão de Crédito"
          subtitle={`Gestão da fatura e parcelamentos • ${monthLabel(month)}`}
        />
        <Link
          to="/lancar?conta=nubank"
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-4 py-2.5 text-xs sm:text-sm font-bold text-white transition hover:brightness-110 shadow-lg shadow-purple-600/25"
        >
          <IconPlus className="h-4 w-4 stroke-[2.4]" /> Lançar no Cartão
        </Link>
      </div>

      <MonthPicker />

      {loading && !invoice ? (
        <Spinner />
      ) : (
        <>
          {/* HERO CARD DA FATURA NUBANK */}
          <div className="relative overflow-hidden rounded-3xl border border-purple-500/35 bg-gradient-to-br from-[#160926] via-zinc-950 to-[#0c0714] p-5 sm:p-6 shadow-2xl">
            <div className="pointer-events-none absolute -right-12 -top-12 h-52 w-52 rounded-full bg-purple-600/20 blur-3xl" />
            <div className="pointer-events-none absolute -left-12 -bottom-12 h-44 w-44 rounded-full bg-indigo-600/10 blur-3xl" />

            <div
              className={`relative flex flex-wrap items-start justify-between gap-3 ${
                heroCollapse.isOpen ? '' : 'select-none cursor-pointer group'
              }`}
              onClick={!heroCollapse.isOpen ? heroCollapse.toggle : undefined}
            >
              <div className="flex items-center gap-3">
                <CollapseButton
                  isOpen={heroCollapse.isOpen}
                  onToggle={heroCollapse.toggle}
                />
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-400/30 shadow-inner">
                  <IconCreditCard className="h-6 w-6" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold tracking-widest text-purple-300 uppercase">
                    Nubank Mastercard
                  </span>
                  <h2 className="text-lg sm:text-xl font-extrabold text-white capitalize group-hover:text-purple-300 transition">
                    Fatura de {monthLabel(month)}
                  </h2>
                </div>
              </div>

              {/* Status da Fatura e Totais quando retraído */}
              <div className="flex items-center gap-3">
                {!heroCollapse.isOpen && (
                  <div className="text-right">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 block">
                      Restante
                    </span>
                    <span className="text-sm font-extrabold text-white tabular-nums">
                      {formatBRL(remainingAmount)}
                    </span>
                  </div>
                )}
                {isPaid ? (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3.5 py-1 text-xs font-bold text-emerald-300">
                    <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                    Fatura 100% Paga
                  </div>
                ) : isPartial ? (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/35 bg-sky-500/15 px-3.5 py-1 text-xs font-bold text-sky-300">
                    <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse" />
                    Paga Parcialmente ({formatBRL(paidAmount)})
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/15 px-3.5 py-1 text-xs font-bold text-amber-300">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    Fatura em Aberto
                  </div>
                )}
              </div>
            </div>

            {heroCollapse.isOpen && (
              <>
                {/* Painel com 4 Cards: Total da Fatura, Pago, Restante, Saldo Nubank */}
                <div className="relative mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 border-t border-white/[0.08] pt-5">
                  {/* 1. Total da Fatura (Nunca zera ao pagar) */}
                  <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-3.5 sm:p-4">
                    <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                      Total da Fatura
                    </p>
                    <p className="mt-1 text-xl sm:text-2xl lg:text-3xl font-black tracking-tight text-white tabular-nums">
                      {formatBRL(invoiceTotal)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {invoice?.count ?? 0}{' '}
                      {invoice?.count === 1 ? 'compra registrada' : 'compras registradas'}
                    </p>
                  </div>

                  {/* 2. Valor Pago */}
                  <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-3.5 sm:p-4">
                    <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                      Valor Pago
                    </p>
                    <p
                      className={`mt-1 text-xl sm:text-2xl lg:text-3xl font-black tracking-tight tabular-nums ${
                        paidAmount > 0 ? 'text-emerald-400' : 'text-zinc-500'
                      }`}
                    >
                      {formatBRL(paidAmount)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {paidAmount > 0
                        ? isPaid
                          ? '100% liquidado'
                          : 'Abatimento parcial'
                        : 'Nenhum pagamento'}
                    </p>
                  </div>

                  {/* 3. Restante a Pagar */}
                  <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-3.5 sm:p-4">
                    <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                      Restante a Pagar
                    </p>
                    <p
                      className={`mt-1 text-xl sm:text-2xl lg:text-3xl font-black tracking-tight tabular-nums ${
                        remainingAmount === 0 && invoiceTotal > 0
                          ? 'text-emerald-400'
                          : remainingAmount > 0
                          ? 'text-amber-300'
                          : 'text-zinc-500'
                      }`}
                    >
                      {formatBRL(remainingAmount)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {remainingAmount === 0 && invoiceTotal > 0
                        ? 'Fatura quitada ✓'
                        : remainingAmount > 0
                        ? 'Aguardando quitação'
                        : 'Sem compras'}
                    </p>
                  </div>

                  {/* 4. Saldo Conta Nubank */}
                  <div className="rounded-2xl border border-white/[0.06] bg-black/40 p-3.5 sm:p-4">
                    <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                      Saldo Conta Nubank
                    </p>
                    <p className="mt-1 text-xl sm:text-2xl lg:text-3xl font-black tracking-tight text-purple-300 tabular-nums">
                      {formatBRL(currentNubankBalance)}
                    </p>
                    <p className="mt-1 text-xs text-zinc-400">
                      {currentNubankBalance >= remainingAmount && remainingAmount > 0
                        ? `Cobre o restante (sobra ${formatBRL(currentNubankBalance - remainingAmount)})`
                        : remainingAmount === 0
                        ? 'Fatura quitada'
                        : remainingAmount > 0
                        ? `Faltam ${formatBRL(remainingAmount - currentNubankBalance)}`
                        : 'Sem débitos'}
                    </p>
                  </div>
                </div>

                {/* Sub-painel: Compras à vista vs Compras parceladas */}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/[0.06] bg-zinc-950/60 px-4 py-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-400">Compras à vista (1x):</span>
                    <span className="font-bold text-zinc-200 tabular-nums">
                      {formatBRL(invoiceStats.singleTotal)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-purple-300">Compras parceladas:</span>
                    <span className="font-bold text-purple-300 tabular-nums">
                      {formatBRL(invoiceStats.installmentsTotal)}
                    </span>
                  </div>
                </div>

                {/* Rodapé de Ação da Fatura */}
                <div className="relative mt-5 pt-4 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
                  {isPaid ? (
                    <div className="flex w-full items-center justify-between flex-wrap gap-2">
                      <span className="text-xs text-emerald-300/90 font-medium">
                        ✓{' '}
                        {invoice?.paid_at
                          ? `Liquidada em ${new Date(invoice.paid_at).toLocaleDateString('pt-BR')}`
                          : 'Fatura quitada'}{' '}
                        • Total de {formatBRL(paidAmount)} abatido da conta Nubank
                      </span>
                      <button
                        onClick={handleReopenInvoice}
                        disabled={paying}
                        className="rounded-xl border border-white/[0.08] bg-zinc-900/80 px-3.5 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition disabled:opacity-50"
                      >
                        Desfazer pagamento
                      </button>
                    </div>
                  ) : isPartial ? (
                    <div className="flex w-full items-center justify-between flex-wrap gap-3">
                      <div className="text-xs text-zinc-300">
                        <span className="font-semibold text-sky-300">Pagamento parcial:</span>{' '}
                        {formatBRL(paidAmount)} já pagos. Restam{' '}
                        <strong className="text-amber-300">{formatBRL(remainingAmount)}</strong> a
                        quitar.
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleReopenInvoice}
                          disabled={paying}
                          className="rounded-xl border border-white/[0.08] bg-zinc-900/80 px-3 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition disabled:opacity-50"
                        >
                          Desfazer pagamentos
                        </button>
                        <button
                          onClick={handleOpenPayModal}
                          disabled={paying}
                          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 px-4 py-2 text-xs sm:text-sm font-extrabold text-white shadow-lg shadow-purple-600/30 transition hover:brightness-110 disabled:opacity-40"
                        >
                          <IconCreditCard className="h-4 w-4" />
                          Pagar Restante ({formatBRL(remainingAmount)})
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full items-center justify-between flex-wrap gap-3">
                      <span className="text-xs text-zinc-400">
                        Ao pagar a fatura, o valor é deduzido automaticamente do seu saldo da conta Nubank.
                      </span>
                      <button
                        onClick={handleOpenPayModal}
                        disabled={invoiceTotal <= 0 || paying}
                        className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-white shadow-lg shadow-purple-600/30 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        <IconCreditCard className="h-4 w-4" />
                        Pagar Fatura
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Modal de Pagamento de Fatura (Parcial ou Total) */}
          {showPayModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
              <div className="w-full max-w-lg rounded-2xl border border-white/[0.1] bg-zinc-950 p-6 shadow-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      <IconCreditCard className="h-6 w-6" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-white">Pagamento da Fatura</h3>
                      <p className="text-xs text-zinc-400 capitalize">
                        Nubank Mastercard • {monthLabel(month)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowPayModal(false)}
                    className="text-zinc-400 hover:text-white text-base px-2 py-1 rounded-lg hover:bg-zinc-900 transition"
                  >
                    ✕
                  </button>
                </div>

                {/* Resumo da Fatura */}
                <div className="mt-4 grid grid-cols-2 gap-2 text-xs rounded-xl border border-white/[0.08] bg-zinc-900/60 p-3.5">
                  <div>
                    <span className="text-zinc-400">Total da fatura:</span>
                    <p className="font-bold text-white tabular-nums text-sm">
                      {formatBRL(invoiceTotal)}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-400">Já pago neste mês:</span>
                    <p className="font-bold text-emerald-400 tabular-nums text-sm">
                      {formatBRL(paidAmount)}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-400">Restante a pagar:</span>
                    <p className="font-bold text-amber-300 tabular-nums text-sm">
                      {formatBRL(remainingAmount)}
                    </p>
                  </div>
                  <div>
                    <span className="text-zinc-400">Saldo atual Nubank:</span>
                    <p className="font-bold text-purple-300 tabular-nums text-sm">
                      {formatBRL(currentNubankBalance)}
                    </p>
                  </div>
                </div>

                {/* Campo de valor customizado */}
                <div className="mt-5 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-zinc-300 uppercase tracking-wider">
                      Quanto deseja pagar agora?
                    </label>
                    <button
                      type="button"
                      onClick={() => setPayInput(centsToInput(remainingAmount))}
                      className="text-[11px] font-bold text-purple-400 hover:text-purple-300 underline"
                    >
                      Pagar Fatura Inteira ({formatBRL(remainingAmount)})
                    </button>
                  </div>

                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-zinc-500">
                      R$
                    </span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={payInput}
                      onChange={(e) => setPayInput(formatCurrencyInput(e.target.value))}
                      placeholder="0,00"
                      className="w-full rounded-xl border border-white/[0.1] bg-zinc-900 py-3 pl-11 pr-4 text-lg font-bold text-white placeholder:text-zinc-600 outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  {/* Atalhos rápidos */}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => setPayInput(centsToInput(remainingAmount))}
                      className="rounded-lg border border-purple-500/30 bg-purple-500/10 px-2.5 py-1 text-[11px] font-bold text-purple-300 hover:bg-purple-500/20 transition"
                    >
                      Pagar restante total ({formatBRL(remainingAmount)})
                    </button>
                    {currentNubankBalance > 0 && currentNubankBalance < remainingAmount && (
                      <button
                        type="button"
                        onClick={() => setPayInput(centsToInput(currentNubankBalance))}
                        className="rounded-lg border border-white/[0.08] bg-zinc-900 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-zinc-800 transition"
                      >
                        Pagar saldo Nubank ({formatBRL(currentNubankBalance)})
                      </button>
                    )}
                  </div>
                </div>

                {/* Simulação em tempo real */}
                {(() => {
                  const toPayCents = parseBRL(payInput) ?? 0;
                  const newNubankBalance = Math.max(0, currentNubankBalance - toPayCents);
                  const newRemaining = Math.max(0, remainingAmount - toPayCents);
                  const isOverRemaining = toPayCents > remainingAmount;
                  const isOverBalance = toPayCents > currentNubankBalance;

                  return (
                    <div className="mt-4 space-y-2">
                      <div className="rounded-xl border border-white/[0.06] bg-zinc-900/40 p-3 text-xs space-y-1.5">
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Novo saldo Nubank após pagamento:</span>
                          <span
                            className={`font-bold tabular-nums ${
                              isOverBalance ? 'text-amber-400' : 'text-zinc-200'
                            }`}
                          >
                            {formatBRL(newNubankBalance)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-zinc-400">Restante da fatura após pagar:</span>
                          <span className="font-bold tabular-nums text-white">
                            {formatBRL(newRemaining)}
                          </span>
                        </div>
                      </div>

                      {isOverRemaining && (
                        <p className="text-xs text-rose-400 font-medium">
                          ⚠️ O valor informado ultrapassa o restante da fatura ({formatBRL(remainingAmount)}).
                        </p>
                      )}
                      {isOverBalance && !isOverRemaining && (
                        <p className="text-xs text-amber-400 font-medium">
                          ⚠️ O valor é maior que o saldo em conta ({formatBRL(currentNubankBalance)}). O saldo Nubank ficará zerado.
                        </p>
                      )}
                    </div>
                  );
                })()}

                <div className="mt-6 flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setShowPayModal(false)}
                    disabled={paying}
                    className="rounded-xl border border-white/[0.08] px-4 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-900 hover:text-white transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePayInvoice()}
                    disabled={
                      paying ||
                      (parseBRL(payInput) ?? 0) <= 0 ||
                      (parseBRL(payInput) ?? 0) > remainingAmount
                    }
                    className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-purple-500 transition shadow-lg shadow-purple-600/30 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {paying
                      ? 'Processando...'
                      : `Confirmar Pagamento (${formatBRL(parseBRL(payInput) ?? remainingAmount)})`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Dashboard de Distribuição da Fatura */}
          {invoiceTotal > 0 && (
            <DistributionChart
              title="Distribuição da Fatura por Categoria"
              subtitle="Veja para quais categorias estão indo os gastos do seu cartão neste mês"
              items={invoiceCategoryDistribution}
              storageKey="card_distribution"
            />
          )}

          {/* Filtros da lista */}
          <Card id="fatura-lancamentos-section" className="space-y-3.5">
            <div
              className={`flex flex-wrap items-center justify-between gap-2 ${
                expensesCollapse.isOpen ? 'border-b border-white/[0.06] pb-3' : ''
              } cursor-pointer select-none group`}
              onClick={expensesCollapse.toggle}
            >
              <div className="flex items-center gap-2.5">
                <CollapseButton
                  isOpen={expensesCollapse.isOpen}
                  onToggle={expensesCollapse.toggle}
                />
                <div>
                  <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider group-hover:text-purple-300 transition">
                    Lançamentos Filtrados
                  </p>
                  <p className="text-xl font-extrabold tracking-tight text-white tabular-nums">
                    {formatBRL(totalFiltered)}
                  </p>
                </div>
              </div>

              {/* Filtro Rápido: Todas / À vista / Parceladas */}
              {expensesCollapse.isOpen && (
                <div
                  className="flex items-center rounded-xl border border-white/[0.08] bg-zinc-900 p-1 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setInstallmentFilter('all')}
                    className={`rounded-lg px-2.5 py-1 font-bold transition ${
                      installmentFilter === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Todas ({invoice?.expenses.length ?? 0})
                  </button>
                  <button
                    type="button"
                    onClick={() => setInstallmentFilter('single')}
                    className={`rounded-lg px-2.5 py-1 font-bold transition ${
                      installmentFilter === 'single'
                        ? 'bg-purple-500/20 text-purple-300'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    À vista
                  </button>
                  <button
                    type="button"
                    onClick={() => setInstallmentFilter('installment')}
                    className={`rounded-lg px-2.5 py-1 font-bold transition ${
                      installmentFilter === 'installment'
                        ? 'bg-purple-500/20 text-purple-300'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Parceladas
                  </button>
                </div>
              )}
            </div>

            {expensesCollapse.isOpen && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {/* Busca por texto */}
                <div className="relative">
                  <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
                  <input
                    type="text"
                    placeholder="Buscar compra, loja ou categoria..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 pl-9 pr-8 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-purple-500/60"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Filtro por Categoria com CustomSelect */}
                <CustomSelect
                  value={selectedCategory}
                  onChange={setSelectedCategory}
                  options={[
                    { value: 'all', label: 'Todas as categorias' },
                    ...categories.map((c) => ({
                      value: String(c.id),
                      label: c.name,
                    })),
                  ]}
                  placeholder="Selecione uma categoria"
                  searchPlaceholder="Pesquisar categoria..."
                />
              </div>
            )}
          </Card>

          {/* Lista de Compras */}
          {expensesCollapse.isOpen && (
            filtered.length === 0 ? (
              <Card className="text-center py-12 text-zinc-500">
                <p className="text-sm font-medium">Nenhum lançamento de cartão encontrado neste filtro.</p>
                {(search || selectedCategory !== 'all' || installmentFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setSearch('');
                      setSelectedCategory('all');
                      setInstallmentFilter('all');
                    }}
                    className="mt-3 rounded-xl bg-purple-500/15 border border-purple-500/30 px-3 py-1.5 text-xs font-bold text-purple-300 hover:bg-purple-500/25 transition"
                  >
                    Limpar todos os filtros
                  </button>
                )}
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
                          className="flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-900/50 transition"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-bold text-sm text-zinc-100">
                                {exp.title || exp.category_name}
                              </p>
                              <span className="inline-block rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-bold text-purple-300 border border-white/[0.07]">
                                {exp.category_name}
                              </span>
                              {exp.installment_total > 1 ? (
                                <span className="rounded-md px-2 py-0.5 text-[10px] font-bold border bg-purple-500/15 text-purple-300 border-purple-500/30">
                                  Parcela {exp.installment_current}/{exp.installment_total}
                                </span>
                              ) : (
                                <span className="rounded-md px-2 py-0.5 text-[10px] font-semibold border bg-zinc-900 text-zinc-400 border-white/[0.06]">
                                  1x à vista
                                </span>
                              )}
                            </div>
                            {exp.description && (
                              <p className="truncate text-xs text-zinc-400 mt-0.5">{exp.description}</p>
                            )}
                          </div>
                          <span className="font-extrabold text-sm sm:text-base tabular-nums text-white">
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
                            title="Excluir gasto"
                            aria-label="Excluir"
                          >
                            <IconTrash className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </Card>
                  </div>
                ))}
              </div>
            )
          )}
        </>
      )}

      <EditExpenseModal
        expense={editingExpense}
        categories={categories}
        isOpen={Boolean(editingExpense)}
        onClose={() => setEditingExpense(null)}
        onSaved={load}
      />
    </div>
  );
}
