import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type Category, type Expense } from '../api';
import { useMonth, useToast } from '../context';
import { dayLabel, formatBRL, monthLabel } from '../format';
import { Card, IconPlus, IconTrash, MonthPicker, PageTitle, Spinner } from '../components/ui';
import { exportCsv, exportPdf, fetchExportData } from '../export';

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
      toast(`Arquivo ${kind.toUpperCase()} gerado`);
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
  const [search, setSearch] = useState<string>('');

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

  // Filtragem por busca e categoria
  const filtered = useMemo(() => {
    if (!expenses) return [];
    return expenses.filter((item) => {
      const matchesCategory =
        selectedCategory === 'all' || item.category_id === Number(selectedCategory);
      const matchesSearch =
        !search.trim() ||
        item.description.toLowerCase().includes(search.toLowerCase()) ||
        item.category_name.toLowerCase().includes(search.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [expenses, selectedCategory, search]);

  const totalFiltered = useMemo(() => {
    return filtered.reduce((acc, curr) => acc + curr.amount_cents, 0);
  }, [filtered]);

  // Agrupamento por dia
  const grouped = useMemo(() => {
    const map = new Map<string, Expense[]>();
    for (const e of filtered) {
      map.set(e.spent_on, [...(map.get(e.spent_on) ?? []), e]);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <PageTitle title="Extrato de Gastos" subtitle={`Histórico detalhado de ${monthLabel(month)}`} />
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExportOpen(true)}
            className="flex items-center gap-1.5 rounded-xl border border-zinc-800 bg-zinc-900 px-3.5 py-2 text-sm font-semibold text-zinc-200 transition hover:bg-zinc-800"
            title="Exportar dados (PDF ou CSV)"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
            </svg>
            Exportar
          </button>
          <Link
            to="/lancar"
            className="flex items-center gap-1.5 rounded-xl bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-black transition hover:bg-emerald-300"
          >
            <IconPlus className="h-4 w-4" /> Novo
          </Link>
        </div>
      </div>

      {exportOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Exportar dados</h3>
            <p className="mt-1 text-xs text-zinc-400">
              Inclui ganhos, tetos por categoria, gastos (com parcelas) e investimentos. Ideal para análise por IA.
            </p>

            <label className="mt-4 mb-1.5 block text-xs font-medium tracking-wide text-zinc-500 uppercase">Gastos do período</label>
            <div className="grid grid-cols-2 gap-2">
              {([['all', 'Todos os meses'], [month, monthLabel(month)]] as const).map(([val, label]) => (
                <button
                  key={val}
                  type="button"
                  onClick={() => setExportScope(val)}
                  className={`rounded-xl border px-3 py-2 text-xs font-semibold transition ${
                    exportScope === val
                      ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300'
                      : 'border-zinc-800 bg-zinc-900 text-zinc-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                disabled={exporting}
                onClick={() => runExport('csv')}
                className="rounded-xl bg-emerald-400 py-3 text-sm font-semibold text-black hover:bg-emerald-300 disabled:opacity-60"
              >
                {exporting ? 'Gerando…' : 'CSV'}
                <span className="block text-[10px] font-normal opacity-70">melhor p/ IA e planilhas</span>
              </button>
              <button
                disabled={exporting}
                onClick={() => runExport('pdf')}
                className="rounded-xl bg-zinc-800 py-3 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60"
              >
                {exporting ? 'Gerando…' : 'PDF'}
                <span className="block text-[10px] font-normal opacity-70">relatório para leitura</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setExportOpen(false)}
              className="mt-3 w-full rounded-xl bg-zinc-900 py-2.5 text-sm font-semibold text-zinc-300 hover:bg-zinc-800"
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      <MonthPicker />

      {/* Resumo e Filtros */}
      <Card className="space-y-3">
        <div className="flex items-center justify-between border-b border-zinc-900 pb-3">
          <div>
            <p className="text-xs text-zinc-500 uppercase tracking-wide">Total no extrato</p>
            <p className="text-2xl font-bold tracking-tight text-white">{formatBRL(totalFiltered)}</p>
          </div>
          <span className="text-xs text-zinc-400 bg-zinc-900 px-2.5 py-1 rounded-full border border-zinc-800">
            {filtered.length} {filtered.length === 1 ? 'registro' : 'registros'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
          {/* Busca por texto */}
          <div className="relative">
            <input
              type="text"
              placeholder="Buscar por descrição ou categoria..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 outline-none focus:border-emerald-500/60"
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
            className="w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-emerald-500/60"
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
        <Card className="text-center py-10 text-zinc-500">
          <p className="text-sm">Nenhum gasto encontrado para os filtros selecionados.</p>
          {(search || selectedCategory !== 'all') && (
            <button
              onClick={() => {
                setSearch('');
                setSelectedCategory('all');
              }}
              className="mt-3 text-xs text-emerald-400 hover:underline"
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
                  <div key={exp.id} className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/40 transition">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm text-zinc-100">{exp.title || exp.category_name}</p>
                        <span className="inline-block rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-zinc-800">
                          {exp.category_name}
                        </span>
                        {exp.payment_method && (
                          <span className="rounded bg-zinc-900 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400 border border-zinc-800 uppercase">
                            {exp.payment_method === 'credit'
                              ? exp.installment_total > 1
                                ? `Crédito ${exp.installment_current}/${exp.installment_total}`
                                : 'Crédito'
                              : exp.payment_method}
                          </span>
                        )}
                      </div>
                      {exp.description && (
                        <p className="truncate text-xs text-zinc-400 mt-0.5 font-normal">{exp.description}</p>
                      )}
                    </div>
                    <span className="font-semibold text-base tabular-nums text-white">
                      {formatBRL(exp.amount_cents)}
                    </span>
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
    </div>
  );
}

