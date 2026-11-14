import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, type Category, type Expense, type Inflow, type UserAccount } from '../api';
import { useMonth, useToast } from '../context';
import { dayLabel, formatBRL, monthLabel } from '../format';
import {
  Card,
  CollapseButton,
  IconDownload,
  IconEdit,
  IconPlus,
  IconSearch,
  IconTrash,
  MonthPicker,
  PageTitle,
  Spinner,
  useCollapsible,
} from '../components/ui';
import { exportCsv, exportPdf, fetchExportData } from '../export';
import EditExpenseModal from '../components/EditExpenseModal';
import DistributionChart from '../components/DistributionChart';

export default function History() {
  const { month } = useMonth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const listCollapse = useCollapsible('history_list', true);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<string>('all');
  const [exporting, setExporting] = useState(false);

  async function runExport(kind: 'csv' | 'pdf') {
    setExporting(true);
    try {
      const data = await fetchExportData();
      if (kind === 'csv') exportCsv(data, exportScope);
      else await exportPdf(data, exportScope);
      toast(`Arquivo ${kind.toUpperCase()} gerado com sucesso!`);
      setExportOpen(false);
    } catch (err) {
      toast((err as Error).message || 'Falha ao exportar', 'error');
    } finally {
      setExporting(false);
    }
  }

  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [inflows, setInflows] = useState<Inflow[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [userAccounts, setUserAccounts] = useState<UserAccount[]>([]);

  // Filtros
  const initialCategory = searchParams.get('categoria') || 'all';
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'expense' | 'inflow'>('all');
  const [search, setSearch] = useState<string>('');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  // Sincroniza se o parâmetro na URL mudar
  useEffect(() => {
    const cat = searchParams.get('categoria');
    if (cat) setSelectedCategory(cat);
  }, [searchParams]);

  function handleCategorySelect(catId: string) {
    setSelectedCategory(catId);
    if (catId === 'all') {
      searchParams.delete('categoria');
      setSearchParams(searchParams, { replace: true });
    } else {
      searchParams.set('categoria', catId);
      setSearchParams(searchParams, { replace: true });
    }
  }

  const load = useCallback(async () => {
    try {
      const [e, inf, c, accs] = await Promise.all([
        api<Expense[]>(`/expenses?month=${month}`),
        api<Inflow[]>(`/inflows?month=${month}`),
        api<Category[]>('/categories'),
        api<UserAccount[]>('/accounts').catch(() => []),
      ]);
      setExpenses(e);
      setInflows(inf);
      setCategories(c);
      setUserAccounts(accs);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [month, toast]);

  useEffect(() => {
    setExpenses(null);
    setInflows(null);
    load();
  }, [load]);

  async function removeExpense(exp: Expense) {
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

    if (!confirm(`Deseja excluir o gasto de ${formatBRL(exp.amount_cents)} em ${exp.category_name}?`)) return;
    try {
      await api(`/expenses/${exp.id}`, { method: 'DELETE' });
      toast('Lançamento excluído');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  async function removeInflow(inf: Inflow) {
    const accInfo = userAccounts.find((a) => a.slug === inf.account_id);
    if (
      !confirm(
        `Deseja excluir a entrada de ${formatBRL(inf.amount_cents)} (${inf.description || 'Entrada'})?\n` +
          `O saldo da conta ${accInfo?.name ?? 'Conta'} será ajustado (descontando esse valor).`,
      )
    )
      return;
    try {
      await api(`/inflows/${inf.id}`, { method: 'DELETE' });
      toast('Entrada excluída');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  // Itens unificados do Extrato
  type ExtratoItem =
    | { kind: 'expense'; data: Expense; date: string; id: string }
    | { kind: 'inflow'; data: Inflow; date: string; id: string };

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result: ExtratoItem[] = [];

    // Saídas (Expenses)
    if (typeFilter === 'all' || typeFilter === 'expense') {
      (expenses ?? []).forEach((item) => {
        const matchesCategory =
          selectedCategory === 'all' || item.category_id === Number(selectedCategory);
        const matchesAccount =
          selectedAccount === 'all' || item.account_id === selectedAccount;
        const matchesSearch =
          !q ||
          (item.title && item.title.toLowerCase().includes(q)) ||
          (item.description && item.description.toLowerCase().includes(q)) ||
          item.category_name.toLowerCase().includes(q);

        if (matchesCategory && matchesAccount && matchesSearch) {
          result.push({ kind: 'expense', data: item, date: item.spent_on, id: `exp_${item.id}` });
        }
      });
    }

    // Entradas (Inflows)
    if (typeFilter === 'all' || typeFilter === 'inflow') {
      (inflows ?? []).forEach((item) => {
        // Se houver filtro de categoria selecionado, entradas não possuem categoria de despesa
        const matchesCategory = selectedCategory === 'all';
        const matchesAccount =
          selectedAccount === 'all' || item.account_id === selectedAccount;
        const matchesSearch =
          !q || (item.description && item.description.toLowerCase().includes(q));

        if (matchesCategory && matchesAccount && matchesSearch) {
          result.push({ kind: 'inflow', data: item, date: item.received_on, id: `inf_${item.id}` });
        }
      });
    }

    return result;
  }, [expenses, inflows, typeFilter, selectedCategory, selectedAccount, search]);

  const totalFilteredExpenses = useMemo(() => {
    return filteredItems
      .filter((i): i is ExtratoItem & { kind: 'expense' } => i.kind === 'expense')
      .reduce((acc, curr) => acc + curr.data.amount_cents, 0);
  }, [filteredItems]);

  const totalFilteredInflows = useMemo(() => {
    return filteredItems
      .filter((i): i is ExtratoItem & { kind: 'inflow' } => i.kind === 'inflow')
      .reduce((acc, curr) => acc + curr.data.amount_cents, 0);
  }, [filteredItems]);

  // Distribuição dos gastos filtrados por categoria (apenas saídas)
  const categoryDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of filteredItems) {
      if (item.kind === 'expense') {
        const name = item.data.category_name || 'Outros';
        map.set(name, (map.get(name) ?? 0) + item.data.amount_cents);
      }
    }
    return [...map.entries()].map(([name, amount_cents]) => ({
      name,
      amount_cents,
    }));
  }, [filteredItems]);

  // Agrupamento por dia (ordenado do mais recente pro mais antigo)
  const grouped = useMemo(() => {
    const map = new Map<string, ExtratoItem[]>();
    for (const e of filteredItems) {
      map.set(e.date, [...(map.get(e.date) ?? []), e]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filteredItems]);

  const activeCategoryObj = useMemo(() => {
    if (selectedCategory === 'all') return null;
    return categories.find((c) => String(c.id) === selectedCategory) ?? null;
  }, [selectedCategory, categories]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle
          title="Extrato Completo"
          subtitle={`Histórico detalhado de saídas e entradas em ${monthLabel(month)}`}
        />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExportOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-zinc-200 transition hover:bg-zinc-800"
            title="Exportar dados (PDF ou CSV)"
          >
            <IconDownload className="h-4 w-4 text-emerald-400" />
            Exportar
          </button>
          <Link
            to="/lancar"
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 px-3.5 py-2.5 text-xs sm:text-sm font-extrabold text-black shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
          >
            <IconPlus className="h-4 w-4 stroke-[2.4]" /> Novo Lançamento
          </Link>
        </div>
      </div>

      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Exportar Relatório</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Inclui ganhos, tetos por categoria, gastos detalhados e investimentos.
            </p>

            <label className="mt-4 mb-1.5 block text-xs font-bold tracking-wider text-zinc-400 uppercase">
              Período de exportação
            </label>
            <div className="grid grid-cols-2 gap-2">
              {([['all', 'Histórico Completo'], [month, monthLabel(month)]] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setExportScope(val)}
                  className={`rounded-xl border px-3 py-2 text-xs font-bold capitalize transition ${
                    exportScope === val
                      ? 'border-emerald-400 bg-emerald-400/15 text-emerald-300'
                      : 'border-white/[0.08] bg-zinc-900 text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <button
                disabled={exporting}
                onClick={() => runExport('csv')}
                className="rounded-xl bg-emerald-400 py-3 text-sm font-extrabold text-black hover:bg-emerald-300 disabled:opacity-60"
              >
                {exporting ? 'Gerando…' : 'Baixar CSV'}
                <span className="block text-[10px] font-medium opacity-75">Planilhas & IA</span>
              </button>
              <button
                disabled={exporting}
                onClick={() => runExport('pdf')}
                className="rounded-xl border border-white/[0.1] bg-zinc-900 py-3 text-sm font-bold text-white hover:bg-zinc-800 disabled:opacity-60"
              >
                {exporting ? 'Gerando…' : 'Baixar PDF'}
                <span className="block text-[10px] font-normal text-zinc-400">Relatório Visual</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setExportOpen(false)}
              className="mt-3 w-full rounded-xl bg-zinc-900 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <MonthPicker />

      {/* Alerta de Categoria Ativa (quando veio pelo clique na Home) */}
      {activeCategoryObj && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-blue-500/35 bg-blue-500/10 p-3.5 shadow-lg shadow-blue-500/5">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="h-2.5 w-2.5 rounded-full bg-blue-400 ring-2 ring-blue-400/20 shrink-0" />
            <div className="min-w-0">
              <p className="text-xs text-blue-300 font-medium">Filtrando extrato pela categoria:</p>
              <p className="text-sm font-extrabold text-white truncate">{activeCategoryObj.name}</p>
            </div>
          </div>
          <button
            onClick={() => handleCategorySelect('all')}
            className="shrink-0 rounded-xl bg-blue-500/20 hover:bg-blue-500/30 border border-blue-500/40 px-3 py-1.5 text-xs font-bold text-blue-200 transition"
          >
            Limpar filtro ✕
          </button>
        </div>
      )}

      {/* Gráfico de distribuição dos gastos realizados */}
      {totalFilteredExpenses > 0 && selectedCategory === 'all' && (
        <DistributionChart
          title="Distribuição dos Gastos Realizados"
          subtitle="Para onde foi o seu dinheiro de acordo com as saídas listadas abaixo"
          items={categoryDistribution}
          storageKey="history_distribution"
        />
      )}

      {/* Resumo e Filtros */}
      <Card className="space-y-4">
        {/* Balanço Filtrado: Saídas, Entradas e Saldo */}
        <div
          className={`flex flex-wrap items-center justify-between gap-3 ${
            listCollapse.isOpen ? 'border-b border-white/[0.06] pb-3.5' : ''
          } cursor-pointer select-none group`}
          onClick={listCollapse.toggle}
        >
          <div className="flex items-center gap-3">
            <CollapseButton
              isOpen={listCollapse.isOpen}
              onToggle={listCollapse.toggle}
            />
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider group-hover:text-emerald-300 transition">
                  Saídas Filtradas
                </p>
                <p className="text-xl sm:text-2xl font-black tracking-tight text-white tabular-nums">
                  {formatBRL(totalFilteredExpenses)}
                </p>
              </div>
              {totalFilteredInflows > 0 && (
                <>
                  <div className="h-8 w-px bg-white/[0.08] hidden sm:block" />
                  <div>
                    <p className="text-[11px] font-bold text-emerald-400 uppercase tracking-wider">
                      Entradas
                    </p>
                    <p className="text-xl sm:text-2xl font-black tracking-tight text-emerald-400 tabular-nums">
                      +{formatBRL(totalFilteredInflows)}
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Abas de Tipo: Todos / Saídas / Entradas */}
          {listCollapse.isOpen && (
            <div
              className="flex items-center rounded-xl border border-white/[0.08] bg-zinc-900 p-1 text-xs"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setTypeFilter('all')}
                className={`rounded-lg px-2.5 py-1 font-bold transition ${
                  typeFilter === 'all' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Todos ({filteredItems.length})
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('expense')}
                className={`rounded-lg px-2.5 py-1 font-bold transition ${
                  typeFilter === 'expense' ? 'bg-rose-500/20 text-rose-300' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Saídas
              </button>
              <button
                type="button"
                onClick={() => setTypeFilter('inflow')}
                className={`rounded-lg px-2.5 py-1 font-bold transition ${
                  typeFilter === 'inflow' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Entradas
              </button>
            </div>
          )}
        </div>

        {listCollapse.isOpen && (
          <>

        {/* Filtro Rápido por Conta */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
          <button
            type="button"
            onClick={() => setSelectedAccount('all')}
            className={`shrink-0 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
              selectedAccount === 'all'
                ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-300'
                : 'border-white/[0.07] bg-zinc-900 text-zinc-400 hover:text-white'
            }`}
          >
            Todas as Contas
          </button>
          {userAccounts.map((acc) => (
            <button
              key={acc.slug}
              type="button"
              onClick={() => setSelectedAccount(acc.slug)}
              className={`shrink-0 flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                selectedAccount === acc.slug
                  ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                  : 'border-white/[0.07] bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: acc.color }} />
              {acc.name}
            </button>
          ))}
        </div>

        {/* Busca e Dropdown de Categorias */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Busca por texto */}
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar lançamento por nome, loja ou detalhe..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 pl-9 pr-8 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
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
            onChange={(e) => handleCategorySelect(e.target.value)}
            className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
          >
            <option value="all">Todas as categorias</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
          </>
        )}
      </Card>

      {/* Lista do Extrato */}
      {listCollapse.isOpen && (
        !expenses || !inflows ? (
          <Spinner />
      ) : filteredItems.length === 0 ? (
        <Card className="text-center py-12 text-zinc-500">
          <p className="text-sm font-medium">Nenhum lançamento encontrado para os filtros selecionados.</p>
          {(search || selectedCategory !== 'all' || selectedAccount !== 'all' || typeFilter !== 'all') && (
            <button
              onClick={() => {
                setSearch('');
                handleCategorySelect('all');
                setSelectedAccount('all');
                setTypeFilter('all');
              }}
              className="mt-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 transition"
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
                <span className="tabular-nums text-zinc-400">
                  {items.length} {items.length === 1 ? 'registro' : 'registros'}
                </span>
              </div>
              <Card className="divide-y divide-white/[0.06] !p-0 overflow-hidden">
                {items.map((item) => {
                  if (item.kind === 'inflow') {
                    const inf = item.data;
                    const accInfo = userAccounts.find((a) => a.slug === inf.account_id);
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-900/50 transition bg-emerald-500/[0.02]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="font-bold text-sm text-zinc-100">
                              {inf.description || 'Entrada em conta'}
                            </p>
                            <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold text-emerald-300 border border-emerald-500/30">
                              Entrada
                            </span>
                            <span
                              className="rounded-md px-2 py-0.5 text-[10px] font-semibold border bg-zinc-800 text-zinc-300 border-zinc-700"
                            >
                              {accInfo?.name ?? inf.account_id}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-500 mt-0.5">Crédito em conta</p>
                        </div>
                        <span className="font-extrabold text-sm sm:text-base tabular-nums text-emerald-400">
                          +{formatBRL(inf.amount_cents)}
                        </span>
                        <button
                          onClick={() => removeInflow(inf)}
                          className="rounded-lg p-1.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition"
                          title="Excluir entrada"
                          aria-label="Excluir entrada"
                        >
                          <IconTrash className="h-4 w-4" />
                        </button>
                      </div>
                    );
                  }

                  // Saída (Expense)
                  const exp = item.data;
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-900/50 transition"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-sm text-zinc-100">
                            {exp.title || exp.category_name}
                          </p>
                          <span className="inline-block rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-white/[0.07]">
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
                          <p className="truncate text-xs text-zinc-400 mt-0.5 font-normal">{exp.description}</p>
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
                        onClick={() => removeExpense(exp)}
                        className="rounded-lg p-1.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition"
                        title="Excluir gasto"
                        aria-label="Excluir"
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </Card>
            </div>
          ))}
        </div>
      ))}

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
