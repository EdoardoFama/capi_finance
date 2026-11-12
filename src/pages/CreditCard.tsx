import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type Category, type CreditCardInvoice, type Expense } from '../api';
import { useMonth, useToast } from '../context';
import { dayLabel, formatBRL, monthLabel } from '../format';
import { Card, IconCreditCard, IconEdit, IconPlus, IconTrash, MonthPicker, PageTitle, Spinner } from '../components/ui';
import EditExpenseModal from '../components/EditExpenseModal';

export default function CreditCard() {
  const { month } = useMonth();
  const toast = useToast();

  const [invoice, setInvoice] = useState<CreditCardInvoice | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
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

  // Exclusão de gasto / parcela
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

  // Pagar Fatura
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

  // Desfazer Pagamento
  async function handleReopenInvoice() {
    if (!confirm(`Deseja desfazer o pagamento da fatura de ${monthLabel(month)}?\nO valor será restaurado no seu saldo da conta Nubank.`)) return;
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

  // Filtragem
  const filtered = useMemo(() => {
    if (!invoice?.expenses) return [];
    return invoice.expenses.filter((item) => {
      const matchesCategory =
        selectedCategory === 'all' || item.category_id === Number(selectedCategory);
      const matchesSearch =
        !search.trim() ||
        (item.title && item.title.toLowerCase().includes(search.toLowerCase())) ||
        (item.description && item.description.toLowerCase().includes(search.toLowerCase())) ||
        item.category_name.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [invoice, selectedCategory, search]);

  const totalFiltered = useMemo(() => {
    return filtered.reduce((acc, curr) => acc + curr.amount_cents, 0);
  }, [filtered]);

  // Agrupamento por dia (ordenado do mais recente pro mais antigo)
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
    <div className="space-y-4">
      {/* Cabeçalho */}
      <div className="flex items-center justify-between">
        <PageTitle
          title="Cartão de Crédito"
          subtitle={`Central de gastos no cartão • ${monthLabel(month)}`}
        />
        <Link
          to="/lancar"
          className="flex items-center gap-1.5 rounded-xl bg-purple-600 px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-purple-500 shadow-lg shadow-purple-600/20"
        >
          <IconPlus className="h-4 w-4" /> Novo no Cartão
        </Link>
      </div>

      {/* Seletor de mês */}
      <MonthPicker />

      {/* Card da Fatura */}
      {loading && !invoice ? (
        <Spinner />
      ) : (
        <>
          <div className="relative overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-zinc-950 via-zinc-950 to-purple-950/30 p-5 shadow-xl">
            {/* Efeito sutil de brilho roxo */}
            <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-purple-600/10 blur-3xl" />

            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/20 text-purple-400 border border-purple-500/30">
                    <IconCreditCard className="h-5 w-5" />
                  </div>
                  <div>
                    <span className="text-xs font-semibold tracking-wider text-purple-300 uppercase">
                      Nubank Mastercard
                    </span>
                    <h2 className="text-lg font-bold text-white">
                      Fatura de {monthLabel(month)}
                    </h2>
                  </div>
                </div>
              </div>

              {/* Status da Fatura */}
              {invoice?.is_paid ? (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/15 px-3 py-1 text-xs font-semibold text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  Fatura Paga
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/15 px-3 py-1 text-xs font-semibold text-amber-300">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Fatura em Aberto
                </div>
              )}
            </div>

            {/* Total e Informações */}
            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-zinc-900/80 pt-4">
              <div>
                <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                  Valor Total da Fatura
                </p>
                <p className="mt-0.5 text-3xl font-extrabold tracking-tight text-white tabular-nums">
                  {formatBRL(invoiceTotal)}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {invoice?.count ?? 0} {invoice?.count === 1 ? 'lançamento no cartão' : 'lançamentos no cartão'}
                </p>
              </div>

              <div className="flex flex-col justify-end sm:items-end">
                <p className="text-xs font-medium text-zinc-400">
                  Saldo em conta Nubank disponível:
                </p>
                <p className="text-sm font-semibold text-purple-300 tabular-nums">
                  {formatBRL(currentNubankBalance)}
                </p>
              </div>
            </div>

            {/* Botão de Pagar Fatura / Desfazer */}
            <div className="mt-5 pt-4 border-t border-zinc-900 flex flex-wrap items-center justify-between gap-3">
              {invoice?.is_paid ? (
                <div className="flex w-full items-center justify-between flex-wrap gap-2">
                  <span className="text-xs text-zinc-400">
                    {invoice.paid_at ? `Pago em ${new Date(invoice.paid_at).toLocaleDateString('pt-BR')}` : 'Fatura liquidada'} • Abatido do saldo Nubank
                  </span>
                  <button
                    onClick={handleReopenInvoice}
                    disabled={paying}
                    className="text-xs font-medium text-zinc-400 hover:text-zinc-200 underline transition disabled:opacity-50"
                  >
                    Desfazer pagamento
                  </button>
                </div>
              ) : (
                <div className="flex w-full items-center justify-between flex-wrap gap-3">
                  <span className="text-xs text-zinc-400">
                    Ao pagar, o valor será deduzido automaticamente da sua conta Nubank.
                  </span>
                  <button
                    onClick={() => setShowPayModal(true)}
                    disabled={invoiceTotal <= 0 || paying}
                    className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-purple-600/30 transition hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <IconCreditCard className="h-4 w-4" />
                    Pagar Fatura
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Modal de Confirmação de Pagamento de Fatura */}
          {showPayModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
                    <IconCreditCard className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Confirmar Pagamento da Fatura</h3>
                    <p className="text-xs text-zinc-400">Mês de referência: {monthLabel(month)}</p>
                  </div>
                </div>

                <div className="mt-5 space-y-3 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Total da Fatura:</span>
                    <span className="font-bold text-white tabular-nums">{formatBRL(invoiceTotal)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-400">Saldo atual na Nubank:</span>
                    <span className="font-medium text-purple-300 tabular-nums">{formatBRL(currentNubankBalance)}</span>
                  </div>
                  <div className="border-t border-zinc-800 pt-2 flex justify-between font-semibold">
                    <span className="text-zinc-300">Saldo Nubank previsto após pagar:</span>
                    <span className="text-emerald-400 tabular-nums">{formatBRL(balanceAfterPayment)}</span>
                  </div>
                </div>

                <p className="mt-4 text-xs text-zinc-400 leading-relaxed">
                  Ao confirmar, o valor de <strong>{formatBRL(invoiceTotal)}</strong> será debitado diretamente do seu saldo em conta da <strong>Nubank</strong> e o status da fatura deste mês mudará para <strong>Paga</strong>.
                </p>

                <div className="mt-6 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setShowPayModal(false)}
                    disabled={paying}
                    className="rounded-xl border border-zinc-800 px-4 py-2 text-sm font-semibold text-zinc-400 hover:bg-zinc-900 hover:text-white transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handlePayInvoice}
                    disabled={paying}
                    className="flex items-center gap-2 rounded-xl bg-purple-600 px-5 py-2 text-sm font-bold text-white hover:bg-purple-500 transition shadow-lg shadow-purple-600/30 disabled:opacity-50"
                  >
                    {paying ? 'Processando...' : 'Confirmar e Pagar'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Filtros da lista */}
          <Card className="space-y-3">
            <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
              <div>
                <p className="text-xs text-zinc-500 uppercase tracking-wide">Compras no Cartão</p>
                <p className="text-xl font-bold tracking-tight text-white">{formatBRL(totalFiltered)}</p>
              </div>
              <span className="text-xs text-zinc-400 bg-zinc-900 px-2.5 py-1 rounded-full border border-zinc-800">
                {filtered.length} {filtered.length === 1 ? 'item' : 'itens'}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              {/* Busca por texto */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Buscar compra ou categoria..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-purple-500/60"
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
                className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-purple-500/60"
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
            <Card className="text-center py-10 text-zinc-500">
              <p className="text-sm">Nenhum gasto de cartão encontrado neste mês.</p>
              {(search || selectedCategory !== 'all') && (
                <button
                  onClick={() => {
                    setSearch('');
                    setSelectedCategory('all');
                  }}
                  className="mt-3 text-xs text-purple-400 hover:underline"
                >
                  Limpar filtros
                </button>
              )}
            </Card>
          ) : (
            <div className="space-y-4">
              {grouped.map(([day, items]) => (
                <div key={day}>
                  <div className="mb-1.5 flex justify-between px-1 text-xs font-medium text-zinc-500">
                    <span>{dayLabel(day)}</span>
                    <span className="tabular-nums font-semibold text-zinc-400">
                      {formatBRL(items.reduce((s, x) => s + x.amount_cents, 0))}
                    </span>
                  </div>
                  <Card className="divide-y divide-zinc-900 !p-0">
                    {items.map((exp) => (
                      <div
                        key={exp.id}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/40 transition"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-semibold text-sm text-zinc-100">
                              {exp.title || exp.category_name}
                            </p>
                            <span className="inline-block rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-purple-400 border border-zinc-800">
                              {exp.category_name}
                            </span>
                            {exp.installment_total > 1 ? (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold border bg-purple-500/10 text-purple-300 border-purple-500/20">
                                Parcela {exp.installment_current}/{exp.installment_total}
                              </span>
                            ) : (
                              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold border bg-zinc-800 text-zinc-300 border-zinc-700">
                                À vista no crédito
                              </span>
                            )}
                          </div>
                          {exp.description && (
                            <p className="truncate text-xs text-zinc-400 mt-0.5 font-normal">
                              {exp.description}
                            </p>
                          )}
                        </div>
                        <span className="font-semibold text-base tabular-nums text-white">
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

      {/* Modal de Edição */}
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
