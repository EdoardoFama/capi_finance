import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  api,
  batchDeleteExpenses,
  batchUpdateCategory,
  getCategoryIcon,
  getExpensesRange,
  type Category,
  type Expense,
  type Inflow,
  type UserAccount,
} from '../api';
import { useMonth, useToast, useConfirm, useConfirmChoice, useViewMode } from '../context';
import { dayLabel, formatBRL, monthLabel, parseBRL } from '../format';
import {
  Card,
  CollapseButton,
  CustomSelect,
  IconDownload,
  IconEdit,
  IconList,
  IconPlus,
  IconSearch,
  IconTrash,
  IconTrendingUp,
  Modal,
  MonthPicker,
  PageTitle,
  Spinner,
  useCollapsible,
} from '../components/ui';
import { exportCsv, exportPdf, fetchExportData } from '../export';
import EditExpenseModal from '../components/EditExpenseModal';
import DistributionChart from '../components/DistributionChart';
import MonthlyAnalyticsView from '../components/MonthlyAnalyticsView';

export default function History() {
  const { month } = useMonth();
  const { isSimple } = useViewMode();
  const toast = useToast();
  const confirm = useConfirm();
  const confirmChoice = useConfirmChoice();
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<'monthly' | 'analytics'>('monthly');

  const listCollapse = useCollapsible('history_list', true);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<string>('all');
  const [exportStartMonth, setExportStartMonth] = useState<string>(month);
  const [exportEndMonth, setExportEndMonth] = useState<string>(month);
  const [exporting, setExporting] = useState(false);

  async function runExport(kind: 'csv' | 'pdf') {
    setExporting(true);
    try {
      if (exportScope === 'range' && kind === 'csv') {
        const rangeExps = await getExpensesRange(exportStartMonth, exportEndMonth);
        const rows = [
          ['Data', 'Titulo', 'Categoria', 'Valor (R$)', 'Pagamento', 'Conta', 'Parcela', 'Tags', 'Observacao'],
          ...rangeExps.map((e) => [
            e.spent_on,
            `"${(e.title || '').replace(/"/g, '""')}"`,
            `"${(e.category_name || '').replace(/"/g, '""')}"`,
            (e.amount_cents / 100).toFixed(2).replace('.', ','),
            e.payment_method,
            e.account_id,
            e.installment_total > 1 ? `${e.installment_current}/${e.installment_total}` : '1/1',
            `"${(e.tags || '').replace(/"/g, '""')}"`,
            `"${(e.description || '').replace(/"/g, '""')}"`,
          ]),
        ];
        const csvContent = '\uFEFF' + rows.map((r) => r.join(';')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `capi-finance-${exportStartMonth}-a-${exportEndMonth}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        toast(`CSV do período (${exportStartMonth} a ${exportEndMonth}) gerado!`);
        setExportOpen(false);
        return;
      }

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

  // Filtros Combinados (Itens 20, 41, 44, 46)
  const initialCategory = searchParams.get('categoria') || 'all';
  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory);
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'expense' | 'inflow'>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'credit' | 'debit_pix'>('all');
  const [search, setSearch] = useState<string>(searchParams.get('busca') || '');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  // Ações em Lote (Itens 42 e 43)
  const [batchMode, setBatchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [batchCatId, setBatchCatId] = useState<string>('');
  const [batchBusy, setBatchBusy] = useState(false);

  function toggleSelectExpense(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBatchCategory() {
    if (selectedIds.size === 0) return toast('Selecione ao menos 1 lançamento', 'error');
    if (!batchCatId) return toast('Escolha a nova categoria', 'error');
    setBatchBusy(true);
    try {
      const res = await batchUpdateCategory(Array.from(selectedIds), Number(batchCatId));
      toast(`${res.updated_count} lançamento(s) movido(s) para a nova categoria!`);
      setSelectedIds(new Set());
      setBatchMode(false);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBatchBusy(false);
    }
  }

  async function handleBatchDelete() {
    if (selectedIds.size === 0) return toast('Selecione ao menos 1 lançamento', 'error');
    const ok = await confirm({
      title: `Excluir ${selectedIds.size} Lançamento(s)?`,
      message: `Deseja realmente excluir os ${selectedIds.size} lançamentos selecionados de uma vez?`,
      confirmText: 'Excluir Todos Selecionados',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    setBatchBusy(true);
    try {
      const res = await batchDeleteExpenses(Array.from(selectedIds));
      toast(`${res.deleted_count} lançamento(s) excluído(s)!`);
      setSelectedIds(new Set());
      setBatchMode(false);
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBatchBusy(false);
    }
  }

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
      const choice = await confirmChoice({
        title: 'Excluir Gasto Parcelado',
        message: `Este gasto é parcelado (${exp.installment_current}/${exp.installment_total}) no valor de ${formatBRL(exp.amount_cents)}.\n\nComo deseja proceder?`,
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
      title: 'Excluir Lançamento?',
      message: `Deseja realmente excluir o gasto de ${formatBRL(exp.amount_cents)} em ${exp.category_name}?`,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

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
    const ok = await confirm({
      title: 'Excluir Entrada?',
      message: `Deseja excluir a entrada de ${formatBRL(inf.amount_cents)} (${inf.description || 'Entrada'})?\n\nO saldo da conta ${accInfo?.name ?? 'Conta'} será ajustado (descontando esse valor).`,
      confirmText: 'Excluir Entrada',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

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

    // Item 46: Operadores de busca por valor exato ou aproximado (ex: ">100", "<50", "=42,80")
    let valOperator: '>' | '<' | '=' | null = null;
    let valTargetCents: number | null = null;
    if (/^[><=]\s*\d/.test(q)) {
      valOperator = q[0] as '>' | '<' | '=';
      valTargetCents = parseBRL(q.slice(1).trim());
    }

    const checkValueMatch = (cents: number) => {
      if (!valOperator || valTargetCents === null) return true;
      if (valOperator === '>') return cents >= valTargetCents;
      if (valOperator === '<') return cents <= valTargetCents;
      return Math.abs(cents - valTargetCents) <= 50; // margem de R$ 0,50 ou exato
    };

    // Saídas (Expenses)
    if (typeFilter === 'all' || typeFilter === 'expense') {
      (expenses ?? []).forEach((item) => {
        const matchesCategory =
          selectedCategory === 'all' || item.category_id === Number(selectedCategory);
        const matchesAccount =
          selectedAccount === 'all' || item.account_id === selectedAccount;
        const matchesPayment =
          paymentFilter === 'all' ||
          (paymentFilter === 'credit' && item.payment_method === 'credit') ||
          (paymentFilter === 'debit_pix' && item.payment_method !== 'credit');

        const matchesSearch =
          !q ||
          (valOperator && valTargetCents !== null
            ? checkValueMatch(item.amount_cents)
            : (item.title && item.title.toLowerCase().includes(q)) ||
              (item.description && item.description.toLowerCase().includes(q)) ||
              (item.tags && item.tags.toLowerCase().includes(q)) ||
              item.category_name.toLowerCase().includes(q) ||
              (item.amount_cents / 100).toFixed(2).replace('.', ',').includes(q));

        if (matchesCategory && matchesAccount && matchesPayment && matchesSearch) {
          result.push({ kind: 'expense', data: item, date: item.spent_on, id: `exp_${item.id}` });
        }
      });
    }

    // Entradas (Inflows)
    if ((typeFilter === 'all' || typeFilter === 'inflow') && paymentFilter === 'all') {
      (inflows ?? []).forEach((item) => {
        const matchesCategory = selectedCategory === 'all';
        const matchesAccount =
          selectedAccount === 'all' || item.account_id === selectedAccount;
        const matchesSearch =
          !q ||
          (valOperator && valTargetCents !== null
            ? checkValueMatch(item.amount_cents)
            : (item.description && item.description.toLowerCase().includes(q)));

        if (matchesCategory && matchesAccount && matchesSearch) {
          result.push({ kind: 'inflow', data: item, date: item.received_on, id: `inf_${item.id}` });
        }
      });
    }

    return result;
  }, [expenses, inflows, typeFilter, paymentFilter, selectedCategory, selectedAccount, search]);

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

  // Distribuição dos gastos por categoria (apenas saídas do mês)
  const categoryDistribution = useMemo(() => {
    if (!expenses) return [];
    const map = new Map<string, { amount: number; id: number }>();
    for (const exp of expenses) {
      const name = exp.category_name || 'Outros';
      const prev = map.get(name);
      if (prev) {
        prev.amount += exp.amount_cents;
      } else {
        map.set(name, { amount: exp.amount_cents, id: exp.category_id });
      }
    }
    return [...map.entries()]
      .map(([name, data]) => {
        const isSelected = String(selectedCategory) === String(data.id);
        return {
          id: data.id,
          name,
          amount_cents: data.amount,
          isSelected,
          onClick: () => {
            if (String(selectedCategory) === String(data.id)) {
              handleCategorySelect('all');
            } else {
              handleCategorySelect(String(data.id));
              if (!listCollapse.isOpen) {
                listCollapse.setIsOpen(true);
              }
              setTimeout(() => {
                const el = document.getElementById('extrato-filtros-section');
                if (el) {
                  el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }, 60);
            }
          },
        };
      })
      .sort((a, b) => b.amount_cents - a.amount_cents);
  }, [expenses, selectedCategory, listCollapse, handleCategorySelect]);

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
          {!isSimple && (
            <button
              onClick={() => setExportOpen(true)}
              className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2.5 text-xs sm:text-sm font-bold text-zinc-200 transition hover:bg-zinc-800"
              title="Exportar dados (PDF ou CSV)"
            >
              <IconDownload className="h-4 w-4 text-emerald-400" />
              Exportar
            </button>
          )}
          <Link
            to="/lancar"
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 px-3.5 py-2.5 text-xs sm:text-sm font-extrabold text-black shadow-lg shadow-emerald-500/20 transition hover:brightness-110"
          >
            <IconPlus className="h-4 w-4 stroke-[2.4]" /> Novo Lançamento
          </Link>
        </div>
      </div>

      {/* Segmented Control: Extrato Mensal vs Comparativo Histórico */}
      {!isSimple && (
        <div className="grid grid-cols-2 gap-1.5 rounded-2xl border border-white/[0.08] bg-zinc-950/70 p-1 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setViewMode('monthly')}
            className={`flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-xs sm:text-sm font-bold min-h-[42px] transition ${
              viewMode === 'monthly'
                ? 'bg-zinc-800 text-white shadow border border-white/10'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <IconList className="h-4 w-4 shrink-0" />
            <span className="truncate">Extrato Mensal</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode('analytics')}
            className={`flex items-center justify-center gap-2 rounded-xl py-2 px-3 text-xs sm:text-sm font-bold min-h-[42px] transition ${
              viewMode === 'analytics'
                ? 'bg-gradient-to-r from-emerald-500/20 to-teal-500/20 border border-emerald-500/40 text-emerald-300 shadow'
                : 'text-zinc-400 hover:text-zinc-200 border border-transparent'
            }`}
          >
            <IconTrendingUp className="h-4 w-4 shrink-0" />
            <span className="truncate">Comparativo (6 Meses)</span>
          </button>
        </div>
      )}

      {!isSimple && viewMode === 'analytics' ? (
        <MonthlyAnalyticsView currentMonth={month} />
      ) : (
        <>
      <Modal
        isOpen={exportOpen}
        onClose={() => setExportOpen(false)}
        maxWidth="max-w-sm"
      >
        <h3 className="text-lg font-bold text-white">Exportar Relatório</h3>
        <p className="mt-1 text-xs text-zinc-400">
          Inclui ganhos, tetos por categoria, gastos detalhados e investimentos.
        </p>

            <label className="mt-4 mb-1.5 block text-xs font-bold tracking-wider text-zinc-400 uppercase">
              Período de exportação (Item 45)
            </label>
            <div className="grid grid-cols-3 gap-1.5">
              {(
                [
                  ['all', 'Tudo'],
                  [month, monthLabel(month)],
                  ['range', 'Meses / Ano'],
                ] as const
              ).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setExportScope(val)}
                  className={`rounded-xl border px-2 py-2 text-[11px] font-bold capitalize transition ${
                    exportScope === val
                      ? 'border-emerald-400 bg-emerald-400/15 text-emerald-300'
                      : 'border-white/[0.08] bg-zinc-900 text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {exportScope === 'range' && (
              <div className="mt-3 space-y-2 rounded-xl border border-white/10 bg-zinc-900/60 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 mb-1">Mês Inicial</label>
                    <input
                      type="month"
                      value={exportStartMonth}
                      onChange={(e) => setExportStartMonth(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-black px-2 py-1 text-xs text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-zinc-400 mb-1">Mês Final</label>
                    <input
                      type="month"
                      value={exportEndMonth}
                      onChange={(e) => setExportEndMonth(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-black px-2 py-1 text-xs text-white"
                    />
                  </div>
                </div>
                <div className="flex gap-1.5 pt-1">
                  {['2025', '2026'].map((yr) => (
                    <button
                      key={yr}
                      type="button"
                      onClick={() => {
                        setExportStartMonth(`${yr}-01`);
                        setExportEndMonth(`${yr}-12`);
                      }}
                      className="flex-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 py-1 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/20"
                    >
                      Ano Inteiro {yr}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
      </Modal>

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
      {!isSimple && (expenses?.length ?? 0) > 0 && (
        <DistributionChart
          title="Distribuição dos Gastos Realizados"
          subtitle="Para onde foi o seu dinheiro de acordo com as saídas deste mês • Toque para filtrar"
          items={categoryDistribution}
          storageKey="history_distribution"
        />
      )}

      {/* Resumo e Filtros */}
      <Card id="extrato-filtros-section" className="relative z-30 space-y-4">
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
        {!isSimple && (
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
        )}

        {/* Item 20 & 42/43: Alternador Rápido Crédito vs Débito + Botão Modo Lote */}
        {!isSimple && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 rounded-xl border border-white/[0.07] bg-zinc-950 p-1 text-[11px]">
              <button
                type="button"
                onClick={() => setPaymentFilter('all')}
                className={`rounded-lg px-2.5 py-1 font-bold transition ${
                  paymentFilter === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
                }`}
              >
                Todas Modalidades
              </button>
              <button
                type="button"
                onClick={() => setPaymentFilter('credit')}
                className={`rounded-lg px-2.5 py-1 font-bold transition ${
                  paymentFilter === 'credit'
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                💳 Apenas Crédito
              </button>
              <button
                type="button"
                onClick={() => setPaymentFilter('debit_pix')}
                className={`rounded-lg px-2.5 py-1 font-bold transition ${
                  paymentFilter === 'debit_pix'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                ⚡ Apenas Débito / Pix
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setBatchMode((b) => !b);
                setSelectedIds(new Set());
              }}
              className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                batchMode
                  ? 'border-amber-500/40 bg-amber-500/20 text-amber-300'
                  : 'border-white/[0.08] bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {batchMode ? '✕ Sair da Seleção em Lote' : '☑️ Seleção em Lote'}
            </button>
          </div>
        )}

        {/* Barra de Ações em Lote (Itens 42 e 43) */}
        {batchMode && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-amber-500/40 bg-amber-950/20 p-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-amber-300">
                {selectedIds.size} selecionado(s)
              </span>
              <button
                type="button"
                onClick={() => {
                  const allExpIds = filteredItems
                    .filter((i): i is ExtratoItem & { kind: 'expense' } => i.kind === 'expense')
                    .map((i) => i.data.id);
                  if (selectedIds.size === allExpIds.length) setSelectedIds(new Set());
                  else setSelectedIds(new Set(allExpIds));
                }}
                className="text-[11px] font-semibold text-zinc-300 underline hover:text-white"
              >
                Selecionar/Desmarcar Todos
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <select
                value={batchCatId}
                onChange={(e) => setBatchCatId(e.target.value)}
                className="rounded-xl border border-white/15 bg-zinc-900 px-2.5 py-1.5 text-xs text-white"
              >
                <option value="">Mover p/ categoria...</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={batchBusy || selectedIds.size === 0 || !batchCatId}
                onClick={handleBatchCategory}
                className="rounded-xl bg-emerald-400 px-3 py-1.5 text-xs font-extrabold text-black hover:bg-emerald-300 disabled:opacity-40"
              >
                Aplicar Categoria
              </button>
              <button
                type="button"
                disabled={batchBusy || selectedIds.size === 0}
                onClick={handleBatchDelete}
                className="rounded-xl bg-red-500 px-3 py-1.5 text-xs font-extrabold text-white hover:bg-red-400 disabled:opacity-40"
              >
                🗑️ Excluir Lote
              </button>
            </div>
          </div>
        )}

        {/* Busca e Dropdown de Categorias */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Busca por texto ou operador de valor (Item 46) */}
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder={isSimple ? 'Procurar gasto pelo nome...' : 'Buscar nome, #tag ou valor (ex: >100, <50, =42,80)...'}
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

          {/* Filtro por Categoria com CustomSelect */}
          <CustomSelect
            value={selectedCategory}
            onChange={(val) => handleCategorySelect(val)}
            options={[
              { value: 'all', label: 'Todas as categorias' },
              ...categories.map((c) => ({
                value: String(c.id),
                label: `${getCategoryIcon(c.name, c.icon)} ${c.name}`,
              })),
            ]}
            placeholder="Selecione uma categoria"
            searchPlaceholder="Pesquisar categoria..."
          />
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
          {(search || selectedCategory !== 'all' || selectedAccount !== 'all' || typeFilter !== 'all' || paymentFilter !== 'all') && (
            <button
              onClick={() => {
                setSearch('');
                handleCategorySelect('all');
                setSelectedAccount('all');
                setTypeFilter('all');
                setPaymentFilter('all');
              }}
              className="mt-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 px-3 py-1.5 text-xs font-bold text-emerald-300 hover:bg-emerald-500/25 transition"
            >
              Limpar todos os filtros
            </button>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, items]) => {
            const daySubtotalExpenses = items
              .filter((i): i is ExtratoItem & { kind: 'expense' } => i.kind === 'expense')
              .reduce((s, i) => s + i.data.amount_cents, 0);
            return (
            <div key={day}>
              {/* Item 47: Cabeçalho do Dia com Subtotal Diário */}
              <div className="mb-1.5 flex items-center justify-between px-1 text-xs font-semibold text-zinc-400">
                <span className="capitalize font-bold text-zinc-300">{dayLabel(day)}</span>
                <div className="flex items-center gap-3 tabular-nums">
                  {daySubtotalExpenses > 0 && (
                    <span className="text-rose-400/90 font-bold">
                      Subtotal: -{formatBRL(daySubtotalExpenses)}
                    </span>
                  )}
                  <span className="text-zinc-500">
                    {items.length} {items.length === 1 ? 'registro' : 'registros'}
                  </span>
                </div>
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
                  const isCheckedBatch = selectedIds.has(exp.id);
                  return (
                    <div
                      key={item.id}
                      onClick={() => batchMode && toggleSelectExpense(exp.id)}
                      className={`flex items-center gap-3 px-4 py-3.5 transition ${
                        batchMode ? 'cursor-pointer' : ''
                      } ${
                        isCheckedBatch
                          ? 'bg-amber-500/10 hover:bg-amber-500/15'
                          : 'hover:bg-zinc-900/50'
                      }`}
                    >
                      {batchMode && (
                        <input
                          type="checkbox"
                          checked={isCheckedBatch}
                          onChange={() => toggleSelectExpense(exp.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-4 w-4 shrink-0 accent-amber-400"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-bold text-sm text-zinc-100">
                            {exp.title || exp.category_name}
                          </p>
                          <span className="inline-block rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-white/[0.07]">
                            {getCategoryIcon(exp.category_name)} {exp.category_name}
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
                              : exp.account_id.toUpperCase()}
                          </span>
                          {/* Item 44: Tags */}
                          {!isSimple &&
                            exp.tags &&
                            exp.tags
                              .split(/\s+/)
                              .filter(Boolean)
                              .map((tg) => (
                                <button
                                  key={tg}
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSearch(tg);
                                  }}
                                  className="rounded-full bg-cyan-500/15 border border-cyan-500/30 px-2 py-0.5 text-[10px] font-bold text-cyan-300 hover:bg-cyan-500/25"
                                >
                                  {tg.startsWith('#') ? tg : `#${tg}`}
                                </button>
                              ))}
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
          );
          })}
        </div>
      ))}
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
