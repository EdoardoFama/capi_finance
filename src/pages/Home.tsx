import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import {
  api,
  createSavingsGoal,
  getCategoryIcon,
  getReminders,
  playSuccessSound,
  toggleCategoryCheck,
  updateReminder,
  updateSavingsGoal,
  type Dashboard,
  type AccountBalance,
  type Reminder,
  ACCOUNT_DEFINITIONS,
} from '../api';
import { notifyCeilingAlerts } from '../notifications';
import { useMonth, useToast, useConfirm } from '../context';
import { formatBRL, formatCurrencyInput, parseBRL, percent, currentMonth, todayISO } from '../format';
import {
  Card,
  CollapseButton,
  IconCalendar,
  IconCheck,
  IconCreditCard,
  IconEdit,
  IconList,
  IconPlus,
  IconSparkles,
  IconTrash,
  IconWallet,
  MonthPicker,
  ProgressBar,
  Spinner,
  textColor,
  useCollapsible,
} from '../components/ui';

function AccountCard({
  account,
  month,
  onUpdate,
  onEdit,
  onDelete,
}: {
  account: AccountBalance;
  month: string;
  onUpdate: (accountId: string, newInitialCents: number) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const info = {
    id: account.account_id,
    name: account.name,
    color: account.color || ACCOUNT_DEFINITIONS.find((a) => a.id === account.account_id)?.color || '#10b981',
  };

  const toast = useToast();
  const [val, setVal] = useState(
    account.initial_cents ? (account.initial_cents / 100).toFixed(2).replace('.', ',') : '',
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setVal(account.initial_cents ? (account.initial_cents / 100).toFixed(2).replace('.', ',') : '');
  }, [account.initial_cents]);

  async function handleSave() {
    const parsed = parseBRL(val);
    const newCents = parsed ?? 0;
    if (newCents === account.initial_cents) return;

    setIsSaving(true);
    try {
      await api('/accounts/balance', {
        method: 'PUT',
        body: { month, account_id: account.account_id, initial_cents: newCents },
      });
      onUpdate(account.account_id, newCents);
      toast(`Saldo de ${info.name} atualizado!`);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setIsSaving(false);
    }
  }

  const isNegative = account.current_cents < 0;
  const spentPct =
    account.initial_cents > 0
      ? Math.min(100, Math.round((account.spent_cents / account.initial_cents) * 100))
      : account.spent_cents > 0
      ? 100
      : 0;

  return (
    <div
      className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-950/90 p-4 shadow-lg transition-all duration-200 hover:border-white/20 hover:shadow-xl"
      style={{
        backgroundImage: `radial-gradient(circle at 100% 0%, ${info.color}18, transparent 65%)`,
      }}
    >
      <div>
        {/* Header da Conta */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-white/10"
              style={{ backgroundColor: info.color }}
            />
            <span className="truncate text-xs font-extrabold tracking-wider text-zinc-200 uppercase">
              {info.name}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 transition"
                title={`Editar conta ${info.name}`}
              >
                <IconEdit className="h-3 w-3" />
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-red-500/20 hover:text-red-400 transition"
                title={`Excluir conta ${info.name}`}
              >
                <IconTrash className="h-3 w-3" />
              </button>
            )}
            <Link
              to={`/lancar?conta=${account.account_id}`}
              title={`Lançar em ${info.name}`}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-white/[0.06] bg-zinc-900/80 text-zinc-400 transition hover:border-emerald-500/40 hover:bg-emerald-500/15 hover:text-emerald-300"
            >
              <IconPlus className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {/* Saldo Atual (Restante) */}
        <div className="mt-3.5">
          <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
            Saldo Disponível
          </p>
          <p
            className={`mt-0.5 text-2xl font-extrabold tracking-tight tabular-nums ${
              isNegative ? 'text-red-400' : 'text-white'
            }`}
          >
            {formatBRL(account.current_cents)}
          </p>
        </div>

        {/* Barra de progresso de consumo */}
        <div className="mt-3">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-900 ring-1 ring-inset ring-white/[0.05]">
            <div
              className={`h-full rounded-full transition-all duration-500 ${isNegative ? 'bg-red-500' : ''}`}
              style={{
                width: `${spentPct}%`,
                backgroundColor: isNegative ? undefined : info.color,
              }}
            />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium text-zinc-500">
            <span>{spentPct}% usado</span>
            <span className="tabular-nums">
              {account.spent_cents > 0 ? `-${formatBRL(account.spent_cents)}` : 'Sem gastos'}
            </span>
          </div>
        </div>
      </div>

      {/* Campo aberto para editar o Saldo em Conta */}
      <div className="mt-3.5 border-t border-white/[0.06] pt-2.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] font-medium text-zinc-400">Saldo base:</label>
          <div className="relative flex items-center rounded-lg border border-white/[0.08] bg-zinc-900/90 px-2 py-1 focus-within:border-emerald-400 focus-within:ring-1 focus-within:ring-emerald-400">
            <span className="text-[10px] font-semibold text-zinc-500 mr-1 select-none">R$</span>
            <input
              type="text"
              inputMode="decimal"
              placeholder="0,00"
              value={val}
              onChange={(e) => setVal(formatCurrencyInput(e.target.value))}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              disabled={isSaving}
              className="w-20 bg-transparent text-right text-xs font-bold text-zinc-100 tabular-nums outline-none disabled:opacity-50"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const { month } = useMonth();
  const toast = useToast();
  const confirm = useConfirm();
  const [data, setData] = useState<Dashboard | null>(null);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [error, setError] = useState('');
  const [fixedFilter, setFixedFilter] = useState<'all' | 'available' | 'done'>('all');

  const heroCollapse = useCollapsible('home_hero', true);
  const projectionCollapse = useCollapsible('home_projection', true);
  const accountsCollapse = useCollapsible('home_accounts', true);
  const ceilingAlertsCollapse = useCollapsible('home_ceiling_alerts', true);
  const remindersCollapse = useCollapsible('home_reminders', true);
  const fixedCatsCollapse = useCollapsible('home_fixed_cats', true);
  const variableCatsCollapse = useCollapsible('home_variable_cats', true);

  const loadDashboard = useCallback(() => {
    let alive = true;
    setError('');
    api<Dashboard>(`/dashboard?month=${month}`)
      .then((d) => {
        if (alive) {
          setData(d);
          notifyCeilingAlerts(d.categories, month);
        }
      })
      .catch((e) => alive && setError(e.message));

    getReminders(month)
      .then((r) => alive && setReminders(r))
      .catch(() => {});

    return () => {
      alive = false;
    };
  }, [month]);

  useEffect(() => {
    setData(null);
    return loadDashboard();
  }, [loadDashboard]);

  // Modais de Criação e Edição de Contas do Usuário
  const [isAddUserAccountOpen, setIsAddUserAccountOpen] = useState(false);
  const [newAccName, setNewAccName] = useState('');
  const [newAccColor, setNewAccColor] = useState('#10b981');
  const [newAccBalance, setNewAccBalance] = useState('');
  const [isCreatingAcc, setIsCreatingAcc] = useState(false);

  const [isEditUserAccountOpen, setIsEditUserAccountOpen] = useState(false);
  const [editingUserAccount, setEditingUserAccount] = useState<AccountBalance | null>(null);
  const [editAccName, setEditAccName] = useState('');
  const [editAccColor, setEditAccColor] = useState('#10b981');
  const [isSavingEditAcc, setIsSavingEditAcc] = useState(false);

  async function handleCreateUserAccount(e: FormEvent) {
    e.preventDefault();
    if (isCreatingAcc) return;
    const name = newAccName.trim().toUpperCase();
    if (!name) return toast('Informe o nome da conta', 'error');

    setIsCreatingAcc(true);
    try {
      const initCents = parseBRL(newAccBalance);
      await api<{ id: number; slug: string; name: string; color: string }>('/accounts', {
        method: 'POST',
        body: {
          name,
          color: newAccColor,
          initial_cents: initCents && initCents > 0 ? initCents : undefined,
          month,
        },
      });

      toast(`Conta ${name} adicionada com sucesso!`);
      setIsAddUserAccountOpen(false);
      setNewAccName('');
      setNewAccBalance('');
      loadDashboard();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setIsCreatingAcc(false);
    }
  }

  async function handleSaveEditUserAccount(e: FormEvent) {
    e.preventDefault();
    if (!editingUserAccount || isSavingEditAcc) return;
    const name = editAccName.trim().toUpperCase();
    if (!name) return toast('Informe o nome da conta', 'error');

    setIsSavingEditAcc(true);
    try {
      if (editingUserAccount.id) {
        await api(`/accounts/${editingUserAccount.id}`, {
          method: 'PUT',
          body: { name, color: editAccColor },
        });
      }
      toast(`Conta ${name} atualizada!`);
      setIsEditUserAccountOpen(false);
      setEditingUserAccount(null);
      loadDashboard();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setIsSavingEditAcc(false);
    }
  }

  async function handleDeleteUserAccount(acc: AccountBalance) {
    const ok = await confirm({
      title: 'Excluir Conta?',
      message: `Tem certeza que deseja excluir a conta "${acc.name}"?\n\nOs saldos definidos para ela serão removidos.`,
      confirmText: 'Excluir Conta',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      if (acc.id) {
        await api(`/accounts/${acc.id}`, { method: 'DELETE' });
      }
      toast(`Conta "${acc.name}" excluída.`);
      loadDashboard();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  function handleAccountInitialUpdate(accountId: string, newInitialCents: number) {
    setData((prev) => {
      if (!prev) return prev;
      const updatedAccounts = (prev.accounts ?? []).map((acc) => {
        if (acc.account_id === accountId) {
          return {
            ...acc,
            initial_cents: newInitialCents,
            spent_cents: 0,
            current_cents: newInitialCents,
          };
        }
        return acc;
      });
      return { ...prev, accounts: updatedAccounts };
    });
  }

  async function handleToggleCategoryCheck(categoryId: number, nextChecked: boolean) {
    setData((prev) => {
      if (!prev) return prev;
      const nextCats = prev.categories.map((c) =>
        c.id === categoryId ? { ...c, is_checked: nextChecked } : c
      );
      return { ...prev, categories: nextCats };
    });

    try {
      await toggleCategoryCheck(categoryId, month, nextChecked, undefined);
      if (nextChecked) playSuccessSound('check');
      toast(nextChecked ? 'Categoria quitada no mês! ✓' : 'Marcação de quitada removida.');
    } catch (err) {
      toast((err as Error).message || 'Erro ao atualizar status', 'error');
      loadDashboard();
    }
  }

  // Item 29: Travar / Desbloquear Categoria que estourou o teto
  async function handleToggleCategoryUnlock(categoryId: number, nextUnlocked: boolean) {
    setData((prev) => {
      if (!prev) return prev;
      const nextCats = prev.categories.map((c) =>
        c.id === categoryId ? { ...c, is_unlocked: nextUnlocked } : c
      );
      return { ...prev, categories: nextCats };
    });

    try {
      await toggleCategoryCheck(categoryId, month, undefined, nextUnlocked);
      playSuccessSound('unlock');
      toast(
        nextUnlocked
          ? '🔓 Cadeado desbloqueado! Categoria liberada para novos gastos.'
          : '🔒 Categoria travada novamente no teto.',
      );
    } catch (err) {
      toast((err as Error).message || 'Erro ao atualizar cadeado', 'error');
      loadDashboard();
    }
  }

  // Item 22: Rollover de Saldo Não Gasto ("Sobra vira Meta")
  async function handleRolloverSavings(categoryName: string, savedCents: number) {
    if (!data || savedCents <= 0) return;
    try {
      const goals = data.savings_goals ?? [];
      if (goals.length > 0) {
        const firstGoal = goals[0];
        await updateSavingsGoal(firstGoal.id, { add_cents: savedCents });
        playSuccessSound('coin');
        toast(`🎯 Economia de ${formatBRL(savedCents)} (${categoryName}) guardada no cofre "${firstGoal.name}"!`);
      } else {
        await createSavingsGoal({
          name: 'Cofre de Economias Mensais',
          icon: '🐷',
          target_cents: 500000,
          current_cents: savedCents,
        });
        playSuccessSound('coin');
        toast(`🐷 Cofre de Economias criado com +${formatBRL(savedCents)} da sobra de ${categoryName}!`);
      }
      loadDashboard();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  // Cálculos de Resumo Inteligente
  const metrics = useMemo(() => {
    if (!data) return null;
    const fixedCats = data.categories.filter((c) => c.is_fixed === 1);
    const variableCats = data.categories.filter((c) => c.is_fixed === 0);

    // Quanto ainda falta gastar nas categorias fixas que não estouraram e não estão quitadas
    const fixedRemaining = fixedCats.reduce(
      (acc, c) => acc + (c.is_checked ? 0 : Math.max(0, c.budget_cents - c.spent_cents)),
      0,
    );
    const porForaRemaining = data.por_fora_remaining_cents;
    // Potencial total ainda disponível no mês (Fixos pendentes + Por Fora restante)
    const totalAvailableToSpend = Math.max(0, fixedRemaining + porForaRemaining);

    // Soma dos saldos atuais das contas
    const totalAccountBalances = (data.accounts ?? []).reduce(
      (acc, a) => acc + Math.max(0, a.current_cents),
      0,
    );

    // Dias restantes no mês para cálculo de ritmo diário do "Por Fora"
    const now = new Date();
    const isCurrentMonth = month === currentMonth();
    const [y, m] = month.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const daysLeft = isCurrentMonth ? Math.max(1, daysInMonth - now.getDate() + 1) : daysInMonth;
    const dailyPorFora = porForaRemaining > 0 ? Math.floor(porForaRemaining / daysLeft) : 0;

    return {
      fixedCats,
      variableCats,
      fixedRemaining,
      porForaRemaining,
      totalAvailableToSpend,
      totalAccountBalances,
      daysLeft,
      dailyPorFora,
      isCurrentMonth,
    };
  }, [data, month]);

  const totalPct = data ? percent(data.total_spent_cents, data.total_income_cents || data.total_budget_cents) : 0;

  const displayedFixedCats = useMemo(() => {
    if (!metrics) return [];
    if (fixedFilter === 'available') {
      return metrics.fixedCats.filter((c) => !c.is_checked && c.spent_cents < c.budget_cents);
    }
    if (fixedFilter === 'done') {
      return metrics.fixedCats.filter((c) => c.is_checked || c.spent_cents >= c.budget_cents);
    }
    return metrics.fixedCats;
  }, [metrics, fixedFilter]);

  // Alertas de Teto Orçamentário (>= 80% ou estouradas)
  const ceilingAlerts = useMemo(() => {
    if (!data) return [];
    return data.categories
      .filter((c) => c.budget_cents > 0 && !c.is_checked)
      .map((c) => {
        const pct = Math.round((c.spent_cents / c.budget_cents) * 100);
        const diff = c.budget_cents - c.spent_cents;
        const isBreached = pct >= 100;
        const isWarning = pct >= 80 && pct < 100;
        return { ...c, pct, diff, isBreached, isWarning };
      })
      .filter((c) => c.isBreached || c.isWarning)
      .sort((a, b) => b.pct - a.pct);
  }, [data]);

  // Próximos lembretes pendentes
  const upcomingReminders = useMemo(() => {
    return reminders.filter((r) => !r.is_completed).slice(0, 3);
  }, [reminders]);

  return (
    <div className="space-y-6">
      {/* Seletor de Mês + Botão Refresh Rápido (Item 74) */}
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <MonthPicker />
        </div>
        <button
          type="button"
          onClick={() => {
            loadDashboard();
            toast('Dados atualizados! ↻');
          }}
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-zinc-950/90 text-zinc-300 shadow-lg hover:bg-zinc-900 hover:text-emerald-400 active:scale-95 transition"
          title="Atualizar dados agora"
        >
          ↻
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/30 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}
      {!data && !error && <Spinner />}

      {data && metrics && (
        <>
          {/* ================= ITENS 69, 70, 78, 93: MASCOTE CAPI REATIVO, SCORE DE SAÚDE (0-100) & INSIGHTS IA ================= */}
          {(() => {
            const breachedCount = ceilingAlerts.filter((a) => a.isBreached).length;
            const warningCount = ceilingAlerts.filter((a) => a.isWarning).length;
            const surplus = data.projection?.predicted_surplus_cents ?? 0;

            // Cálculo do Score Capi (0 a 100)
            let score = 85;
            if (totalPct <= 70) score += 10;
            else if (totalPct > 100) score -= 25;
            else if (totalPct > 85) score -= 10;
            score -= breachedCount * 8;
            score -= warningCount * 3;
            if (surplus > 0) score += 5;
            score = Math.max(15, Math.min(100, score));

            // Humor do Mascote Capi (Item 93)
            const mascot =
              score >= 85
                ? { emoji: '🦫✨', mood: 'Capi Investidora', color: 'text-emerald-300', msg: 'Suas finanças estão impecáveis! Ritmo excelente para multiplicar patrimônio.' }
                : score >= 65
                ? { emoji: '🦫😎', mood: 'Capi Tranquila', color: 'text-teal-300', msg: 'Orçamento sob controle! Continue acompanhando seus tetos semanais.' }
                : score >= 45
                ? { emoji: '🦫😅', mood: 'Capi Atenta', color: 'text-amber-300', msg: 'Atenção redobrada! Algumas categorias já passaram de 80% do teto.' }
                : { emoji: '🦫🚨', mood: 'Capi Preocupada', color: 'text-red-300', msg: 'Hora de segurar o freio! Revise os gastos variáveis para proteger seu fechamento.' };

            // Sugestão Inteligente de Economia (Item 70)
            const topCat = [...data.categories].sort((a, b) => b.spent_cents - a.spent_cents)[0];
            const aiTip = topCat && topCat.spent_cents > 0
              ? `Maior concentração do mês: ${topCat.name} (${formatBRL(topCat.spent_cents)}). ${
                  metrics.dailyPorFora > 0
                    ? `Seu limite seguro no "Por Fora" é de ${formatBRL(metrics.dailyPorFora)}/dia pelos próximos ${metrics.daysLeft} dias.`
                    : 'Evite novos gastos variáveis para preservar sua margem.'
                }`
              : 'Lance seus gastos ou ative o webhook Nubank para receber diagnósticos automáticos.';

            return (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
                {/* Mascote + Diagnóstico IA */}
                <div className="md:col-span-8 flex items-center gap-3.5 rounded-2xl border border-white/[0.08] bg-zinc-950/90 p-3.5 shadow-lg">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/10 text-2xl">
                    {mascot.emoji}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-black uppercase tracking-wider ${mascot.color}`}>
                        {mascot.mood}
                      </span>
                      <span className="text-[11px] text-zinc-400">• {mascot.msg}</span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-300 truncate" title={aiTip}>
                      💡 <strong className="text-emerald-300">IA Insight:</strong> {aiTip}
                    </p>
                  </div>
                </div>

                {/* Score Capi de Saúde Financeira (Item 69) */}
                <div className="md:col-span-4 flex items-center justify-between rounded-2xl border border-white/[0.08] bg-zinc-950/90 px-4 py-3 shadow-lg">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                      Score Saúde Capi
                    </span>
                    <span className="text-xs font-semibold text-zinc-300">
                      {score >= 80 ? 'Excelente' : score >= 60 ? 'Saudável' : 'Requer Atenção'}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span
                      className={`text-2xl font-black tabular-nums ${
                        score >= 80 ? 'text-emerald-400' : score >= 60 ? 'text-amber-300' : 'text-red-400'
                      }`}
                    >
                      {score}
                    </span>
                    <span className="text-xs text-zinc-500 font-bold">/100</span>
                  </div>
                </div>
              </div>
            );
          })()}
          {/* ================= HERO CARD: VISÃO EXECUTIVA DO MÊS ================= */}
          <div className="relative overflow-hidden rounded-3xl border border-white/[0.09] bg-gradient-to-br from-zinc-900/95 via-zinc-950 to-black p-5 sm:p-6 shadow-2xl">
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-emerald-500/10 blur-3xl" />
            <div className="pointer-events-none absolute -left-16 -bottom-16 h-56 w-56 rounded-full bg-purple-500/10 blur-3xl" />

            <div className="relative flex flex-col gap-5">
              {/* Topo do Hero */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <CollapseButton
                    isOpen={heroCollapse.isOpen}
                    onToggle={heroCollapse.toggle}
                    className="mt-1"
                  />
                  <div>
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold tracking-wide text-emerald-300 uppercase">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Balanço Mensal
                    </span>
                    <p className="mt-2 text-xs font-medium text-zinc-400 uppercase tracking-wider">
                      Gasto Total Acumulado
                    </p>
                    <div className="mt-0.5 flex items-baseline gap-3">
                      <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white tabular-nums">
                        {formatBRL(data.total_spent_cents)}
                      </h1>
                      <span className={`rounded-lg px-2 py-0.5 text-xs font-extrabold border ${
                        totalPct >= 100
                          ? 'bg-red-500/15 text-red-300 border-red-500/30'
                          : totalPct >= 80
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                          : 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      }`}>
                        {totalPct}% da renda
                      </span>
                    </div>
                  </div>
                </div>

                {/* Destaque: Quanto ainda pode gastar no mês */}
                <div className="rounded-2xl border border-white/[0.08] bg-zinc-900/70 px-4 py-3 sm:text-right backdrop-blur-md">
                  <p className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Disponível no Orçamento
                  </p>
                  <p className="mt-0.5 text-xl sm:text-2xl font-extrabold text-emerald-400 tabular-nums">
                    {formatBRL(metrics.totalAvailableToSpend)}
                  </p>
                  <p className="text-[11px] text-zinc-500 mt-0.5">
                    {formatBRL(metrics.fixedRemaining)} nos fixos + {formatBRL(Math.max(0, metrics.porForaRemaining))} por fora
                  </p>
                </div>
              </div>

              {heroCollapse.isOpen && (
                <>
                  {/* Barra de Progresso Geral */}
                  <div>
                    <ProgressBar
                      spent={data.total_spent_cents}
                      budget={data.total_income_cents || data.total_budget_cents}
                      className="h-3"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-400">
                      <span>
                        Fixos consumidos: <strong className="text-zinc-200">{formatBRL(data.fixed_spent_cents)}</strong> de {formatBRL(data.fixed_budget_cents)}
                      </span>
                      <span>
                        Variáveis (Por Fora): <strong className="text-purple-300">{formatBRL(data.variable_spent_cents)}</strong>
                      </span>
                    </div>
                  </div>

                  {/* 3 Pilares do Orçamento */}
                  <div className="grid grid-cols-3 gap-2.5 border-t border-white/[0.07] pt-4">
                    <div className="rounded-xl bg-zinc-900/50 border border-white/[0.05] p-3">
                      <p className="text-[10px] sm:text-xs font-medium text-zinc-400">Ganhos Previstos</p>
                      <p className="mt-1 text-sm sm:text-lg font-extrabold text-emerald-400 tabular-nums">
                        {formatBRL(data.total_income_cents)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-zinc-900/50 border border-white/[0.05] p-3">
                      <p className="text-[10px] sm:text-xs font-medium text-zinc-400">Teto Fixos</p>
                      <p className="mt-1 text-sm sm:text-lg font-extrabold text-blue-300 tabular-nums">
                        {formatBRL(data.fixed_budget_cents)}
                      </p>
                    </div>
                    <div className="rounded-xl bg-zinc-900/50 border border-white/[0.05] p-3">
                      <p className="text-[10px] sm:text-xs font-medium text-zinc-400">Livre "Por Fora"</p>
                      <p
                        className={`mt-1 text-sm sm:text-lg font-extrabold tabular-nums ${
                          data.por_fora_remaining_cents < 0 ? 'text-red-400' : 'text-purple-300'
                        }`}
                      >
                        {formatBRL(data.por_fora_remaining_cents)}
                      </p>
                    </div>
                  </div>
                </>
              )}

              {/* Ações Rápidas */}
              <div className="grid grid-cols-3 gap-2 pt-1">
                <Link
                  to="/lancar"
                  className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-400 py-2.5 px-3 text-xs font-bold text-black shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-300 active:scale-[0.99]"
                >
                  <IconPlus className="h-4 w-4 stroke-[2.5]" />
                  <span>Lançar Gasto</span>
                </Link>
                <Link
                  to="/cartao"
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-purple-500/30 bg-purple-500/10 py-2.5 px-3 text-xs font-semibold text-purple-200 transition hover:bg-purple-500/20"
                >
                  <IconCreditCard className="h-4 w-4 text-purple-300" />
                  <span>Ver Fatura</span>
                </Link>
                <Link
                  to="/extrato"
                  className="flex items-center justify-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-900/80 py-2.5 px-3 text-xs font-semibold text-zinc-200 transition hover:bg-zinc-800"
                >
                  <IconList className="h-4 w-4 text-zinc-400" />
                  <span>Extrato</span>
                </Link>
              </div>
            </div>
          </div>

          {/* ================= CARD DE PREVISÃO DE SALDO FINAL ================= */}
          {data.projection && (
            <div className={`relative overflow-hidden rounded-3xl border ${
              data.projection.predicted_surplus_cents >= 0
                ? 'border-emerald-500/30 bg-gradient-to-br from-[#071a12] via-zinc-950 to-[#09140f]'
                : 'border-red-500/35 bg-gradient-to-br from-[#1f0b0b] via-zinc-950 to-[#140808]'
            } p-5 sm:p-6 shadow-2xl`}>
              <div className={`pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full blur-3xl ${
                data.projection.predicted_surplus_cents >= 0 ? 'bg-emerald-500/15' : 'bg-red-500/15'
              }`} />

              <div
                className={`flex flex-wrap items-center justify-between gap-3 ${
                  projectionCollapse.isOpen ? 'border-b border-white/[0.06] pb-4' : ''
                } cursor-pointer select-none group`}
                onClick={projectionCollapse.toggle}
              >
                <div className="flex items-center gap-3">
                  <CollapseButton
                    isOpen={projectionCollapse.isOpen}
                    onToggle={projectionCollapse.toggle}
                  />
                  <div className={`flex h-10 w-10 items-center justify-center rounded-2xl border ${
                    data.projection.predicted_surplus_cents >= 0
                      ? 'border-emerald-500/30 bg-emerald-500/20 text-emerald-300'
                      : 'border-red-500/30 bg-red-500/20 text-red-300'
                  } shadow-inner`}>
                    <IconSparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-extrabold tracking-widest uppercase text-emerald-400">
                        Projeção Financeira
                      </span>
                      <span className={`rounded-md px-1.5 py-0.2 text-[10px] font-bold border ${
                        data.projection.predicted_surplus_cents >= 0
                          ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-300'
                          : 'border-red-500/30 bg-red-500/15 text-red-300'
                      }`}>
                        {data.projection.predicted_surplus_cents >= 0 ? 'Sobra Prevista' : 'Alerta: Déficit'}
                      </span>
                    </div>
                    <h2 className="text-base sm:text-lg font-extrabold text-white group-hover:text-emerald-300 transition">
                      Quanto vai sobrar no fim do mês?
                    </h2>
                  </div>
                </div>

                <div className="text-right">
                  <p className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Saldo Final Estimado
                  </p>
                  <p className={`text-xl sm:text-2xl font-black tabular-nums ${
                    data.projection.predicted_surplus_cents >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}>
                    {data.projection.predicted_surplus_cents >= 0 ? '+' : ''}
                    {formatBRL(data.projection.predicted_surplus_cents)}
                  </p>
                </div>
              </div>

              {projectionCollapse.isOpen && (
                <div className="mt-4 space-y-4">
                  {/* Grid de Raio-X dos 4 Pilares */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {/* 1. Saldo Bancário Atual */}
                    <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block">
                        (+) Saldo Nubank
                      </span>
                      <p className="text-base font-extrabold text-white tabular-nums mt-1">
                        {formatBRL(data.projection.bank_balance_cents)}
                      </p>
                      <span className="text-[10px] text-zinc-500 block mt-0.5">Disponível em conta</span>
                    </div>

                    {/* 2. Renda a Receber */}
                    <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400/90 block">
                        (+) A Receber
                      </span>
                      <p className="text-base font-extrabold text-emerald-400 tabular-nums mt-1">
                        +{formatBRL(data.projection.expected_remaining_income_cents)}
                      </p>
                      <span className="text-[10px] text-zinc-500 block mt-0.5">
                        {formatBRL(data.projection.inflows_total_cents)} já recebidos
                      </span>
                    </div>

                    {/* 3. Fatura Restante Cartão */}
                    <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-purple-400/90 block">
                        (-) Fatura Cartão
                      </span>
                      <p className="text-base font-extrabold text-purple-300 tabular-nums mt-1">
                        -{formatBRL(data.projection.invoice_remaining_cents)}
                      </p>
                      <span className="text-[10px] text-zinc-500 block mt-0.5">A liquidar na fatura</span>
                    </div>

                    {/* 4. Fixos Pendentes */}
                    <div className="rounded-2xl border border-white/[0.06] bg-zinc-900/40 p-3">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400/90 block">
                        (-) Fixos Pendentes
                      </span>
                      <p className="text-base font-extrabold text-amber-300 tabular-nums mt-1">
                        -{formatBRL(data.projection.fixed_remaining_cents)}
                      </p>
                      <span className="text-[10px] text-zinc-500 block mt-0.5">Boletos/metas a quitar</span>
                    </div>
                  </div>

                  {/* Fórmula Explicativa */}
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-zinc-900/30 border border-white/[0.04] px-3.5 py-2 text-[11px] text-zinc-400">
                    <span>
                      💡 <b className="text-zinc-200">Cálculo:</b> Saldo Atual + Renda Restante - Fatura a Pagar - Fixos Pendentes
                    </span>
                    <span className="text-zinc-500 font-medium">
                      Atualizado automaticamente conforme você lança gastos e entradas.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================= SALDO EM CONTA & BENEFÍCIOS ================= */}
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div
                className="flex items-center gap-2 cursor-pointer select-none group"
                onClick={accountsCollapse.toggle}
              >
                <CollapseButton
                  isOpen={accountsCollapse.isOpen}
                  onToggle={accountsCollapse.toggle}
                />
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <IconWallet className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-base font-bold tracking-tight text-white group-hover:text-emerald-300 transition">
                    Contas & Vale-Benefícios
                  </h2>
                  <p className="text-[11px] text-zinc-500">
                    Toque no saldo base para redefinir quando cair dinheiro novo
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddUserAccountOpen(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-white/[0.08] bg-zinc-900 px-3 py-1.5 text-xs font-bold text-zinc-200 hover:bg-zinc-800 transition active:scale-95"
                >
                  <IconPlus className="h-3.5 w-3.5 text-emerald-400" /> Nova Conta
                </button>
                <div className="rounded-xl border border-white/[0.07] bg-zinc-900/70 px-3 py-1.5 text-right">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500 block">
                    Soma disponível
                  </span>
                  <span className="text-xs font-extrabold text-emerald-400 tabular-nums">
                    {formatBRL(metrics.totalAccountBalances)}
                  </span>
                </div>
              </div>
            </div>

            {accountsCollapse.isOpen && (
              data.accounts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-zinc-950/60 p-6 text-center">
                  <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-400 mb-2">
                    <IconWallet className="h-5 w-5" />
                  </div>
                  <p className="text-sm font-bold text-zinc-200">Nenhuma conta cadastrada</p>
                  <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
                    Cadastre suas contas correntes (ex: Nubank, Inter) ou vales (ex: Alelo, Pluxe, VR) para acompanhar seus saldos disponíveis.
                  </p>
                  <button
                    type="button"
                    onClick={() => setIsAddUserAccountOpen(true)}
                    className="mt-3.5 inline-flex items-center gap-1.5 rounded-xl bg-emerald-400 px-4 py-2 text-xs font-extrabold text-black hover:bg-emerald-300 transition active:scale-95"
                  >
                    <IconPlus className="h-4 w-4" /> Cadastrar Conta
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {data.accounts.map((acc) => (
                    <AccountCard
                      key={acc.account_id}
                      account={acc}
                      month={month}
                      onUpdate={handleAccountInitialUpdate}
                      onEdit={() => {
                        setEditingUserAccount(acc);
                        setEditAccName(acc.name);
                        setEditAccColor(acc.color || '#10b981');
                        setIsEditUserAccountOpen(true);
                      }}
                      onDelete={() => handleDeleteUserAccount(acc)}
                    />
                  ))}
                </div>
              )
            )}
          </section>

          {/* ================= ALERTAS POR TETO ORÇAMENTÁRIO ================= */}
          {ceilingAlerts.length > 0 && (
            <section className="space-y-3 pt-1">
              <div
                className="flex items-center justify-between cursor-pointer select-none group"
                onClick={ceilingAlertsCollapse.toggle}
              >
                <div className="flex items-center gap-2">
                  <CollapseButton
                    isOpen={ceilingAlertsCollapse.isOpen}
                    onToggle={ceilingAlertsCollapse.toggle}
                  />
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30">
                    <span className="text-sm">⚠️</span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold tracking-tight text-white group-hover:text-amber-300 transition">
                        Alertas por Teto
                      </h2>
                      <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-extrabold text-amber-300 border border-amber-500/30">
                        {ceilingAlerts.length} {ceilingAlerts.length === 1 ? 'alerta' : 'alertas'}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Categorias que atingiram 80% ou estouraram o teto planejado no mês
                    </p>
                  </div>
                </div>

                <Link
                  to="/orcamento"
                  className="rounded-xl border border-white/[0.08] bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                >
                  Ajustar Tetos
                </Link>
              </div>

              {ceilingAlertsCollapse.isOpen && (
                <div className="grid gap-2.5 sm:grid-cols-2">
                  {ceilingAlerts.map((c) => (
                    <Link
                      key={c.id}
                      to={`/extrato?categoria=${c.id}`}
                      className="group block"
                      title={`Ver extrato de ${c.name}`}
                    >
                      <div
                        className={`rounded-2xl border p-3.5 transition-all hover:bg-zinc-900/60 active:scale-[0.99] ${
                          c.isBreached
                            ? 'border-red-500/40 bg-red-950/[0.15] hover:border-red-500/60 shadow-sm shadow-red-500/10'
                            : 'border-amber-500/40 bg-amber-950/[0.15] hover:border-amber-500/60 shadow-sm shadow-amber-500/10'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-bold text-sm text-zinc-100 group-hover:text-white truncate">
                              {c.name}
                            </p>
                            <p className="text-[11px] text-zinc-400 mt-0.5 tabular-nums">
                              {formatBRL(c.spent_cents)} de {formatBRL(c.budget_cents)}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <span
                              className={`inline-block rounded-lg px-2 py-0.5 text-xs font-extrabold tabular-nums border ${
                                c.isBreached
                                  ? 'bg-red-500/20 text-red-300 border-red-500/40'
                                  : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              }`}
                            >
                              {c.pct}%
                            </span>
                            <p
                              className={`text-[10px] font-semibold mt-1 tabular-nums ${
                                c.isBreached ? 'text-red-400' : 'text-amber-400'
                              }`}
                            >
                              {c.isBreached
                                ? `Estourou +${formatBRL(-c.diff)}`
                                : `Resta apenas ${formatBRL(c.diff)}`}
                            </p>
                          </div>
                        </div>

                        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                          <div
                            className={`h-full rounded-full ${
                              c.isBreached
                                ? 'bg-gradient-to-r from-red-500 to-rose-500'
                                : 'bg-gradient-to-r from-amber-400 to-orange-400'
                            }`}
                            style={{ width: `${Math.min(100, c.pct)}%` }}
                          />
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ================= LEMBRETES & CALENDÁRIO ================= */}
          <section className="space-y-3 pt-1">
            <div
              className="flex items-center justify-between cursor-pointer select-none group"
              onClick={remindersCollapse.toggle}
            >
              <div className="flex items-center gap-2">
                <CollapseButton
                  isOpen={remindersCollapse.isOpen}
                  onToggle={remindersCollapse.toggle}
                />
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/25">
                  <IconCalendar className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-bold tracking-tight text-white group-hover:text-emerald-300 transition">
                      Lembretes & Calendário
                    </h2>
                    {upcomingReminders.length > 0 && (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-extrabold text-emerald-300 border border-emerald-500/30">
                        {upcomingReminders.length} pendente(s)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Compromissos, vencimentos de contas e lembretes com notificação
                  </p>
                </div>
              </div>

              <Link
                to="/calendario"
                className="flex items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-3 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/25"
              >
                <span>Ver Calendário</span>
                <span>→</span>
              </Link>
            </div>

            {remindersCollapse.isOpen && (
              upcomingReminders.length === 0 ? (
                <div className="rounded-2xl border border-white/[0.06] bg-zinc-950/60 p-4 text-center">
                  <p className="text-xs text-zinc-400">
                    Nenhum lembrete pendente para este mês.{' '}
                    <Link to="/calendario" className="text-emerald-400 font-bold hover:underline">
                      Adicionar lembrete no calendário
                    </Link>
                    .
                  </p>
                </div>
              ) : (
                <div className="grid gap-2.5 sm:grid-cols-3">
                  {upcomingReminders.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-2xl border border-white/[0.08] bg-zinc-900/50 p-3.5 flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-1 text-[11px]">
                          <span className="font-bold text-emerald-400 tabular-nums">
                            {r.date.split('-')[2]}/{r.date.split('-')[1]}
                            {r.date === todayISO() ? ' (Hoje!)' : ''}
                          </span>
                          {r.time && <span className="text-zinc-500 font-medium">🕒 {r.time}</span>}
                        </div>
                        <p className="font-bold text-xs text-white mt-1 truncate">{r.title}</p>
                      </div>

                      <div className="mt-3 flex items-center justify-between pt-2 border-t border-white/[0.06]">
                        <span className="text-xs font-extrabold text-zinc-200 tabular-nums">
                          {r.amount_cents ? formatBRL(r.amount_cents) : '—'}
                        </span>
                        <Link
                          to="/calendario"
                          className="text-[10px] font-bold text-emerald-400 hover:underline"
                        >
                          Ver no dia →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}
          </section>

          {/* ================= CATEGORIAS FIXAS ================= */}
          <section className="space-y-3 pt-1">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div
                className="cursor-pointer select-none group"
                onClick={fixedCatsCollapse.toggle}
              >
                <div className="flex items-center gap-2">
                  <CollapseButton
                    isOpen={fixedCatsCollapse.isOpen}
                    onToggle={fixedCatsCollapse.toggle}
                  />
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-500 ring-4 ring-blue-500/15" />
                  <h2 className="text-base font-bold text-white group-hover:text-blue-300 transition">
                    Categorias Fixas
                  </h2>
                  <span className="rounded-full bg-blue-500/15 px-2.5 py-0.5 text-[10px] font-bold text-blue-300 border border-blue-500/25">
                    {formatBRL(data.fixed_spent_cents)} / {formatBRL(data.fixed_budget_cents)}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5 pl-9">
                  Despesas planejadas com meta ou teto mensal. Clique na categoria para ver o extrato filtrado.
                </p>
              </div>

              {fixedCatsCollapse.isOpen && (
                <div className="flex items-center gap-2">
                  {/* Filtro rápido de Fixas */}
                  <div className="flex rounded-xl border border-white/[0.07] bg-zinc-950 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setFixedFilter('all')}
                      className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                        fixedFilter === 'all' ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Todas ({metrics.fixedCats.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFixedFilter('available')}
                      className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                        fixedFilter === 'available' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Com saldo ({metrics.fixedCats.filter((c) => !c.is_checked && c.spent_cents < c.budget_cents).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setFixedFilter('done')}
                      className={`rounded-lg px-2.5 py-1 font-semibold transition ${
                        fixedFilter === 'done' ? 'bg-blue-500/20 text-blue-300' : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      Quitadas ({metrics.fixedCats.filter((c) => c.is_checked || c.spent_cents >= c.budget_cents).length})
                    </button>
                  </div>

                  <Link
                    to="/orcamento"
                    className="rounded-xl border border-white/[0.08] bg-zinc-900/70 px-3 py-1.5 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                  >
                    Configurar
                  </Link>
                </div>
              )}
            </div>

            {fixedCatsCollapse.isOpen && (
              displayedFixedCats.length === 0 ? (
                <Card className="text-center text-sm text-zinc-500 py-8">
                  Nenhuma categoria fixa encontrada neste filtro.
                </Card>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {displayedFixedCats.map((c) => {
                    const pct = percent(c.spent_cents, c.budget_cents);
                    const left = c.budget_cents - c.spent_cents;
                    const isOverBudget = c.budget_cents > 0 && c.spent_cents >= c.budget_cents;
                    const isLocked = isOverBudget && !c.is_unlocked;
                    return (
                      <Link key={c.id} to={`/extrato?categoria=${c.id}`} className="group block" title={`Ver extrato de ${c.name}`}>
                        <Card className={`h-full transition-all duration-200 hover:border-white/20 hover:bg-zinc-900/50 active:scale-[0.99] ${
                          c.is_checked
                            ? 'border-emerald-500/30 bg-emerald-950/[0.08]'
                            : isLocked
                            ? 'border-rose-500/40 bg-rose-950/[0.12]'
                            : ''
                        }`}>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {/* Item 28: Ícone da categoria */}
                                <span className="text-sm shrink-0">{getCategoryIcon(c.name, c.icon)}</span>
                                <p className="truncate font-bold text-zinc-100 group-hover:text-emerald-300 transition">
                                  {c.name}
                                </p>
                                {c.count > 0 && (
                                  <span className="shrink-0 rounded-full bg-zinc-900 border border-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium text-zinc-400">
                                    {c.count}x
                                  </span>
                                )}
                                {!isLocked && (
                                  <Link
                                    to={`/lancar?categoria=${c.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-emerald-400 transition"
                                    title={`Lançar gasto em ${c.name}`}
                                  >
                                    <IconPlus className="h-3.5 w-3.5" />
                                  </Link>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleToggleCategoryCheck(c.id, !c.is_checked);
                                  }}
                                  className={`shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition active:scale-95 ${
                                    c.is_checked
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30 shadow-sm shadow-emerald-500/20'
                                      : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 border border-white/[0.06]'
                                  }`}
                                  title={c.is_checked ? 'Quitada neste mês (clique para desmarcar)' : 'Marcar como quitada neste mês'}
                                >
                                  <IconCheck className={`h-3 w-3 ${c.is_checked ? 'text-emerald-400 stroke-[3]' : 'text-zinc-500'}`} />
                                  <span>{c.is_checked ? 'Quitada' : 'Quitar'}</span>
                                </button>

                                {/* Item 29: Cadeado Automático ao Estourar (Com Desbloqueio a Qualquer Momento) */}
                                {isOverBudget && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleToggleCategoryUnlock(c.id, !c.is_unlocked);
                                    }}
                                    className={`shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold transition active:scale-95 ${
                                      isLocked
                                        ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                                        : 'bg-amber-500/15 text-amber-300 border border-amber-500/30 hover:bg-amber-500/25'
                                    }`}
                                    title={
                                      isLocked
                                        ? 'Categoria travada por atingir o teto! Clique para desbloquear.'
                                        : 'Categoria desbloqueada manualmente. Clique para travar novamente.'
                                    }
                                  >
                                    <span>{isLocked ? '🔒 Travada' : '🔓 Destravada'}</span>
                                  </button>
                                )}
                              </div>
                              {c.note && (
                                <p className="truncate text-[11px] text-zinc-500 mt-0.5" title={c.note}>
                                  {c.note}
                                </p>
                              )}
                            </div>
                            <span
                              className={`shrink-0 rounded-lg px-2 py-0.5 text-xs font-extrabold tabular-nums ${textColor(
                                pct,
                              )} bg-zinc-900/90 border border-white/[0.05]`}
                            >
                              {pct}%
                            </span>
                          </div>

                          <ProgressBar spent={c.spent_cents} budget={c.budget_cents} className="mt-3 h-2" />

                          <div className="mt-2.5 flex items-center justify-between gap-2 text-xs flex-wrap">
                            <span className="text-zinc-300 font-semibold tabular-nums">
                              {formatBRL(c.spent_cents)}{' '}
                              <span className="text-zinc-500 font-normal">/ {formatBRL(c.budget_cents)}</span>
                            </span>
                            <div className="flex items-center gap-2">
                              {/* Item 22: Botão "Sobra vira Meta" quando quitada com economia */}
                              {c.is_checked && left > 0 && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    handleRolloverSavings(c.name, left);
                                  }}
                                  className="rounded-md border border-emerald-500/30 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 hover:bg-emerald-500/25 transition"
                                  title="Guardar essa economia no seu Cofre de Metas"
                                >
                                  🎯 Guardar Sobra
                                </button>
                              )}
                              <span
                                className={`font-semibold tabular-nums ${
                                  c.is_checked
                                    ? 'text-emerald-400'
                                    : left < 0
                                    ? 'text-red-400'
                                    : left === 0
                                    ? 'text-zinc-500'
                                    : 'text-emerald-400/90'
                                }`}
                              >
                                {c.is_checked
                                  ? left > 0
                                    ? `Quitada ✓ (Economia ${formatBRL(left)})`
                                    : 'Quitada ✓'
                                  : left < 0
                                  ? `Excedeu ${formatBRL(-left)}`
                                  : left === 0
                                  ? 'Meta atingida ✓'
                                  : `Resta ${formatBRL(left)}`}
                              </span>
                            </div>
                          </div>
                        </Card>
                      </Link>
                    );
                  })}
                </div>
              )
            )}
          </section>

          {/* ================= CATEGORIAS VARIÁVEIS (POR FORA) ================= */}
          <section className="space-y-3 pt-2">
            <div
              className="flex items-center justify-between cursor-pointer select-none group"
              onClick={variableCatsCollapse.toggle}
            >
              <div>
                <div className="flex items-center gap-2">
                  <CollapseButton
                    isOpen={variableCatsCollapse.isOpen}
                    onToggle={variableCatsCollapse.toggle}
                  />
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-purple-500 ring-4 ring-purple-500/15" />
                  <h2 className="text-base font-bold text-white group-hover:text-purple-300 transition">
                    Categorias Variáveis ("Por Fora")
                  </h2>
                  <span className="rounded-full bg-purple-500/15 px-2.5 py-0.5 text-[10px] font-bold text-purple-300 border border-purple-500/25">
                    Saldo Livre
                  </span>
                </div>
                <p className="text-xs text-zinc-500 mt-0.5 pl-9">
                  Despesas flexíveis que consomem o saldo livre. Clique para ver o extrato filtrado.
                </p>
              </div>
            </div>

            {variableCatsCollapse.isOpen && (
              <>
                {/* Card Resumo do 'Por Fora' */}
                <div className="relative overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-zinc-950 via-zinc-950 to-purple-950/30 p-5 shadow-xl">
                  <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-purple-600/10 blur-2xl" />

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-b border-white/[0.06] pb-4">
                    <div>
                      <p className="text-[11px] text-purple-300 uppercase font-bold tracking-wider">
                        Orçamento "Por Fora"
                      </p>
                      <p className="text-2xl font-extrabold tracking-tight text-white mt-0.5 tabular-nums">
                        {formatBRL(data.por_fora_budget_cents)}
                      </p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">Ganhos − Fixos previstos</p>
                    </div>

                    <div>
                      <p className="text-[11px] text-zinc-400 uppercase font-bold tracking-wider">
                        Já Consumido
                      </p>
                      <p className="text-2xl font-extrabold text-purple-300 mt-0.5 tabular-nums">
                        {formatBRL(data.por_fora_spent_cents)}
                      </p>
                      <p className="text-[11px] text-zinc-500 mt-0.5">
                        {data.por_fora_budget_cents > 0
                          ? `${percent(data.por_fora_spent_cents, data.por_fora_budget_cents)}% do saldo livre`
                          : 'Sem margem'}
                      </p>
                    </div>

                    <div className="sm:text-right">
                      <p className="text-[11px] text-zinc-400 uppercase font-bold tracking-wider">
                        Saldo Livre Restante
                      </p>
                      <p
                        className={`text-2xl font-extrabold mt-0.5 tabular-nums ${
                          data.por_fora_remaining_cents < 0 ? 'text-red-400' : 'text-emerald-400'
                        }`}
                      >
                        {formatBRL(data.por_fora_remaining_cents)}
                      </p>
                      {metrics.dailyPorFora > 0 && (
                        <p className="text-[11px] text-emerald-400/80 mt-0.5">
                          ~{formatBRL(metrics.dailyPorFora)}/dia ({metrics.daysLeft}d restantes)
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Barra de Progresso do Por Fora */}
                  <div className="mt-4">
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-900 ring-1 ring-inset ring-white/[0.06]">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          data.por_fora_remaining_cents < 0
                            ? 'bg-gradient-to-r from-red-500 to-rose-500'
                            : 'bg-gradient-to-r from-purple-500 to-indigo-400'
                        }`}
                        style={{
                          width: `${
                            data.por_fora_budget_cents > 0
                              ? Math.min(100, Math.round((data.por_fora_spent_cents / data.por_fora_budget_cents) * 100))
                              : 0
                          }%`,
                        }}
                      />
                    </div>
                  </div>
                </div>

                {/* Grid das Categorias Variáveis com o consumo de cada uma */}
                {metrics.variableCats.length === 0 ? (
                  <Card className="text-center text-sm text-zinc-500">
                    Nenhuma categoria variável cadastrada.{' '}
                    <Link to="/orcamento" className="text-purple-400 hover:underline">
                      Criar categoria variável
                    </Link>
                    .
                  </Card>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {metrics.variableCats.map((c) => {
                      const sharePct =
                        data.por_fora_budget_cents > 0
                          ? Math.round((c.spent_cents / data.por_fora_budget_cents) * 100)
                          : 0;
                      return (
                        <Link key={c.id} to={`/extrato?categoria=${c.id}`} className="group block" title={`Ver extrato de ${c.name}`}>
                          <Card className="h-full transition-all duration-200 hover:border-purple-500/40 hover:bg-zinc-900/50 active:scale-[0.99]">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-sm shrink-0">{getCategoryIcon(c.name, c.icon)}</span>
                                  <p className="truncate font-bold text-zinc-100 group-hover:text-purple-300 transition">
                                    {c.name}
                                  </p>
                                  <Link
                                    to={`/lancar?categoria=${c.id}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-purple-400 transition"
                                    title={`Lançar gasto em ${c.name}`}
                                  >
                                    <IconPlus className="h-3.5 w-3.5" />
                                  </Link>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      handleToggleCategoryCheck(c.id, !c.is_checked);
                                    }}
                                    className={`shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold transition active:scale-95 ${
                                      c.is_checked
                                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 hover:bg-purple-500/30 shadow-sm shadow-purple-500/20'
                                        : 'text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 border border-white/[0.06]'
                                    }`}
                                    title={c.is_checked ? 'Quitada neste mês (clique para desmarcar)' : 'Marcar como quitada neste mês'}
                                  >
                                    <IconCheck className={`h-3 w-3 ${c.is_checked ? 'text-purple-400 stroke-[3]' : 'text-zinc-500'}`} />
                                    <span>{c.is_checked ? 'Quitada' : 'Quitar'}</span>
                                  </button>
                                </div>
                                <p className="text-[11px] text-zinc-500">
                                  {c.count} {c.count === 1 ? 'lançamento' : 'lançamentos'}
                                </p>
                              </div>
                              <div className="text-right">
                                <p className="font-extrabold text-base text-purple-300 tabular-nums">
                                  {formatBRL(c.spent_cents)}
                                </p>
                                {data.por_fora_budget_cents > 0 && c.spent_cents > 0 && (
                                  <p className="text-[10px] font-semibold text-purple-400/80">
                                    {sharePct}% do Por Fora
                                  </p>
                                )}
                              </div>
                            </div>
                            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-zinc-900">
                              <div
                                className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-500 rounded-full transition-all duration-500"
                                style={{ width: `${Math.min(100, sharePct)}%` }}
                              />
                            </div>
                          </Card>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>

          {/* ================= ITENS 65 E 68: TOP 5 MAIORES GASTOS & HEATMAP DE CALOR ================= */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 pt-2">
            {/* Item 65: Top 5 Maiores Gastos do Mês */}
            <Card className="lg:col-span-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                    <span>🏆</span> Top 5 Maiores Gastos do Mês
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Os maiores desembolsos individuais registrados no período
                  </p>
                </div>
                <Link to="/extrato" className="text-xs font-bold text-emerald-400 hover:underline">
                  Ver todos →
                </Link>
              </div>

              {!data.top_expenses || data.top_expenses.length === 0 ? (
                <p className="py-6 text-center text-xs text-zinc-500">Nenhum gasto lançado neste mês.</p>
              ) : (
                <div className="space-y-2">
                  {data.top_expenses.map((exp, idx) => (
                    <Link
                      key={exp.id}
                      to={`/extrato?busca=${encodeURIComponent(exp.title || exp.category_name)}`}
                      className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.06] bg-zinc-900/50 p-2.5 hover:border-white/15 transition"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-zinc-800 text-[11px] font-black text-emerald-300">
                          #{idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate">
                            {exp.title || exp.category_name}
                          </p>
                          <p className="text-[10px] text-zinc-500 truncate">
                            {getCategoryIcon(exp.category_name)} {exp.category_name} • {exp.spent_on.split('-')[2]}/{exp.spent_on.split('-')[1]}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-extrabold text-rose-300 tabular-nums shrink-0">
                        {formatBRL(exp.amount_cents)}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </Card>

            {/* Item 68: Heatmap (Mapa de Calor) de Gastos Diários */}
            <Card className="lg:col-span-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-extrabold text-white flex items-center gap-2">
                    <span>🔥</span> Mapa de Calor de Gastos (Heatmap)
                  </h3>
                  <p className="text-[11px] text-zinc-400">
                    Intensidade diária de gastos ao longo dos dias do mês
                  </p>
                </div>
                <Link to="/calendario" className="text-xs font-bold text-emerald-400 hover:underline">
                  Calendário →
                </Link>
              </div>

              {(() => {
                const [y, m] = month.split('-').map(Number);
                const daysCount = new Date(y, m, 0).getDate();
                const map = new Map<string, { total: number; count: number }>();
                (data.daily_heatmap ?? []).forEach((h) =>
                  map.set(h.date, { total: h.total_cents, count: h.count }),
                );
                const maxDayTotal = Math.max(
                  ...(data.daily_heatmap ?? []).map((h) => h.total_cents),
                  1,
                );

                return (
                  <div className="space-y-3 pt-1">
                    <div className="grid grid-cols-7 gap-1.5">
                      {Array.from({ length: daysCount }).map((_, idx) => {
                        const d = idx + 1;
                        const dateStr = `${month}-${String(d).padStart(2, '0')}`;
                        const info = map.get(dateStr);
                        const total = info?.total ?? 0;
                        const ratio = total > 0 ? total / maxDayTotal : 0;

                        const cellColor =
                          total === 0
                            ? 'bg-zinc-900/70 border-white/[0.04] text-zinc-600'
                            : ratio > 0.75
                            ? 'bg-rose-500/80 border-rose-400 text-white font-extrabold shadow-sm shadow-rose-500/30'
                            : ratio > 0.4
                            ? 'bg-amber-500/60 border-amber-400/60 text-white font-bold'
                            : 'bg-emerald-500/35 border-emerald-500/40 text-emerald-200 font-semibold';

                        return (
                          <Link
                            key={dateStr}
                            to="/calendario"
                            title={`Dia ${d}: ${total > 0 ? `${formatBRL(total)} (${info?.count} gastos)` : 'Zero gastos!'}`}
                            className={`flex flex-col items-center justify-center rounded-lg border py-1.5 text-[10px] tabular-nums transition hover:scale-105 ${cellColor}`}
                          >
                            <span>{d}</span>
                          </Link>
                        );
                      })}
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-zinc-500 pt-1 border-t border-white/[0.05]">
                      <span>Dias sem gastos ficam neutros</span>
                      <div className="flex items-center gap-1.5">
                        <span>Menor</span>
                        <span className="h-2.5 w-2.5 rounded bg-zinc-900 border border-white/10" />
                        <span className="h-2.5 w-2.5 rounded bg-emerald-500/40" />
                        <span className="h-2.5 w-2.5 rounded bg-amber-500/60" />
                        <span className="h-2.5 w-2.5 rounded bg-rose-500/80" />
                        <span>Maior</span>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </Card>
          </div>
        </>
      )}

      {/* Modal: Adicionar Nova Conta do Usuário */}
      {isAddUserAccountOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Nova Conta / Benefício</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Ex: Nubank, Inter, Alelo, VR, Flash...</p>

            <form onSubmit={handleCreateUserAccount} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Nome da Conta / Cartão
                </label>
                <input
                  value={newAccName}
                  onChange={(e) => setNewAccName(e.target.value)}
                  placeholder="EX: NUBANK, ALELO..."
                  className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2.5 text-sm text-white font-bold outline-none uppercase focus:border-emerald-500/60"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Saldo Inicial do Mês (Opcional)
                </label>
                <input
                  placeholder="0,00"
                  inputMode="decimal"
                  value={newAccBalance}
                  onChange={(e) => setNewAccBalance(formatCurrencyInput(e.target.value))}
                  className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2.5 text-sm text-white font-bold tabular-nums outline-none focus:border-emerald-500/60"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Cor de Identificação
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={newAccColor}
                    onChange={(e) => setNewAccColor(e.target.value)}
                    className="h-10 w-14 rounded-xl border border-white/[0.08] bg-zinc-900 cursor-pointer p-1"
                  />
                  <span className="text-xs font-mono font-bold text-zinc-300">{newAccColor}</span>
                </div>
              </div>

              <div className="flex items-center gap-2.5 pt-3">
                <button
                  type="button"
                  onClick={() => setIsAddUserAccountOpen(false)}
                  className="flex-1 rounded-xl border border-white/[0.08] bg-zinc-900 py-2.5 text-xs font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  disabled={isCreatingAcc}
                  className="flex-1 rounded-xl bg-emerald-400 py-2.5 text-xs font-extrabold text-black hover:bg-emerald-300 transition disabled:opacity-50"
                >
                  {isCreatingAcc ? 'Criando…' : 'Criar Conta'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Editar Conta do Usuário */}
      {isEditUserAccountOpen && editingUserAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm rounded-2xl border border-white/[0.1] bg-zinc-950 p-5 shadow-2xl">
            <h3 className="text-lg font-bold text-white">Editar Conta / Benefício</h3>
            <p className="text-xs text-zinc-400 mt-0.5">Altere o nome, cor ou exclua esta conta.</p>

            <form onSubmit={handleSaveEditUserAccount} className="mt-4 space-y-3.5">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Nome da Conta
                </label>
                <input
                  value={editAccName}
                  onChange={(e) => setEditAccName(e.target.value)}
                  className="w-full rounded-xl border border-white/[0.08] bg-zinc-900 px-3.5 py-2.5 text-sm text-white font-bold outline-none uppercase focus:border-emerald-500/60"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Cor de Identificação
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="color"
                    value={editAccColor}
                    onChange={(e) => setEditAccColor(e.target.value)}
                    className="h-10 w-14 rounded-xl border border-white/[0.08] bg-zinc-900 cursor-pointer p-1"
                  />
                  <span className="text-xs font-mono font-bold text-zinc-300">{editAccColor}</span>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => handleDeleteUserAccount(editingUserAccount)}
                  className="flex items-center justify-center gap-1 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-bold text-red-300 hover:bg-red-500/20 transition"
                  title="Excluir conta"
                >
                  <IconTrash className="h-4 w-4" /> Excluir
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditUserAccountOpen(false)}
                  className="flex-1 rounded-xl border border-white/[0.08] bg-zinc-900 py-2 text-xs font-bold text-zinc-400 hover:bg-zinc-800 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  disabled={isSavingEditAcc}
                  className="flex-1 rounded-xl bg-emerald-400 py-2 text-xs font-extrabold text-black hover:bg-emerald-300 transition disabled:opacity-50"
                >
                  {isSavingEditAcc ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Botão flutuante (desktop) */}
      <Link
        to="/lancar"
        className="fixed right-6 bottom-6 z-20 hidden items-center gap-2 rounded-full bg-gradient-to-r from-emerald-400 to-teal-400 px-5 py-3.5 text-sm font-bold text-black shadow-xl shadow-emerald-500/25 transition hover:scale-105 hover:brightness-110 active:scale-95 md:flex"
      >
        <IconPlus className="h-5 w-5 stroke-[2.5]" /> Lançar gasto
      </Link>
    </div>
  );
}
