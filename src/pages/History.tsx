import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type Category, type Expense, ACCOUNT_DEFINITIONS } from '../api';
import { useMonth, useToast } from '../context';
import { dayLabel, formatBRL, monthLabel } from '../format';
import {
  Card,
  IconDownload,
  IconEdit,
  IconPlus,
  IconSearch,
  IconTrash,
  MonthPicker,
  PageTitle,
  Spinner,
} from '../components/ui';
import { exportCsv, exportPdf, fetchExportData } from '../export';
import EditExpenseModal from '../components/EditExpenseModal';
import DistributionChart from '../components/DistributionChart';

export default function History() {
  const { month } = useMonth();
  const toast = useToast();

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
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedAccount, setSelectedAccount] = useState<string>('all');
  const [search, setSearch] = useState<string>('');
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, c] = await Promise.all([
        api<Expense[]>(`/expenses?month=${month}`),
        api<Category[]>('/categories'),
      ]);
      setExpenses(e);
      setCategories(c);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }, [month, toast]);

  useEffect(() => {
    setExpenses(null);
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

    if (!confirm(`Deseja excluir o gasto de ${formatBRL(exp.amount_cents)} em ${exp.category_name}?`)) return;
    try {
      await api(`/expenses/${exp.id}`, { method: 'DELETE' });
      toast('Lançamento excluído');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  // Filtragem por busca, conta e categoria
  const filtered = useMemo(() => {
    if (!expenses) return [];
    const q = search.trim().toLowerCase();
    return expenses.filter((item) => {
      const matchesCategory =
        selectedCategory === 'all' || item.category_id === Number(selectedCategory);
      const matchesAccount =
        selectedAccount === 'all' || item.account_id === selectedAccount;
      const matchesSearch =
        !q ||
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        item.category_name.toLowerCase().includes(q);
      return matchesCategory && matchesAccount && matchesSearch;
    });
  }, [expenses, selectedCategory, selectedAccount, search]);

  const totalFiltered = useMemo(() => {
    return filtered.reduce((acc, curr) => acc + curr.amount_cents, 0);
  }, [filtered]);

  // Distribuição dos gastos filtrados por categoria
  const categoryDistribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const exp of filtered) {
      const name = exp.category_name || 'Outros';
      map.set(name, (map.get(name) ?? 0) + exp.amount_cents);
    }
    return [...map.entries()].map(([name, amount_cents]) => ({
      name,
      amount_cents,
    }));
  }, [filtered]);

  // Agrupamento por dia (ordenado do mais recente pro mais antigo)
  const grouped = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of filtered) {
      map.set(e.spent_on, [...(map.get(e.spent_on) ?? []), e]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageTitle
          title="Extrato Completo"
          subtitle={`Todos os gastos registrados em ${monthLabel(month)}`}
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
            <IconPlus className="h-4 w-4 stroke-[2.4]" /> Novo Gasto
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

      {/* Gráfico de distribuição dos gastos realizados */}
      {totalFiltered > 0 && (
        <DistributionChart
          title="Distribuição dos Gastos Realizados"
          subtitle="Para onde foi o seu dinheiro de acordo com os lançamentos listados abaixo"
          items={categoryDistribution}
        />
      )}

      {/* Resumo e Filtros */}
      <Card className="space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
          <div>
            <p className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
              Total Filtrado no Extrato
            </p>
            <p className="text-2xl font-black tracking-tight text-white tabular-nums">
              {formatBRL(totalFiltered)}
            </p>
          </div>
          <span className="rounded-full border border-white/[0.08] bg-zinc-900 px-3 py-1 text-xs font-bold text-zinc-300">
            {filtered.length} {filtered.length === 1 ? 'lançamento' : 'lançamentos'}
          </span>
        </div>

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
          {ACCOUNT_DEFINITIONS.map((acc) => (
            <button
              key={acc.id}
              type="button"
              onClick={() => setSelectedAccount(acc.id)}
              className={`shrink-0 flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-bold transition ${
                selectedAccount === acc.id
                  ? `${acc.badgeClass} border-current`
                  : 'border-white/[0.07] bg-zinc-900 text-zinc-400 hover:text-white'
              }`}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: acc.color }} />
              {acc.tag}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {/* Busca por texto */}
          <div className="relative">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Buscar por título, descrição ou categoria..."
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
            onChange={(e) => setSelectedCategory(e.target.value)}
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
      </Card>

      {/* Lista do Extrato */}
      {!expenses ? (
        <Spinner />
      ) : filtered.length === 0 ? (
        <Card className="text-center py-12 text-zinc-500">
          <p className="text-sm font-medium">Nenhum lançamento encontrado para os filtros selecionados.</p>
          {(search || selectedCategory !== 'all' || selectedAccount !== 'all') && (
            <button
              onClick={() => {
                setSearch('');
                setSelectedCategory('all');
                setSelectedAccount('all');
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
