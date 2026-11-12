import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type Category, type CreditCardInvoice, type Expense } from '../api';
import { useMonth, useToast } from '../context';
import { dayLabel, formatBRL, monthLabel } from '../format';
import {
  Card,
  IconCreditCard,
  IconEdit,
  IconPlus,
  IconSearch,
  IconTrash,
  MonthPicker,
  PageTitle,
  Spinner,
} from '../components/ui';
import EditExpenseModal from '../components/EditExpenseModal';
import DistributionChart from '../components/DistributionChart';

export default function CreditCard() {
  const { month } = useMonth();
  const toast = useToast();

  const [invoice, setInvoice] = useState<CreditCardInvoice | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [installmentFilter, setInstallmentFilter] = useState<'all' | 'single' | 'installment'>('all');
  const [search, setSearch] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [paying, setPaying] = useState<boolean>(false);
  const [showPayModal, setShowPayModal] = useState<boolean>(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

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

    if (!confirm(`Deseja excluir o gasto de ${formatBRL(exp.amount_cents)} (${exp.title})?`)) return;
    try {
      await api(`/expenses/${exp.id}`, { method: 'DELETE' });
      toast('Lançamento excluído');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function handlePayInvoice() {
    if (!invoice || invoice.total_cents <= 0) return;
    setPaying(true);
    try {
      await api('/credit-card/pay', {
        method: 'POST',
        body: { month },
      });
      toast(`Fatura de ${monthLabel(month)} paga com sucesso! Abatido do saldo Nubank.`);
      setShowPayModal(false);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setPaying(false);
    }
  }

  async function handleReopenInvoice() {
    if (
      !confirm(
        `Deseja desfazer o pagamento da fatura de ${monthLabel(month)}?\nO valor será restaurado no seu saldo da conta Nubank.`,
      )
    )
      return;
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
    const map = new Map<string, number>();
    for (const exp of invoice.expenses) {
      const catName = exp.category_name || 'Outros';
      map.set(catName, (map.get(catName) ?? 0) + exp.amount_cents);
    }
    return [...map.entries()].map(([name, amount_cents]) => ({
      name,
      amount_cents,
    }));
  }, [invoice]);

  const grouped = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of filtered) {
      map.set(e.spent_on, [...(map.get(e.spent_on) ?? []), e]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const currentNubankBalance = invoice?.nubank_balance_cents ?? 0;
  const invoiceTotal = invoice?.total_cents ?? 0;
  const balanceAfterPayment = Math.max(0, currentNubankBalance - invoiceTotal);

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

            <div className="relative flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-500/20 text-purple-300 border border-purple-400/30 shadow-inner">
                  <IconCreditCard className="h-6 w-6" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold tracking-widest text-purple-300 uppercase">
                    Nubank Mastercard
                  </span>
                  <h2 className="text-lg sm:text-xl font-extrabold text-white capitalize">
                    Fatura de {monthLabel(month)}
                  </h2>
                </div>
              </div>

              {/* Status da Fatura */}
              {invoice?.is_paid ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/35 bg-emerald-500/15 px-3.5 py-1 text-xs font-bold text-emerald-300">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Fatura Paga
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/35 bg-amber-500/15 px-3.5 py-1 text-xs font-bold text-amber-300">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Fatura em Aberto
                </div>
              )}
            </div>

            {/* Total e Detalhamento (À vista vs Parcelado) */}
            <div className="relative mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-white/[0.08] pt-5">
              <div>
                <p className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                  Total da Fatura
                </p>
                <p className="mt-1 text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums">
                  {formatBRL(invoiceTotal)}
                </p>
                <p className="mt-1 text-xs text-zinc-400">
                  {invoice?.count ?? 0}{' '}
                  {invoice?.count === 1 ? 'compra registrada' : 'compras registradas'}
                </p>
              </div>

              <div className="flex flex-col justify-center gap-2 rounded-2xl border border-white/[0.06] bg-black/30 p-3.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Compras à vista (1x):</span>
                  <span className="font-bold text-zinc-200 tabular-nums">
                    {formatBRL(invoiceStats.singleTotal)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-purple-300">Compras parceladas:</span>
                  <span className="font-bold text-purple-300 tabular-nums">
                    {formatBRL(invoiceStats.installmentsTotal)}
                  </span>
                </div>
              </div>

              <div className="flex flex-col justify-center rounded-2xl border border-white/[0.06] bg-black/30 p-3.5 sm:text-right">
                <p className="text-[11px] font-semibold text-zinc-400">
                  Saldo em conta Nubank:
                </p>
                <p className="mt-0.5 text-lg font-extrabold text-purple-300 tabular-nums">
                  {formatBRL(currentNubankBalance)}
                </p>
                <p className="mt-1 text-[11px] text-zinc-500">
                  {currentNubankBalance >= invoiceTotal && invoiceTotal > 0
                    ? `Cobre 100% da fatura (sobra ${formatBRL(currentNubankBalance - invoiceTotal)})`
                    : invoiceTotal > 0
                    ? `Faltam ${formatBRL(invoiceTotal - currentNubankBalance)} p/ cobrir tudo`
                    : 'Sem fatura pendente'}
                </p>
              </div>
            </div>

            {/* Rodapé de Ação da Fatura */}
            <div className="relative mt-5 pt-4 border-t border-white/[0.08] flex flex-wrap items-center justify-between gap-3">
              {invoice?.is_paid ? (
                <div className="flex w-full items-center justify-between flex-wrap gap-2">
                  <span className="text-xs text-emerald-300/90 font-medium">
                    ✓ {invoice.paid_at ? `Liquidada em ${new Date(invoice.paid_at).toLocaleDateString('pt-BR')}` : 'Fatura liquidada'} • Valor abatido do saldo Nubank
                  </span>
                  <button
                    onClick={handleReopenInvoice}
                    disabled={paying}
                    className="rounded-xl border border-white/[0.08] bg-zinc-900/80 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 hover:text-white transition disabled:opacity-50"
                  >
                    Desfazer pagamento
                  </button>
                </div>
              ) : (
                <div className="flex w-full items-center justify-between flex-wrap gap-3">
                  <span className="text-xs text-zinc-400">
                    Ao pagar a fatura, o valor é deduzido automaticamente do seu saldo da conta Nubank.
                  </span>
                  <button
                    onClick={() => setShowPayModal(true)}
                    disabled={invoiceTotal <= 0 || paying}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-indigo-500 px-5 py-2.5 text-xs sm:text-sm font-extrabold text-white shadow-lg shadow-purple-600/30 transition hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <IconCreditCard className="h-4 w-4" />
                    Pagar Fatura Agora
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Modal de Confirmação de Pagamento de Fatura */}
          {showPayModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-2xl border border-white/[0.1] bg-zinc-950 p-6 shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    <IconCreditCard className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Confirmar Pagamento</h3>
                    <p className="text-xs text-zinc-400 capitalize">Fatura de {monthLabel(month)}</p>
                  </div>
                </div>

                <div className="mt-5 space-y-3 rounded-xl border border-white/[0.08] bg-zinc-900/60 p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Total da Fatura:</span>
                    <span className="font-bold text-white tabular-nums">{formatBRL(invoiceTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Saldo atual na Nubank:</span>
                    <span className="font-semibold text-purple-300 tabular-nums">
                      {formatBRL(currentNubankBalance)}
                    </span>
                  </div>
                  <div className="border-t border-white/[0.08] pt-2.5 flex justify-between font-bold">
                    <span className="text-zinc-200">Saldo Nubank após pagar:</span>
                    <span className="text-emerald-400 tabular-nums">{formatBRL(balanceAfterPayment)}</span>
                  </div>
                </div>

                <p className="mt-4 text-xs text-zinc-400 leading-relaxed">
                  Ao confirmar, <strong>{formatBRL(invoiceTotal)}</strong> será debitado do seu saldo em conta da{' '}
                  <strong>Nubank</strong> e a fatura deste mês será marcada como <strong>Paga</strong>.
                </p>

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
                    onClick={handlePayInvoice}
                    disabled={paying}
                    className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2.5 text-xs font-bold text-white hover:bg-purple-500 transition shadow-lg shadow-purple-600/30 disabled:opacity-50"
                  >
                    {paying ? 'Processando...' : 'Confirmar e Pagar'}
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
            />
          )}

          {/* Filtros da lista */}
          <Card className="space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
              <div>
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                  Lançamentos Filtrados
                </p>
                <p className="text-xl font-extrabold tracking-tight text-white tabular-nums">
                  {formatBRL(totalFiltered)}
                </p>
              </div>

              {/* Filtro Rápido: Todas / À vista / Parceladas */}
              <div className="flex items-center rounded-xl border border-white/[0.08] bg-zinc-900 p-1 text-xs">
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
            </div>

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

              {/* Filtro por Categoria */}
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500/60"
              >
                <option value="all">Todas as categorias</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </Card>

          {/* Lista de Compras */}
          {filtered.length === 0 ? (
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
