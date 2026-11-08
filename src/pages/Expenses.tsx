import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, type Dashboard, type Expense } from '../api';
import { useMonth, useToast } from '../context';
import { dayLabel, formatBRL, parseBRL, percent, todayISO } from '../format';
import { Card, IconTrash, Input, MonthPicker, PageTitle, ProgressBar, Spinner, textColor } from '../components/ui';

export default function Expenses() {
  const { month, setMonth } = useMonth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const [dash, setDash] = useState<Dashboard | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);

  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(Number(params.get('categoria')) || null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayISO);
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
    if (params.has('categoria')) setParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = dash?.categories.find((c) => c.id === categoryId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (!cents) return toast('Informe um valor válido', 'error');
    if (!categoryId) return toast('Escolha uma categoria', 'error');
    setBusy(true);
    try {
      await api<Expense>('/expenses', {
        method: 'POST',
        body: { amount_cents: cents, category_id: categoryId, description, spent_on: date },
      });
      toast(`${formatBRL(cents)} lançado em ${selected?.name ?? 'categoria'}`);
      setAmount('');
      setDescription('');
      if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7));
      else await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove(exp: Expense) {
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
    return [...map.entries()];
  }, [expenses]);

  const selPct = selected ? percent(selected.spent_cents, selected.budget_cents) : 0;
  const preview = selected ? selected.spent_cents + (parseBRL(amount) ?? 0) : 0;

  return (
    <div className="space-y-4">
      <PageTitle title="Lançar gasto" />

      <Card>
        <form onSubmit={submit} className="space-y-4">
          {/* Valor */}
          <div>
            <label className="mb-1 block text-xs font-medium tracking-wide text-zinc-500 uppercase">Valor</label>
            <div className="flex items-center rounded-xl border border-zinc-800 bg-zinc-900 px-3 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20">
              <span className="text-xl text-zinc-500">R$</span>
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
                placeholder="0,00"
                className="w-full bg-transparent px-2 py-3 text-3xl font-bold tabular-nums outline-none placeholder:text-zinc-700"
              />
            </div>
          </div>

          {/* Categorias */}
          <div>
            <label className="mb-2 block text-xs font-medium tracking-wide text-zinc-500 uppercase">Categoria</label>
            {!dash ? (
              <p className="text-sm text-zinc-600">Carregando…</p>
            ) : dash.categories.length === 0 ? (
              <p className="text-sm text-zinc-500">Crie categorias na tela de Orçamento.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {dash.categories.map((c) => {
                  const pct = percent(c.spent_cents, c.budget_cents);
                  const active = c.id === categoryId;
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => setCategoryId(c.id)}
                      className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                        active
                          ? 'border-emerald-400 bg-emerald-400 text-black'
                          : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      {c.name}
                      {pct >= 100 && !active && <span className="ml-1 text-red-400">•</span>}
                    </button>
                  );
                })}
              </div>
            )}

            {selected && (
              <div className="mt-3 rounded-xl bg-zinc-900/60 p-3">
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">
                    {selected.name}: {formatBRL(selected.spent_cents)} de {formatBRL(selected.budget_cents)}
                  </span>
                  <span className={`font-bold ${textColor(selPct)}`}>{selPct}%</span>
                </div>
                <ProgressBar spent={selected.spent_cents} budget={selected.budget_cents} className="mt-2 h-1.5" />
                {parseBRL(amount) ? (
                  <p className={`mt-2 text-xs ${preview > selected.budget_cents ? 'text-red-400' : 'text-zinc-500'}`}>
                    Após este gasto: {formatBRL(preview)} ({percent(preview, selected.budget_cents)}%)
                    {preview > selected.budget_cents && ' — vai estourar o teto!'}
                  </p>
                ) : null}
              </div>
            )}
          </div>

          {/* Descrição e data */}
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <Input placeholder="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="sm:w-44" />
          </div>

          <button
            disabled={busy}
            className="w-full rounded-xl bg-emerald-400 py-3.5 font-semibold text-black transition hover:bg-emerald-300 active:scale-[0.99] disabled:opacity-60"
          >
            {busy ? 'Salvando…' : 'Adicionar gasto'}
          </button>
        </form>
      </Card>

      {/* Lista de lançamentos */}
      <div className="flex items-center justify-between pt-2">
        <h2 className="text-lg font-semibold">Lançamentos</h2>
        {dash && <span className="text-sm text-zinc-500">Total: {formatBRL(dash.total_spent_cents)}</span>}
      </div>
      <MonthPicker />

      {!expenses ? (
        <Spinner />
      ) : expenses.length === 0 ? (
        <Card className="text-center text-sm text-zinc-500">Nenhum gasto lançado neste mês.</Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(([day, items]) => (
            <div key={day}>
              <div className="mb-1.5 flex justify-between px-1 text-xs font-medium text-zinc-500">
                <span>{dayLabel(day)}</span>
                <span className="tabular-nums">{formatBRL(items.reduce((s, x) => s + x.amount_cents, 0))}</span>
              </div>
              <Card className="divide-y divide-zinc-900 !p-0">
                {items.map((exp) => (
                  <div key={exp.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{exp.category_name}</p>
                      {exp.description && <p className="truncate text-sm text-zinc-500">{exp.description}</p>}
                    </div>
                    <span className="font-semibold tabular-nums">{formatBRL(exp.amount_cents)}</span>
                    <button
                      onClick={() => remove(exp)}
                      className="rounded-lg p-1.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
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

