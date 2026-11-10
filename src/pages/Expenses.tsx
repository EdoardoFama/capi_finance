import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { api, type Dashboard, type Expense, type PaymentMethod } from '../api';
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
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('debit');
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
    if (params.has('categoria')) setParams({}, { replace: true });
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
    if (!categoryId) return toast('Escolha uma categoria', 'error');
    setBusy(true);
    try {
      await api<Expense>('/expenses', {
        method: 'POST',
        body: {
          amount_cents: cents,
          category_id: categoryId,
          description,
          spent_on: date,
          payment_method: paymentMethod,
          installments: paymentMethod === 'credit' ? installments : 1,
        },
      });

      if (paymentMethod === 'credit' && installments > 1) {
        toast(`${formatBRL(cents)} parcelado em ${installments}x de ${formatBRL(Math.round(cents / installments))}`);
      } else {
        toast(`${formatBRL(cents)} lançado em ${selected?.name ?? 'categoria'}`);
      }

      setAmount('');
      setDescription('');
      setPaymentMethod('debit');
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
    return [...map.entries()];
  }, [expenses]);

  const selPct = selected ? percent(selected.spent_cents, selected.budget_cents) : 0;
  const currentInstallmentValue = parseBRL(amount)
    ? paymentMethod === 'credit' && installments > 1
      ? Math.round(parseBRL(amount)! / installments)
      : parseBRL(amount)!
    : 0;
  const preview = selected ? selected.spent_cents + currentInstallmentValue : 0;

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

          {/* Forma de Pagamento */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="block text-xs font-medium tracking-wide text-zinc-500 uppercase">
                Forma de Pagamento
              </label>
              {paymentMethod === 'credit' && installments > 1 && (
                <button
                  type="button"
                  onClick={() => setIsInstallmentModalOpen(true)}
                  className="text-xs font-semibold text-emerald-400 hover:underline"
                >
                  {installments}x {parseBRL(amount) ? `de ${formatBRL(Math.round(parseBRL(amount)! / installments))}` : ''} (alterar)
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => handleSelectPaymentMethod('debit')}
                className={`flex flex-col items-center justify-center rounded-xl border py-2.5 text-xs font-semibold transition ${
                  paymentMethod === 'debit'
                    ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <span>Débito</span>
                <span className="text-[10px] font-normal text-zinc-500">À vista</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectPaymentMethod('pix')}
                className={`flex flex-col items-center justify-center rounded-xl border py-2.5 text-xs font-semibold transition ${
                  paymentMethod === 'pix'
                    ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <span>Pix</span>
                <span className="text-[10px] font-normal text-zinc-500">Instantâneo</span>
              </button>

              <button
                type="button"
                onClick={() => handleSelectPaymentMethod('credit')}
                className={`flex flex-col items-center justify-center rounded-xl border py-2.5 text-xs font-semibold transition ${
                  paymentMethod === 'credit'
                    ? 'border-emerald-400 bg-emerald-400/10 text-emerald-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:border-zinc-700'
                }`}
              >
                <span>Crédito</span>
                <span className="text-[10px] font-normal text-zinc-500">
                  {installments > 1 ? `${installments}x parcelas` : '1x ou parcelar'}
                </span>
              </button>
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
                    Neste mês ({formatBRL(currentInstallmentValue)}): após o gasto ficará em {formatBRL(preview)} ({percent(preview, selected.budget_cents)}%)
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
            {busy ? 'Salvando…' : paymentMethod === 'credit' && installments > 1 ? `Lançar em ${installments}x no Cartão` : 'Adicionar gasto'}
          </button>
        </form>
      </Card>

      {/* Pop-up Modal de Parcelas do Cartão */}
      {isInstallmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Número de Parcelas</h3>
            <p className="mt-1 text-xs text-zinc-400">
              {parseBRL(amount) ? `Valor total: ${formatBRL(parseBRL(amount)!)}` : 'Escolha a quantidade de vezes'}
            </p>

            <div className="mt-4 max-h-60 overflow-y-auto space-y-1.5 pr-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24].map((n) => {
                const total = parseBRL(amount);
                const perMonth = total ? Math.round(total / n) : 0;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setInstallments(n);
                      setIsInstallmentModalOpen(false);
                    }}
                    className={`w-full flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition ${
                      installments === n
                        ? 'bg-emerald-400 text-black font-semibold'
                        : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-850'
                    }`}
                  >
                    <span>{n === 1 ? '1x à vista' : `${n}x vezes`}</span>
                    {total ? (
                      <span className={`text-xs tabular-nums ${installments === n ? 'text-black' : 'text-zinc-400'}`}>
                        {formatBRL(perMonth)} /mês
                      </span>
                    ) : null}
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
                      <div className="flex items-center gap-2">
                        <p className="truncate font-medium">{exp.category_name}</p>
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
                      {exp.description && <p className="truncate text-sm text-zinc-500">{exp.description}</p>}
                    </div>
                    <span className="font-semibold tabular-nums">{formatBRL(exp.amount_cents)}</span>
                    <button
                      onClick={() => remove(exp)}
                      className="rounded-lg p-1.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-400"
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
    </div>
  );
}
