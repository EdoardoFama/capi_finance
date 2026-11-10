import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { api, type Category, type Expense } from '../api';
import { useMonth, useToast } from '../context';
import { dayLabel, formatBRL, monthLabel } from '../format';
import { Card, IconPlus, IconTrash, MonthPicker, PageTitle, Spinner } from '../components/ui';

export default function History() {
  const { month } = useMonth();
  const toast = useToast();

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
        <Link
          to="/lancar"
          className="flex items-center gap-1.5 rounded-xl bg-emerald-400 px-3.5 py-2 text-sm font-semibold text-black transition hover:bg-emerald-300"
        >
          <IconPlus className="h-4 w-4" /> Novo
        </Link>
      </div>

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
                      <div className="flex items-center gap-2">
                        <span className="inline-block rounded-md bg-zinc-900 px-2 py-0.5 text-[11px] font-medium text-emerald-400 border border-zinc-800">
                          {exp.category_name}
                        </span>
                        {exp.description && (
                          <p className="truncate text-sm text-zinc-300 font-normal">{exp.description}</p>
                        )}
                      </div>
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
