import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  api,
  type Dashboard,
  type Expense,
  type Inflow,
  type PaymentMethod,
  type AccountId,
  ACCOUNT_DEFINITIONS,
} from '../api';
import { useMonth, useToast } from '../context';
import { dayLabel, formatBRL, parseBRL, percent, todayISO } from '../format';
import {
  Card,
  IconEdit,
  IconPlus,
  IconTrash,
  Input,
  MonthPicker,
  PageTitle,
  ProgressBar,
  Spinner,
  textColor,
} from '../components/ui';
import EditExpenseModal from '../components/EditExpenseModal';

type EntryType = 'expense' | 'inflow';

const QUICK_INFLOW_SUGGESTIONS = [
  'Salário',
  'Adiantamento',
  'Vale Alimentação',
  'Vale Refeição',
  'Pix Recebido',
  'Rendimento',
  'Freelance / Bico',
  'Reembolso',
];

export default function Expenses() {
  const { month, setMonth } = useMonth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  // Tipo de Lançamento: Saída vs Entrada
  const [entryType, setEntryType] = useState<EntryType>('expense');

  const [dash, setDash] = useState<Dashboard | null>(null);
  const [expenses, setExpenses] = useState<Expense[] | null>(null);
  const [inflows, setInflows] = useState<Inflow[] | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  // Estados do Formulário de Saída
  const [amount, setAmount] = useState('');
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState<number | null>(Number(params.get('categoria')) || null);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(todayISO);
  const [accountId, setAccountId] = useState<string>(params.get('conta') || '');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('debit');
  const [installments, setInstallments] = useState(1);
  const [isInstallmentModalOpen, setIsInstallmentModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  // Estados do Formulário de Entrada
  const [inflowAmount, setInflowAmount] = useState('');
  const [inflowAccountId, setInflowAccountId] = useState<string>(params.get('conta') || '');
  const [inflowDescription, setInflowDescription] = useState('');
  const [inflowDate, setInflowDate] = useState(todayISO);
  const [inflowBusy, setInflowBusy] = useState(false);

  // Filtro da lista de lançamentos
  const [listFilter, setListFilter] = useState<'all' | 'expense' | 'inflow'>('all');

  const load = useCallback(async () => {
    const [d, e, inf] = await Promise.all([
      api<Dashboard>(`/dashboard?month=${month}`),
      api<Expense[]>(`/expenses?month=${month}`),
      api<Inflow[]>(`/inflows?month=${month}`),
    ]);
    setDash(d);
    setExpenses(e);
    setInflows(inf);
  }, [month]);

  useEffect(() => {
    setExpenses(null);
    setInflows(null);
    load().catch((e) => toast(e.message, 'error'));
  }, [load, toast]);

  useEffect(() => {
    if (params.has('categoria') || params.has('conta')) {
      setParams({}, { replace: true });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const accountsList = useMemo(() => {
    if (dash?.accounts && dash.accounts.length > 0) {
      return dash.accounts.map((a) => ({
        id: a.account_id,
        name: a.name,
        color: a.color || '#10b981',
        current_cents: a.current_cents,
      }));
    }
    return [];
  }, [dash?.accounts]);

  useEffect(() => {
    if (accountsList.length > 0) {
      if (!accountId || !accountsList.some((a) => a.id === accountId)) {
        setAccountId(accountsList[0].id);
      }
      if (!inflowAccountId || !accountsList.some((a) => a.id === inflowAccountId)) {
        setInflowAccountId(accountsList[0].id);
      }
    }
  }, [accountsList, accountId, inflowAccountId]);

  const selected = dash?.categories.find((c) => c.id === categoryId);

  function handleSelectPaymentMethod(method: PaymentMethod) {
    setPaymentMethod(method);
    if (method === 'credit') {
      setIsInstallmentModalOpen(true);
    } else {
      setInstallments(1);
    }
  }

  // Submissão de Saída
  async function submitExpense(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(amount);
    if (!cents) return toast('Informe um valor válido', 'error');
    if (!title.trim()) return toast('Informe o título do gasto', 'error');
    if (!categoryId) return toast('Escolha uma categoria', 'error');
    setBusy(true);
    try {
      await api<Expense>('/expenses', {
        method: 'POST',
        body: {
          amount_cents: cents,
          category_id: categoryId,
          title: title.trim(),
          description: description.trim(),
          spent_on: date,
          account_id: accountId,
          payment_method: paymentMethod,
          installments: accountId === 'nubank' && paymentMethod === 'credit' ? installments : 1,
        },
      });

      const accInfo = accountsList.find((a) => a.id === accountId);
      if (accountId === 'nubank' && paymentMethod === 'credit' && installments > 1) {
        toast(`${formatBRL(cents)} parcelado em ${installments}x de ${formatBRL(Math.round(cents / installments))}`);
      } else {
        toast(`${formatBRL(cents)} registrado como saída em ${accInfo?.name ?? 'Conta'}`);
      }

      setAmount('');
      setTitle('');
      setDescription('');
      if (accountId === 'nubank') {
        setPaymentMethod('debit');
      }
      setInstallments(1);

      if (date.slice(0, 7) !== month) setMonth(date.slice(0, 7));
      else await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // Submissão de Entrada
  async function submitInflow(e: FormEvent) {
    e.preventDefault();
    const cents = parseBRL(inflowAmount);
    if (!cents) return toast('Informe um valor válido para a entrada', 'error');
    if (!inflowDescription.trim()) return toast('Informe a descrição ou origem do recurso', 'error');
    setInflowBusy(true);
    try {
      await api<Inflow>('/inflows', {
        method: 'POST',
        body: {
          amount_cents: cents,
          account_id: inflowAccountId,
          description: inflowDescription.trim(),
          received_on: inflowDate,
        },
      });

      const accInfo = accountsList.find((a) => a.id === inflowAccountId);
      toast(`+ ${formatBRL(cents)} creditado no saldo de ${accInfo?.name ?? 'Conta'}!`);

      setInflowAmount('');
      setInflowDescription('');

      if (inflowDate.slice(0, 7) !== month) setMonth(inflowDate.slice(0, 7));
      else await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setInflowBusy(false);
    }
  }

  // Exclusão de Saída
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

    if (!confirm(`Excluir a saída de ${formatBRL(exp.amount_cents)} (${exp.title || exp.category_name})?`)) return;
    try {
      await api(`/expenses/${exp.id}`, { method: 'DELETE' });
      toast('Lançamento excluído');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  // Exclusão de Entrada
  async function removeInflow(inf: Inflow) {
    const accInfo = accountsList.find((a) => a.id === inf.account_id);
    if (
      !confirm(
        `Excluir a entrada de ${formatBRL(inf.amount_cents)} (${inf.description || 'Entrada'})?\n` +
          `O saldo da conta ${accInfo?.name ?? 'Conta'} será ajustado (descontando esse valor).`,
      )
    )
      return;
    try {
      await api(`/inflows/${inf.id}`, { method: 'DELETE' });
      toast('Entrada excluída e saldo ajustado');
      await load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  const fixedCategories = useMemo(
    () => (dash?.categories ?? []).filter((c) => c.is_fixed === 1),
    [dash],
  );
  const variableCategories = useMemo(
    () => (dash?.categories ?? []).filter((c) => c.is_fixed === 0),
    [dash],
  );

  const parsedAmount = parseBRL(amount) ?? 0;
  const currentInstallmentValue = parsedAmount
    ? paymentMethod === 'credit' && installments > 1
      ? Math.round(parsedAmount / installments)
      : parsedAmount
    : 0;

  // Itens unificados para o histórico da tela
  type TimelineItem =
    | { kind: 'expense'; data: Expense; date: string; id: string }
    | { kind: 'inflow'; data: Inflow; date: string; id: string };

  const timelineItems = useMemo(() => {
    const list: TimelineItem[] = [];
    if (listFilter === 'all' || listFilter === 'expense') {
      (expenses ?? []).forEach((e) =>
        list.push({ kind: 'expense', data: e, date: e.spent_on, id: `exp_${e.id}` }),
      );
    }
    if (listFilter === 'all' || listFilter === 'inflow') {
      (inflows ?? []).forEach((i) =>
        list.push({ kind: 'inflow', data: i, date: i.received_on, id: `inf_${i.id}` }),
      );
    }
    return list;
  }, [expenses, inflows, listFilter]);

  const groupedTimeline = useMemo(() => {
    const map = new Map<string, TimelineItem[]>();
    for (const item of timelineItems) {
      map.set(item.date, [...(map.get(item.date) ?? []), item]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [timelineItems]);

  const totalSpent = useMemo(
    () => (expenses ?? []).reduce((s, x) => s + x.amount_cents, 0),
    [expenses],
  );
  const totalReceived = useMemo(
    () => (inflows ?? []).reduce((s, x) => s + x.amount_cents, 0),
    [inflows],
  );

  return (
    <div className="space-y-5">
      <PageTitle
        title="Novo Lançamento"
        subtitle="Registre uma saída (gasto) ou dê entrada de valores nas suas carteiras"
      />

      {/* Seletor de Tipo: Saída (Gasto) vs Entrada */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/[0.08] bg-zinc-950 p-1.5 shadow-xl shadow-black/40">
        <button
          type="button"
          onClick={() => setEntryType('expense')}
          className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs sm:text-sm font-extrabold transition-all duration-200 ${
            entryType === 'expense'
              ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm shadow-rose-500/10'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500/20 text-rose-300 text-xs font-black">
            ↓
          </span>
          <span>Saída (Gasto)</span>
        </button>

        <button
          type="button"
          onClick={() => setEntryType('inflow')}
          className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-xs sm:text-sm font-extrabold transition-all duration-200 ${
            entryType === 'inflow'
              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm shadow-emerald-500/10'
              : 'text-zinc-400 hover:text-white'
          }`}
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-black">
            ↑
          </span>
          <span>Entrada (Receber)</span>
        </button>
      </div>

      {/* =========================================================
          FORMULÁRIO DE ENTRADA (RECEBIMENTO EM CARTEIRA)
          ========================================================= */}
      {entryType === 'inflow' && (
        <Card className="!p-5 sm:!p-6 border-emerald-500/30 bg-gradient-to-br from-zinc-950 via-zinc-950 to-emerald-950/20">
          <form onSubmit={submitInflow} className="space-y-5">
            {/* 1. Valor da Entrada */}
            <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-zinc-900/90 to-zinc-950 p-4 focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-500/20 transition">
              <label className="text-[11px] font-bold tracking-wider text-emerald-400 uppercase">
                Valor da Entrada (Recebimento)
              </label>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-emerald-400 select-none">R$</span>
                <input
                  value={inflowAmount}
                  onChange={(e) => setInflowAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="w-full bg-transparent py-1 text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums outline-none placeholder:text-zinc-700"
                  autoFocus
                />
              </div>
            </div>

            {/* 2. Carteira que vai receber o valor */}
            <div className="space-y-2.5">
              <label className="block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                Carteira de Destino (Receberá o saldo) <span className="text-emerald-400">*</span>
              </label>

              {accountsList.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-zinc-900/40 p-4 text-center">
                  <p className="text-xs text-zinc-400">Você ainda não tem contas cadastradas.</p>
                  <Link to="/" className="text-xs font-bold text-emerald-400 hover:underline mt-1 inline-block">
                    + Cadastrar Conta na Tela Inicial
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {accountsList.map((acc) => {
                    const active = inflowAccountId === acc.id;
                    return (
                      <button
                        type="button"
                        key={acc.id}
                        onClick={() => setInflowAccountId(acc.id)}
                        className={`flex flex-col items-start justify-between rounded-2xl border p-3 text-left transition-all ${
                          active
                            ? 'border-emerald-500/80 bg-emerald-500/15 ring-2 ring-emerald-500/30 shadow-lg scale-[1.02]'
                            : 'border-white/[0.07] bg-zinc-900/70 text-zinc-400 hover:border-white/15 hover:bg-zinc-900'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: acc.color }}
                          />
                          <span className="font-extrabold text-[11px] sm:text-xs text-zinc-100 truncate">
                            {acc.name}
                          </span>
                        </div>
                        <span className="mt-2 text-[11px] font-semibold tabular-nums text-zinc-400">
                          Saldo: {formatBRL(acc.current_cents)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 3. Descrição / Origem do Recurso com atalhos */}
            <div className="space-y-2.5">
              <label className="block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                Descrição da Entrada <span className="text-emerald-400">*</span>
              </label>
              <Input
                placeholder="Ex: Salário, Vale Alimentação, Pix recebido, Venda..."
                value={inflowDescription}
                onChange={(e) => setInflowDescription(e.target.value)}
                maxLength={120}
                required
              />

              {/* Sugestões rápidas de preenchimento */}
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-[10px] font-semibold uppercase text-zinc-500 mr-1">Atalhos:</span>
                {QUICK_INFLOW_SUGGESTIONS.map((sug) => (
                  <button
                    key={sug}
                    type="button"
                    onClick={() => setInflowDescription(sug)}
                    className="rounded-lg border border-white/[0.06] bg-zinc-900/80 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:border-emerald-500/40 hover:bg-emerald-500/15 hover:text-emerald-300 transition"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            </div>

            {/* 4. Data do Recebimento */}
            <div>
              <label className="mb-1 block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                Data do Recebimento
              </label>
              <Input
                type="date"
                value={inflowDate}
                onChange={(e) => setInflowDate(e.target.value)}
                required
                className="sm:w-52"
              />
            </div>

            {/* Botão de Envio de Entrada */}
            <button
              disabled={inflowBusy}
              className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 py-3.5 text-sm font-extrabold text-black shadow-lg shadow-emerald-500/20 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
            >
              {inflowBusy ? 'Creditando saldo…' : 'Confirmar e Lançar Entrada'}
            </button>
          </form>
        </Card>
      )}

      {/* =========================================================
          FORMULÁRIO DE SAÍDA (GASTO)
          ========================================================= */}
      {entryType === 'expense' && (
        <Card className="!p-5 sm:!p-6">
          <form onSubmit={submitExpense} className="space-y-5">
            {/* 1. VALOR EM DESTAQUE */}
            <div className="rounded-2xl border border-white/[0.08] bg-gradient-to-br from-zinc-900/90 to-zinc-950 p-4 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20 transition">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold tracking-wider text-zinc-400 uppercase">
                  Valor da Saída (Gasto)
                </label>
                {accountId === 'nubank' && paymentMethod === 'credit' && installments > 1 && (
                  <button
                    type="button"
                    onClick={() => setIsInstallmentModalOpen(true)}
                    className="rounded-full bg-purple-500/20 border border-purple-500/40 px-2.5 py-0.5 text-xs font-bold text-purple-300 hover:bg-purple-500/30 transition"
                  >
                    {installments}x {parsedAmount ? `de ${formatBRL(currentInstallmentValue)}` : ''} • alterar
                  </button>
                )}
              </div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-2xl font-bold text-emerald-400 select-none">R$</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="0,00"
                  className="w-full bg-transparent py-1 text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums outline-none placeholder:text-zinc-700"
                />
              </div>
            </div>

            {/* 2. CONTA E FORMA DE PAGAMENTO */}
            <div className="space-y-2.5">
              <label className="block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                Origem do Pagamento (Conta / Benefício)
              </label>

              {/* Mostradores/Botões de Conta Dinâmicos */}
              {accountsList.length === 0 ? (
                <div className="rounded-xl border border-dashed border-white/10 bg-zinc-900/40 p-4 text-center">
                  <p className="text-xs text-zinc-400">Você ainda não tem contas cadastradas.</p>
                  <Link to="/" className="text-xs font-bold text-emerald-400 hover:underline mt-1 inline-block">
                    + Cadastrar Conta na Tela Inicial
                  </Link>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {accountsList.map((acc) => {
                    const active = accountId === acc.id;
                    return (
                      <button
                        type="button"
                        key={acc.id}
                        onClick={() => {
                          setAccountId(acc.id);
                        }}
                        className={`flex flex-col items-start justify-between rounded-2xl border p-3 text-left transition-all ${
                          active
                            ? 'border-emerald-500/80 bg-emerald-500/15 ring-2 ring-emerald-500/30 shadow-lg'
                            : 'border-white/[0.07] bg-zinc-900/70 text-zinc-400 hover:border-white/15 hover:bg-zinc-900'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: acc.color }}
                          />
                          <span className="font-extrabold text-[11px] sm:text-xs text-zinc-100 truncate">
                            {acc.name}
                          </span>
                        </div>
                        <span className="mt-2 text-[11px] font-semibold tabular-nums text-zinc-400">
                          {formatBRL(acc.current_cents)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Formas de pagamento */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => handleSelectPaymentMethod('debit')}
                  className={`flex flex-col items-center justify-center rounded-xl border py-2.5 text-xs font-bold transition ${
                    paymentMethod === 'debit'
                      ? 'border-emerald-500 bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/50'
                      : 'border-white/[0.07] bg-zinc-900/50 text-zinc-400 hover:border-white/15'
                  }`}
                >
                  <span>Débito</span>
                  <span className="text-[10px] font-normal text-zinc-500">Abate na hora</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectPaymentMethod('pix')}
                  className={`flex flex-col items-center justify-center rounded-xl border py-2.5 text-xs font-bold transition ${
                    paymentMethod === 'pix'
                      ? 'border-teal-500 bg-teal-500/20 text-teal-200 ring-1 ring-teal-500/50'
                      : 'border-white/[0.07] bg-zinc-900/50 text-zinc-400 hover:border-white/15'
                  }`}
                >
                  <span>Pix</span>
                  <span className="text-[10px] font-normal text-zinc-500">Transferência</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSelectPaymentMethod('credit')}
                  className={`flex flex-col items-center justify-center rounded-xl border py-2.5 text-xs font-bold transition ${
                    paymentMethod === 'credit'
                      ? 'border-purple-400 bg-purple-500/20 text-purple-200 ring-1 ring-purple-400/50'
                      : 'border-white/[0.07] bg-zinc-900/50 text-zinc-400 hover:border-white/15'
                  }`}
                >
                  <span>Crédito</span>
                  <span className="text-[10px] font-normal text-zinc-400">
                    {installments > 1 ? `${installments}x parcelas` : 'Vai p/ fatura'}
                  </span>
                </button>
              </div>
            </div>

            {/* 3. SELEÇÃO DE CATEGORIA (AGRUPADA POR FIXAS E VARIÁVEIS) */}
            <div className="space-y-3">
              <label className="block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                Categoria da Saída <span className="text-emerald-400">*</span>
              </label>

              {!dash ? (
                <p className="text-sm text-zinc-500">Carregando categorias…</p>
              ) : dash.categories.length === 0 ? (
                <p className="text-sm text-zinc-500">Crie categorias na tela de Orçamento.</p>
              ) : (
                <div className="space-y-3 rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-3.5">
                  {/* Fixas */}
                  {fixedCategories.length > 0 && (
                    <div>
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
                        Fixas (Com Meta / Teto)
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {fixedCategories.map((c) => {
                          const pct = percent(c.spent_cents, c.budget_cents);
                          const active = c.id === categoryId;
                          return (
                            <button
                              type="button"
                              key={c.id}
                              onClick={() => setCategoryId(c.id)}
                              className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                                active
                                  ? 'border-emerald-400 bg-emerald-400 text-black shadow-md shadow-emerald-500/20 scale-[1.02]'
                                  : 'border-white/[0.07] bg-zinc-900 text-zinc-300 hover:border-white/20 hover:bg-zinc-800'
                              }`}
                            >
                              {c.name}
                              {pct >= 100 && !active && (
                                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-red-400" title="Teto atingido" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Variáveis */}
                  {variableCategories.length > 0 && (
                    <div className={fixedCategories.length > 0 ? 'border-t border-white/[0.06] pt-3' : ''}>
                      <p className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-purple-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                        Variáveis (Consomem do "Por Fora")
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {variableCategories.map((c) => {
                          const active = c.id === categoryId;
                          return (
                            <button
                              type="button"
                              key={c.id}
                              onClick={() => setCategoryId(c.id)}
                              className={`rounded-xl border px-3 py-1.5 text-xs font-bold transition-all ${
                                active
                                  ? 'border-purple-400 bg-purple-400 text-black shadow-md shadow-purple-500/20 scale-[1.02]'
                                  : 'border-purple-500/20 bg-purple-950/20 text-purple-200 hover:border-purple-500/40 hover:bg-purple-900/30'
                              }`}
                            >
                              {c.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Preview Inteligente do Impacto no Orçamento */}
              {selected && dash && (
                <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/75 p-3.5">
                  {selected.is_fixed === 1 ? (
                    (() => {
                      const selPct = percent(selected.spent_cents, selected.budget_cents);
                      const previewSpent = selected.spent_cents + currentInstallmentValue;
                      const previewPct = percent(previewSpent, selected.budget_cents);
                      const remainingAfter = selected.budget_cents - previewSpent;
                      return (
                        <>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-zinc-300">
                              {selected.name}: <span className="text-zinc-400">{formatBRL(selected.spent_cents)} de {formatBRL(selected.budget_cents)}</span>
                            </span>
                            <span className={`font-extrabold ${textColor(selPct)}`}>{selPct}%</span>
                          </div>
                          <ProgressBar spent={previewSpent} budget={selected.budget_cents} className="mt-2 h-2" />
                          {currentInstallmentValue > 0 && (
                            <p className={`mt-2 text-xs font-medium ${remainingAfter < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                              Após lançar +{formatBRL(currentInstallmentValue)}:{' '}
                              {remainingAfter >= 0
                                ? `Ainda restarão ${formatBRL(remainingAfter)} (${previewPct}% do teto)`
                                : `Excederá o teto em ${formatBRL(-remainingAfter)} (${previewPct}%)`}
                            </p>
                          )}
                        </>
                      );
                    })()
                  ) : (
                    (() => {
                      const porForaBudget = dash.por_fora_budget_cents;
                      const porForaSpent = dash.por_fora_spent_cents;
                      const previewPorForaSpent = porForaSpent + currentInstallmentValue;
                      const remainingPorForaAfter = porForaBudget - previewPorForaSpent;
                      return (
                        <>
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-semibold text-purple-200">
                              {selected.name} <span className="text-zinc-400 font-normal">(Variável • acumulado no mês: {formatBRL(selected.spent_cents)})</span>
                            </span>
                            <span className="font-bold text-purple-300">
                              Livre Por Fora: {formatBRL(dash.por_fora_remaining_cents)}
                            </span>
                          </div>
                          {currentInstallmentValue > 0 && (
                            <p className={`mt-2 text-xs font-medium ${remainingPorForaAfter < 0 ? 'text-red-400' : 'text-purple-300'}`}>
                              Após lançar +{formatBRL(currentInstallmentValue)}:{' '}
                              {remainingPorForaAfter >= 0
                                ? `Seu saldo livre "Por Fora" ficará em ${formatBRL(remainingPorForaAfter)}`
                                : `Seu saldo "Por Fora" ficará negativo em ${formatBRL(remainingPorForaAfter)}`}
                            </p>
                          )}
                        </>
                      );
                    })()
                  )}
                </div>
              )}
            </div>

            {/* 4. TÍTULO, DESCRIÇÃO E DATA */}
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                  Título / Estabelecimento <span className="text-emerald-400">*</span>
                </label>
                <Input
                  placeholder="Ex: Supermercado, Uber, iFood, Farmácia..."
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={120}
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                    Observação / Detalhe (opcional)
                  </label>
                  <Input
                    placeholder="Ex: Compra da semana, Jantar de sexta..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    maxLength={200}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold tracking-wider text-zinc-400 uppercase">
                    Data da Compra
                  </label>
                  <Input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                    className="sm:w-44"
                  />
                </div>
              </div>
            </div>

            <button
              disabled={busy}
              className="w-full rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 py-3.5 text-sm font-extrabold text-black shadow-lg shadow-emerald-500/20 transition hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
            >
              {busy
                ? 'Registrando saída…'
                : paymentMethod === 'credit' && installments > 1
                ? `Confirmar Saída em ${installments}x no Cartão`
                : 'Confirmar e Lançar Saída'}
            </button>
          </form>
        </Card>
      )}

      {/* Pop-up Modal de Parcelas do Cartão */}
      {isInstallmentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Parcelamento no Cartão</h3>
            <p className="mt-1 text-xs text-zinc-400">
              {parsedAmount
                ? `Valor total da compra: ${formatBRL(parsedAmount)}`
                : 'Selecione em quantas parcelas deseja dividir'}
            </p>

            <div className="mt-4 max-h-64 overflow-y-auto space-y-1.5 pr-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 18, 24].map((n) => {
                const perMonth = parsedAmount ? Math.round(parsedAmount / n) : 0;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => {
                      setInstallments(n);
                      setIsInstallmentModalOpen(false);
                    }}
                    className={`w-full flex items-center justify-between rounded-xl px-3.5 py-2.5 text-sm transition ${
                      installments === n
                        ? 'bg-emerald-400 text-black font-bold'
                        : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    <span>{n === 1 ? '1x à vista na fatura' : `${n}x sem juros`}</span>
                    {parsedAmount > 0 && (
                      <span
                        className={`text-xs tabular-nums ${
                          installments === n ? 'text-black font-semibold' : 'text-zinc-400'
                        }`}
                      >
                        {formatBRL(perMonth)} /mês
                      </span>
                    )}
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

      {/* =========================================================
          LISTA DE LANÇAMENTOS DO MÊS (SAÍDAS E ENTRADAS)
          ========================================================= */}
      <div className="pt-3 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Lançamentos do Mês</h2>
            <div className="flex items-center gap-3 text-xs text-zinc-400 mt-0.5">
              <span>
                Saídas: <strong className="text-zinc-200">{formatBRL(totalSpent)}</strong>
              </span>
              <span>•</span>
              <span>
                Entradas: <strong className="text-emerald-400">+{formatBRL(totalReceived)}</strong>
              </span>
            </div>
          </div>

          {/* Filtro Todos / Saídas / Entradas */}
          <div className="flex items-center rounded-xl border border-white/[0.08] bg-zinc-900 p-1 text-xs">
            <button
              type="button"
              onClick={() => setListFilter('all')}
              className={`rounded-lg px-2.5 py-1 font-bold transition ${
                listFilter === 'all' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Todos ({timelineItems.length})
            </button>
            <button
              type="button"
              onClick={() => setListFilter('expense')}
              className={`rounded-lg px-2.5 py-1 font-bold transition ${
                listFilter === 'expense' ? 'bg-rose-500/20 text-rose-300 shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Saídas ({expenses?.length ?? 0})
            </button>
            <button
              type="button"
              onClick={() => setListFilter('inflow')}
              className={`rounded-lg px-2.5 py-1 font-bold transition ${
                listFilter === 'inflow' ? 'bg-emerald-500/20 text-emerald-300 shadow-sm' : 'text-zinc-400 hover:text-white'
              }`}
            >
              Entradas ({inflows?.length ?? 0})
            </button>
          </div>
        </div>

        <MonthPicker />

        {!expenses || !inflows ? (
          <Spinner />
        ) : timelineItems.length === 0 ? (
          <Card className="text-center text-sm text-zinc-500 py-10">
            Nenhum lançamento encontrado para este filtro no mês selecionado.
          </Card>
        ) : (
          <div className="space-y-4">
            {groupedTimeline.map(([day, items]) => (
              <div key={day}>
                <div className="mb-1.5 flex justify-between px-1 text-xs font-semibold text-zinc-400">
                  <span className="capitalize">{dayLabel(day)}</span>
                  <span className="tabular-nums text-zinc-400">
                    {items.length} {items.length === 1 ? 'item' : 'itens'}
                  </span>
                </div>
                <Card className="divide-y divide-white/[0.06] !p-0 overflow-hidden">
                  {items.map((item) => {
                    if (item.kind === 'inflow') {
                      const inf = item.data;
                      const accInfo = accountsList.find((a) => a.id === inf.account_id);
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 px-4 py-3.5 hover:bg-zinc-900/50 transition bg-emerald-500/[0.02]"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="truncate font-bold text-sm text-zinc-100">
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
                            aria-label="Excluir entrada"
                            title="Excluir entrada"
                          >
                            <IconTrash className="h-4 w-4" />
                          </button>
                        </div>
                      );
                    }

                    // Saída
                    const exp = item.data;
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-3 px-4 py-3 hover:bg-zinc-900/50 transition"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="truncate font-bold text-sm text-zinc-100">
                              {exp.title || exp.category_name}
                            </p>
                            <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-white/[0.07]">
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
                        <span className="font-bold text-sm sm:text-base tabular-nums text-white">
                          {formatBRL(exp.amount_cents)}
                        </span>
                        <button
                          onClick={() => setEditingExpense(exp)}
                          className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition"
                          title="Editar saída"
                          aria-label="Editar"
                        >
                          <IconEdit className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => removeExpense(exp)}
                          className="rounded-lg p-1.5 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 transition"
                          aria-label="Excluir saída"
                          title="Excluir"
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
        )}
      </div>

      {/* Modal de Edição */}
      <EditExpenseModal
        expense={editingExpense}
        categories={dash?.categories ?? []}
        isOpen={Boolean(editingExpense)}
        onClose={() => setEditingExpense(null)}
        onSaved={load}
      />
    </div>
  );
}
