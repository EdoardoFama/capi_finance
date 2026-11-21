import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  api,
  createReminder,
  deleteReminder,
  getReminders,
  playSuccessSound,
  updateReminder,
  type Category,
  type Expense,
  type Reminder,
} from '../api';
import { useMonth, useToast, useConfirm, useViewMode } from '../context';
import { formatBRL, formatCurrencyInput, parseBRL, monthLabel, shiftMonth, currentMonth, todayISO } from '../format';
import {
  Card,
  IconCalendar,
  IconCheck,
  IconChevron,
  IconPlus,
  IconTrash,
  Spinner,
} from '../components/ui';
import {
  buildGoogleCalendarUrl,
  isNotificationSupported,
  requestNotificationPermission,
  scheduleRemindersNotifications,
  sendLocalNotification,
} from '../notifications';

type CalendarDay =
  | { blank: true; key: string }
  | {
      blank: false;
      key: string;
      dayNumber: number;
      dateStr: string;
      isToday: boolean;
      isSelected: boolean;
      expensesTotal: number;
      expensesCount: number;
      reminders: Reminder[];
    };

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function getNext12Months(baseMonth: string): string[] {
  const [y, m] = baseMonth.split('-').map(Number);
  const list: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(y, m - 1 + i, 1);
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    list.push(`${yr}-${mo}`);
  }
  return list;
}

function getExpenseHeat(amount: number, maxAmount: number) {
  if (amount <= 0 || maxAmount <= 0) {
    return { level: 0, dotClass: '', textColor: 'text-red-400/90', label: '' };
  }
  const ratio = amount / maxAmount;
  if (ratio <= 0.25) {
    return {
      level: 1,
      dotClass: 'h-1.5 w-1.5 bg-emerald-400',
      textColor: 'text-emerald-400',
      label: 'Menos gasto',
    };
  }
  if (ratio <= 0.50) {
    return {
      level: 2,
      dotClass: 'h-1.5 w-1.5 bg-amber-400',
      textColor: 'text-amber-400',
      label: 'Gasto moderado',
    };
  }
  if (ratio <= 0.75) {
    return {
      level: 3,
      dotClass: 'h-2 w-2 bg-orange-500',
      textColor: 'text-orange-400',
      label: 'Gasto elevado',
    };
  }
  return {
    level: 4,
    dotClass: 'h-2.5 w-2.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.9)] ring-1 ring-red-400',
    textColor: 'text-rose-400 font-extrabold',
    label: 'Pico de gasto',
  };
}

export default function CalendarPage() {
  const { month, setMonth } = useMonth();
  const { isSimple } = useViewMode();
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);

  // Dia atualmente selecionado (YYYY-MM-DD). Inicia no hoje se estiver no mês atual, ou no dia 01
  const today = todayISO();
  const isCurrentMonth = month === currentMonth();
  const [selectedDate, setSelectedDate] = useState<string>(() =>
    isCurrentMonth ? today : `${month}-01`,
  );

  // Estado para adicionar / editar lembrete
  const [isAddingReminder, setIsAddingReminder] = useState(false);
  const [editingReminder, setEditingReminder] = useState<Reminder | null>(null);
  const [remTitle, setRemTitle] = useState('');
  const [remTime, setRemTime] = useState('');
  const [remAmount, setRemAmount] = useState('');
  const [remCategoryId, setRemCategoryId] = useState<string>('');
  const [remNotify, setRemNotify] = useState(true);
  const [remRecurrence, setRemRecurrence] = useState<'none' | 'monthly'>('none');
  const [remMonths, setRemMonths] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Status de permissão de notificação
  const [hasNotifPermission, setHasNotifPermission] = useState<boolean>(() => {
    return isNotificationSupported() && Notification.permission === 'granted';
  });

  // Item 35: Alternador entre Grade Mensal e Modo Lista / Agenda
  const [viewMode, setViewMode] = useState<'grid' | 'agenda'>('grid');

  // Atualiza data selecionada quando o mês muda
  useEffect(() => {
    if (!selectedDate.startsWith(month)) {
      setSelectedDate(isCurrentMonth ? today : `${month}-01`);
    }
  }, [month, isCurrentMonth, today, selectedDate]);

  // Carrega lembretes, gastos e categorias do mês
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [rems, exps, cats] = await Promise.all([
        getReminders(month),
        api<Expense[]>(`/expenses?month=${month}`),
        api<Category[]>('/categories'),
      ]);
      setReminders(rems);
      setExpenses(exps);
      setCategories(cats);
      scheduleRemindersNotifications(rems);
    } catch (err) {
      toast((err as Error).message || 'Erro ao carregar dados do calendário', 'error');
    } finally {
      setLoading(false);
    }
  }, [month, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Solicita permissão de notificação
  async function handleEnableNotifications() {
    const granted = await requestNotificationPermission();
    setHasNotifPermission(granted);
    if (granted) {
      toast('Notificações ativadas com sucesso! 🔔');
      sendLocalNotification('Capi Finance', {
        body: 'Notificações de lembretes configuradas com sucesso!',
      });
      scheduleRemindersNotifications(reminders);
    } else {
      toast('Permissão de notificações não concedida no navegador.', 'error');
    }
  }

  // Abre form para novo lembrete
  function handleOpenNewReminder(dateStr?: string) {
    const targetDate = dateStr || selectedDate;
    if (dateStr) setSelectedDate(dateStr);
    setEditingReminder(null);
    setRemTitle('');
    setRemTime('09:00');
    setRemAmount('');
    setRemCategoryId('');
    setRemNotify(true);
    setRemRecurrence('none');
    setRemMonths(getNext12Months(targetDate.slice(0, 7)));
    setIsAddingReminder(true);
  }

  // Abre form para editar lembrete
  function handleOpenEditReminder(r: Reminder) {
    setEditingReminder(r);
    setRemTitle(r.title);
    setRemTime(r.time || '');
    setRemAmount(r.amount_cents ? (r.amount_cents / 100).toFixed(2).replace('.', ',') : '');
    setRemCategoryId(r.category_id ? String(r.category_id) : '');
    setRemNotify(r.notify === 1);
    setRemRecurrence(r.recurrence || 'none');
    setRemMonths([r.date.slice(0, 7)]);
    setIsAddingReminder(true);
  }

  // Salva lembrete (criar ou atualizar)
  async function handleSaveReminder(e: FormEvent) {
    e.preventDefault();
    const title = remTitle.trim();
    if (!title) return toast('Informe um título para o lembrete', 'error');

    setIsSaving(true);
    try {
      const amountCents = remAmount.trim() ? parseBRL(remAmount) : null;
      const catId = remCategoryId ? Number(remCategoryId) : null;

      if (editingReminder) {
        await updateReminder(editingReminder.id, {
          title,
          date: selectedDate,
          time: remTime.trim() || null,
          amount_cents: amountCents,
          category_id: catId,
          notify: remNotify ? 1 : 0,
          recurrence: remRecurrence,
        });
        toast('Lembrete atualizado!');
      } else {
        await createReminder({
          title,
          date: selectedDate,
          time: remTime.trim() || null,
          amount_cents: amountCents,
          category_id: catId,
          notify: remNotify ? 1 : 0,
          recurrence: remRecurrence,
          months: remRecurrence === 'monthly' ? remMonths : undefined,
        });
        toast(
          remRecurrence === 'monthly' && remMonths.length > 1
            ? `Lembrete criado e replicado para ${remMonths.length} meses! ⏰`
            : 'Lembrete agendado com sucesso! ⏰'
        );
      }

      setIsAddingReminder(false);
      setEditingReminder(null);
      await loadData();
    } catch (err) {
      toast((err as Error).message || 'Erro ao salvar lembrete', 'error');
    } finally {
      setIsSaving(false);
    }
  }

  // Alterna status de concluído do lembrete
  async function handleToggleCompleted(r: Reminder) {
    const nextStatus = r.is_completed ? 0 : 1;
    // Otimista
    setReminders((prev) =>
      prev.map((item) => (item.id === r.id ? { ...item, is_completed: nextStatus } : item)),
    );

    try {
      await updateReminder(r.id, { is_completed: nextStatus });
      toast(nextStatus ? 'Lembrete marcado como quitado! ✓' : 'Lembrete reaberto.');
    } catch (err) {
      toast((err as Error).message, 'error');
      loadData();
    }
  }

  // Exclui lembrete
  async function handleDeleteReminder(r: Reminder) {
    const ok = await confirm({
      title: 'Excluir Lembrete?',
      message: `Tem certeza que deseja excluir o lembrete "${r.title}"?`,
      confirmText: 'Excluir',
      cancelText: 'Cancelar',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      await deleteReminder(r.id);
      setReminders((prev) => prev.filter((item) => item.id !== r.id));
      toast('Lembrete excluído.');
    } catch (err) {
      toast((err as Error).message, 'error');
      loadData();
    }
  }

  // Ação rápida: lançar lembrete no extrato
  function handleLaunchReminderExpense(r: Reminder) {
    const params = new URLSearchParams();
    if (r.title) params.set('titulo', r.title);
    if (r.amount_cents) params.set('valor', (r.amount_cents / 100).toFixed(2).replace('.', ','));
    if (r.category_id) params.set('categoria', String(r.category_id));
    if (r.date) params.set('data', r.date);
    navigate(`/lancar?${params.toString()}`);
  }

  // Dados calculados para a grade do calendário
  const calendarGrid = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const firstDayIndex = new Date(y, m - 1, 1).getDay(); // 0 = Dom, 1 = Seg...
    const daysInMonth = new Date(y, m, 0).getDate();

    // Mapeia gastos e lembretes por data (YYYY-MM-DD)
    const expensesMap = new Map<string, { total: number; count: number }>();
    expenses.forEach((e) => {
      const prev = expensesMap.get(e.spent_on) || { total: 0, count: 0 };
      expensesMap.set(e.spent_on, {
        total: prev.total + e.amount_cents,
        count: prev.count + 1,
      });
    });

    const remindersMap = new Map<string, Reminder[]>();
    reminders.forEach((r) => {
      const list = remindersMap.get(r.date) || [];
      list.push(r);
      remindersMap.set(r.date, list);
    });

    const days: CalendarDay[] = [];
    const pad = (n: number) => String(n).padStart(2, '0');

    // Células em branco antes do 1º dia
    for (let i = 0; i < firstDayIndex; i++) {
      days.push({ blank: true, key: `blank-${i}` });
    }

    // Dias do mês
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month}-${pad(d)}`;
      const dayExpenses = expensesMap.get(dateStr);
      const dayReminders = remindersMap.get(dateStr) || [];

      days.push({
        blank: false,
        key: dateStr,
        dayNumber: d,
        dateStr,
        isToday: dateStr === today,
        isSelected: dateStr === selectedDate,
        expensesTotal: dayExpenses?.total || 0,
        expensesCount: dayExpenses?.count || 0,
        reminders: dayReminders,
      });
    }

    return days;
  }, [month, today, selectedDate, expenses, reminders]);

  // Itens do dia selecionado
  const selectedDayExpenses = useMemo(() => {
    return expenses.filter((e) => e.spent_on === selectedDate);
  }, [expenses, selectedDate]);

  const selectedDayReminders = useMemo(() => {
    return reminders.filter((r) => r.date === selectedDate);
  }, [reminders, selectedDate]);

  // Totais do mês
  const monthTotalExpenses = useMemo(() => {
    return expenses.reduce((acc, e) => acc + e.amount_cents, 0);
  }, [expenses]);

  const maxDailyExpense = useMemo(() => {
    let max = 0;
    calendarGrid.forEach((d) => {
      if (!d.blank && d.expensesTotal > max) {
        max = d.expensesTotal;
      }
    });
    return max;
  }, [calendarGrid]);

  const monthPendingReminders = useMemo(() => {
    return reminders.filter((r) => !r.is_completed).length;
  }, [reminders]);

  const monthCompletedReminders = useMemo(() => {
    return reminders.filter((r) => r.is_completed).length;
  }, [reminders]);

  // Item 38: Contas vencidas / em atraso
  const overdueReminders = useMemo(() => {
    return reminders.filter((r) => !r.is_completed && r.date < today);
  }, [reminders, today]);

  // Formata data selecionada por extenso (ex: "Segunda-feira, 16 de Novembro")
  const selectedDateFormatted = useMemo(() => {
    if (!selectedDate) return '';
    const [y, m, d] = selectedDate.split('-').map(Number);
    const dateObj = new Date(y, m - 1, d);
    return dateObj.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    });
  }, [selectedDate]);

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl sm:text-2xl font-black tracking-tight text-white flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
              <IconCalendar className="h-5 w-5" />
            </span>
            Calendário Financeiro
          </h1>
          <p className="text-xs text-zinc-400 mt-0.5">
            Visualize seus gastos por dia e gerencie lembretes e vencimentos pontuais com notificações.
          </p>
        </div>

        {/* Seletor de Mês & Botão Notificações */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-zinc-950/90 p-1">
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, -1))}
              className="rounded-xl p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-white transition"
              title="Mês anterior"
            >
              <IconChevron dir="left" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setMonth(currentMonth())}
              className="px-2 py-1 text-xs font-bold text-zinc-200 capitalize hover:text-emerald-300 transition"
              title="Voltar ao mês atual"
            >
              {monthLabel(month)}
            </button>
            <button
              type="button"
              onClick={() => setMonth(shiftMonth(month, 1))}
              className="rounded-xl p-1.5 text-zinc-400 hover:bg-zinc-900 hover:text-white transition"
              title="Próximo mês"
            >
              <IconChevron dir="right" className="h-4 w-4" />
            </button>
          </div>

          {/* Item 35: Alternador de Visualização (Grade vs Agenda) */}
          <div className="flex rounded-2xl border border-white/[0.08] bg-zinc-950/90 p-1 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={`rounded-xl px-2.5 py-1 font-bold transition ${
                viewMode === 'grid' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400 hover:text-white'
              }`}
            >
              📅 Grade
            </button>
            <button
              type="button"
              onClick={() => setViewMode('agenda')}
              className={`rounded-xl px-2.5 py-1 font-bold transition ${
                viewMode === 'agenda' ? 'bg-emerald-500/20 text-emerald-300' : 'text-zinc-400 hover:text-white'
              }`}
            >
              📋 Agenda
            </button>
          </div>

          <button
            type="button"
            onClick={handleEnableNotifications}
            className={`inline-flex items-center gap-1.5 rounded-2xl px-3 py-2 text-xs font-bold transition active:scale-95 border ${
              hasNotifPermission
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-amber-500/40 bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 shadow-sm shadow-amber-500/20'
            }`}
            title={
              hasNotifPermission
                ? 'Notificações de lembretes ativas no navegador'
                : 'Clique para permitir notificações de vencimentos no horário'
            }
          >
            <span>{hasNotifPermission ? '🔔' : '🔕'}</span>
            <span>{hasNotifPermission ? 'Notificações Ativas' : 'Ativar Notificações'}</span>
          </button>
        </div>
      </div>

      {/* Item 38 & 37: Alerta de Contas Vencidas + Confirmação Rápida de Pagamento */}
      {overdueReminders.length > 0 && (
        <div className="rounded-2xl border border-red-500/40 bg-red-950/30 p-4 space-y-2.5 shadow-lg shadow-red-500/10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-base">🚨</span>
              <h3 className="text-xs sm:text-sm font-extrabold text-red-200">
                Atenção: {overdueReminders.length} {overdueReminders.length === 1 ? 'conta em atraso' : 'contas em atraso'} neste mês!
              </h3>
            </div>
            <span className="text-[11px] text-red-300/80">Confirme o pagamento em 1 clique abaixo</span>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            {overdueReminders.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-red-500/30 bg-black/40 p-2.5 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-bold text-white truncate">{r.title}</p>
                  <p className="text-[10px] text-red-300 tabular-nums">
                    Venceu em {r.date.split('-')[2]}/{r.date.split('-')[1]}
                    {r.amount_cents ? ` • ${formatBRL(r.amount_cents)}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    playSuccessSound('check');
                    handleToggleCompleted(r);
                  }}
                  className="shrink-0 rounded-xl bg-emerald-400 px-3 py-1.5 text-[11px] font-extrabold text-black hover:bg-emerald-300 transition active:scale-95"
                >
                  ✓ Marcar como Pago
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Resumo do Mês */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Gastos no Mês</p>
          <p className="mt-1 text-lg sm:text-xl font-extrabold text-white tabular-nums">
            {formatBRL(monthTotalExpenses)}
          </p>
          <p className="text-[10px] text-zinc-500 mt-0.5">{expenses.length} lançamentos</p>
        </Card>

        <Card className="p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-400">Lembretes Pendentes</p>
          <p className="mt-1 text-lg sm:text-xl font-extrabold text-amber-300 tabular-nums">
            {monthPendingReminders}
          </p>
          <p className="text-[10px] text-zinc-500 mt-0.5">aguardando quitação</p>
        </Card>

        <Card className="p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-400">Quitados no Mês</p>
          <p className="mt-1 text-lg sm:text-xl font-extrabold text-emerald-300 tabular-nums">
            {monthCompletedReminders}
          </p>
          <p className="text-[10px] text-zinc-500 mt-0.5">pagamentos realizados</p>
        </Card>

        <Card className="p-3.5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-purple-400">Dia Selecionado</p>
          <p className="mt-1 text-base sm:text-lg font-bold text-white truncate">
            {selectedDate.split('-')[2]}/{selectedDate.split('-')[1]}
          </p>
          <p className="text-[10px] text-purple-300 mt-0.5 capitalize truncate">
            {selectedDate === today ? 'Hoje' : selectedDateFormatted.split(',')[0]}
          </p>
        </Card>
      </div>

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <Spinner />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* ================= GRADE DO CALENDÁRIO OU MODO AGENDA (ITEM 35) ================= */}
          <div className="lg:col-span-7 xl:col-span-8">
            {viewMode === 'agenda' ? (
              <Card className="p-4 sm:p-5 space-y-4 border-white/[0.08] bg-zinc-950/80">
                <div className="flex items-center justify-between border-b border-white/[0.06] pb-3">
                  <div>
                    <h3 className="text-sm font-extrabold text-white">📋 Visão em Lista / Agenda Cronológica</h3>
                    <p className="text-[11px] text-zinc-400">Todos os lembretes e vencimentos de {monthLabel(month)}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleOpenNewReminder(selectedDate)}
                    className="rounded-xl bg-emerald-400 px-3 py-1.5 text-xs font-extrabold text-black hover:bg-emerald-300"
                  >
                    + Novo Lembrete
                  </button>
                </div>

                {reminders.length === 0 ? (
                  <p className="py-12 text-center text-xs text-zinc-500">
                    Nenhum lembrete cadastrado neste mês.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {reminders.map((r) => (
                      <div
                        key={r.id}
                        onClick={() => setSelectedDate(r.date)}
                        className={`cursor-pointer flex items-center justify-between gap-3 rounded-2xl border p-3.5 transition ${
                          r.is_completed
                            ? 'border-emerald-500/20 bg-emerald-950/10 opacity-75'
                            : r.date < today
                            ? 'border-red-500/40 bg-red-950/20'
                            : 'border-white/[0.08] bg-zinc-900/50 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              playSuccessSound('check');
                              handleToggleCompleted(r);
                            }}
                            className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border transition ${
                              r.is_completed
                                ? 'border-emerald-400 bg-emerald-400 text-black'
                                : 'border-white/20 bg-zinc-900 text-transparent hover:border-emerald-400'
                            }`}
                          >
                            <IconCheck className="h-3.5 w-3.5 stroke-[3]" />
                          </button>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300 tabular-nums">
                                {r.date.split('-')[2]}/{r.date.split('-')[1]}
                              </span>
                              <p className={`text-xs font-bold truncate ${r.is_completed ? 'line-through text-zinc-400' : 'text-white'}`}>
                                {r.title}
                              </p>
                            </div>
                            <p className="text-[10px] text-zinc-400 mt-0.5">
                              {r.time ? `🕒 ${r.time} • ` : ''}
                              {r.category_name || 'Sem categoria'}
                              {r.recurrence === 'monthly' ? ' • 🔁 Mensal' : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {r.amount_cents ? (
                            <span className="text-xs font-extrabold text-white tabular-nums">
                              {formatBRL(r.amount_cents)}
                            </span>
                          ) : null}
                          {!isSimple && (
                            <a
                              href={buildGoogleCalendarUrl(r)}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="rounded-lg border border-blue-500/30 bg-blue-500/15 px-2 py-1 text-[10px] font-bold text-blue-300 hover:bg-blue-500/25"
                              title="Sincronizar com Google Calendar"
                            >
                              📅 Google
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ) : (
            <Card className="p-3 sm:p-5 overflow-hidden border-white/[0.08] shadow-2xl bg-zinc-950/80">
              {/* Dias da Semana (DOM, SEG...) */}
              <div className="grid grid-cols-7 gap-1 text-center mb-2">
                {WEEKDAYS.map((w, idx) => (
                  <div
                    key={w}
                    className={`py-1 text-[11px] font-extrabold uppercase tracking-wider ${
                      idx === 0 || idx === 6 ? 'text-zinc-500' : 'text-zinc-400'
                    }`}
                  >
                    {w}
                  </div>
                ))}
              </div>

              {/* Grid dos Dias */}
              <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
                {calendarGrid.map((item) => {
                  if (item.blank) {
                    return (
                      <div
                        key={item.key}
                        className="aspect-square sm:aspect-auto sm:min-h-20 rounded-xl bg-zinc-950/30 border border-transparent opacity-20"
                      />
                    );
                  }

                  const hasPendingReminder = item.reminders.some((r) => !r.is_completed);
                  const hasDoneReminder = item.reminders.some((r) => r.is_completed);
                  const hasExpenses = item.expensesTotal > 0;
                  const heat = getExpenseHeat(item.expensesTotal, maxDailyExpense);

                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setSelectedDate(item.dateStr!)}
                      className={`group relative flex flex-col justify-between rounded-xl p-1 sm:p-2 text-left transition-all aspect-square sm:aspect-auto sm:min-h-20 active:scale-[0.98] ${
                        item.isSelected
                          ? 'border-2 border-emerald-400 bg-emerald-500/10 shadow-lg shadow-emerald-500/15 ring-2 ring-emerald-500/20'
                          : item.isToday
                          ? 'border border-emerald-500/40 bg-zinc-900/90 hover:bg-zinc-900'
                          : 'border border-white/[0.05] bg-zinc-900/40 hover:border-white/20 hover:bg-zinc-900/80'
                      }`}
                    >
                      {/* Topo do dia: número e indicador de hoje */}
                      <div className="flex items-center justify-between w-full">
                        <span
                          className={`flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center rounded-lg text-xs font-black tabular-nums ${
                            item.isToday
                              ? 'bg-emerald-400 text-black font-extrabold'
                              : item.isSelected
                              ? 'text-emerald-300 font-extrabold'
                              : 'text-zinc-300 group-hover:text-white'
                          }`}
                        >
                          {item.dayNumber}
                        </span>

                        {/* Badges de Lembretes */}
                        {item.reminders.length > 0 && (
                          <div className="flex items-center gap-0.5">
                            {hasPendingReminder && (
                              <span
                                className="h-2 w-2 rounded-full bg-amber-400 animate-pulse ring-2 ring-amber-400/20"
                                title="Lembrete pendente neste dia"
                              />
                            )}
                            {hasDoneReminder && !hasPendingReminder && (
                              <span
                                className="h-2 w-2 rounded-full bg-emerald-400"
                                title="Lembrete quitado"
                              />
                            )}
                          </div>
                        )}
                      </div>

                      {/* Conteúdo do dia (gastos e lembretes visíveis em telas médias/grandes) */}
                      <div className="mt-1 w-full space-y-0.5">
                        {/* Gasto total do dia com indicador térmico no desktop */}
                        {hasExpenses && (
                          <div className="hidden sm:flex items-center gap-1 truncate">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${heat.dotClass}`} />
                            <p className={`truncate text-[10px] font-bold tabular-nums ${heat.textColor}`}>
                              -{formatBRL(item.expensesTotal)}
                            </p>
                          </div>
                        )}

                        {/* Dot com mapa de calor em telas pequenas */}
                        {hasExpenses && (
                          <div className="sm:hidden flex justify-center py-0.5">
                            <span
                              className={`rounded-full transition-transform ${heat.dotClass}`}
                              title={`Gasto do dia: ${formatBRL(item.expensesTotal)} (${heat.label})`}
                            />
                          </div>
                        )}

                        {/* Prévia do 1º lembrete */}
                        {item.reminders.length > 0 && (
                          <div className="hidden sm:block">
                            <p
                              className={`truncate text-[9px] font-semibold px-1 py-0.5 rounded ${
                                hasPendingReminder
                                  ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                                  : 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/25'
                              }`}
                              title={item.reminders.map((r) => r.title).join(', ')}
                            >
                              {item.reminders[0].title}
                            </p>
                            {item.reminders.length > 1 && (
                              <p className="text-[8px] text-zinc-500 mt-0.5">
                                +{item.reminders.length - 1} mais
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Legenda rápida com Mapa de Calor de Gastos */}
              <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between text-[11px] text-zinc-400 flex-wrap gap-2.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" /> Hoje
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-amber-400" /> Lembrete pendente
                  </span>
                  {/* Mapa de Calor */}
                  {!isSimple && (
                    <div className="flex items-center gap-2 pl-2 border-l border-white/10">
                      <span className="text-[10px] text-zinc-500 uppercase font-bold">Gastos:</span>
                      <span className="flex items-center gap-1 text-[10px]" title="Menos gasto">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Menos
                      </span>
                      <span className="flex items-center gap-1 text-[10px]" title="Gasto moderado">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> Médio
                      </span>
                      <span className="flex items-center gap-1 text-[10px]" title="Gasto elevado">
                        <span className="h-2 w-2 rounded-full bg-orange-500" /> Alto
                      </span>
                      <span className="flex items-center gap-1 text-[10px]" title="Pico de gasto">
                        <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_4px_rgba(239,68,68,0.8)]" /> Pico
                      </span>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => handleOpenNewReminder(selectedDate)}
                  className="inline-flex items-center gap-1 text-emerald-400 font-bold hover:underline"
                >
                  <IconPlus className="h-3.5 w-3.5" /> Adicionar lembrete no dia
                </button>
              </div>
            </Card>
            )}
          </div>

          {/* ================= PAINEL DO DIA SELECIONADO ================= */}
          <div className="lg:col-span-5 xl:col-span-4 space-y-4">
            <Card className="p-4 sm:p-5 border-white/[0.08] shadow-2xl bg-zinc-950/90 relative overflow-hidden">
              <div className="flex items-start justify-between gap-2 border-b border-white/[0.06] pb-3.5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black uppercase tracking-wider text-emerald-400">
                      {selectedDate === today ? 'Hoje' : 'Dia Selecionado'}
                    </span>
                    <span className="rounded-md bg-zinc-900 border border-white/[0.06] px-2 py-0.5 text-xs font-bold text-zinc-300 tabular-nums">
                      {selectedDate}
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-extrabold text-white capitalize mt-1">
                    {selectedDateFormatted}
                  </h3>
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleOpenNewReminder(selectedDate)}
                    className="flex items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-2.5 py-1.5 text-xs font-bold text-emerald-300 transition hover:bg-emerald-500/25 active:scale-95"
                    title="Novo Lembrete"
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                    <span>Lembrete</span>
                  </button>

                  <Link
                    to={`/lancar?data=${selectedDate}`}
                    className="rounded-xl border border-white/[0.08] bg-zinc-900 px-2.5 py-1.5 text-xs font-bold text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
                    title="Lançar gasto nesta data"
                  >
                    + Gasto
                  </Link>
                </div>
              </div>

              {/* Form de Criar / Editar Lembrete */}
              {isAddingReminder && (
                <form
                  onSubmit={handleSaveReminder}
                  className="my-3.5 rounded-2xl border border-emerald-500/30 bg-emerald-950/[0.15] p-3.5 space-y-3 animate-in fade-in duration-150"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-emerald-300">
                      {editingReminder ? 'Editar Lembrete' : 'Novo Lembrete / Vencimento'}
                    </p>
                    <button
                      type="button"
                      onClick={() => setIsAddingReminder(false)}
                      className="text-xs text-zinc-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                      Título do Lembrete *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: Pagar fatura Nubank, Vencimento Aluguel"
                      value={remTitle}
                      onChange={(e) => setRemTitle(e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-2 text-xs text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                        Horário (Notificação)
                      </label>
                      <input
                        type="time"
                        value={remTime}
                        onChange={(e) => setRemTime(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                        Valor Previsto (R$)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder="0,00"
                        value={remAmount}
                        onChange={(e) => setRemAmount(formatCurrencyInput(e.target.value))}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-3 py-1.5 text-xs text-white placeholder-zinc-500 focus:border-emerald-500 focus:outline-none tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                        Categoria (opcional)
                      </label>
                      <select
                        value={remCategoryId}
                        onChange={(e) => setRemCategoryId(e.target.value)}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      >
                        <option value="">Sem categoria</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-400 mb-1">
                        Repetição
                      </label>
                      <select
                        value={remRecurrence}
                        onChange={(e) => {
                          const val = e.target.value as 'none' | 'monthly';
                          setRemRecurrence(val);
                          if (val === 'monthly' && remMonths.length === 0) {
                            setRemMonths(getNext12Months(selectedDate.slice(0, 7)));
                          }
                        }}
                        className="w-full rounded-xl border border-white/10 bg-zinc-900 px-2 py-1.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      >
                        <option value="none">Não repete</option>
                        <option value="monthly">Todo mês (Mensal)</option>
                      </select>
                    </div>
                  </div>

                  {/* Seletor de Meses para Replicar Lembrete Mensal */}
                  {!isSimple && remRecurrence === 'monthly' && (
                    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-emerald-300 flex items-center gap-1.5">
                          <span>📅</span> Replicar nos meses ({remMonths.length} selecionados):
                        </span>
                        <div className="flex items-center gap-1 text-[10px]">
                          <button
                            type="button"
                            onClick={() => setRemMonths(getNext12Months(selectedDate.slice(0, 7)))}
                            className="text-emerald-400 hover:underline px-1 cursor-pointer font-bold"
                          >
                            Todos
                          </button>
                          <span className="text-zinc-600">•</span>
                          <button
                            type="button"
                            onClick={() => setRemMonths([selectedDate.slice(0, 7)])}
                            className="text-zinc-400 hover:text-white px-1 cursor-pointer"
                          >
                            Só este
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                        {getNext12Months(selectedDate.slice(0, 7)).map((mStr) => {
                          const isSel = remMonths.includes(mStr);
                          const [y, m] = mStr.split('-').map(Number);
                          const shortNames = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                          const label = `${shortNames[m - 1]}/${String(y).slice(2)}`;
                          return (
                            <button
                              key={mStr}
                              type="button"
                              onClick={() => {
                                setRemMonths((prev) =>
                                  prev.includes(mStr)
                                    ? prev.filter((item) => item !== mStr)
                                    : [...prev, mStr].sort()
                                );
                              }}
                              className={`rounded-lg py-1.5 text-[11px] font-bold border transition text-center cursor-pointer ${
                                isSel
                                  ? 'bg-emerald-500/25 border-emerald-500/50 text-emerald-200 shadow-sm'
                                  : 'bg-zinc-900 border-white/[0.08] text-zinc-500 hover:text-zinc-300'
                              }`}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-[10px] text-zinc-400">
                        O lembrete será criado no dia {Number(selectedDate.split('-')[2])} de cada mês selecionado.
                      </p>
                    </div>
                  )}

                  <div className="flex items-center gap-2 pt-1">
                    <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={remNotify}
                        onChange={(e) => setRemNotify(e.target.checked)}
                        className="rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-0"
                      />
                      <span>Disparar notificação no horário</span>
                    </label>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-white/[0.06]">
                    <button
                      type="button"
                      onClick={() => setIsAddingReminder(false)}
                      className="rounded-xl px-3 py-1.5 text-xs font-semibold text-zinc-400 hover:text-white"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={isSaving}
                      className="rounded-xl bg-emerald-400 px-4 py-1.5 text-xs font-extrabold text-black transition hover:bg-emerald-300 disabled:opacity-50"
                    >
                      {isSaving ? 'Salvando...' : editingReminder ? 'Atualizar' : 'Salvar Lembrete'}
                    </button>
                  </div>
                </form>
              )}

              {/* ================= SEÇÃO: LEMBRETES DO DIA ================= */}
              <div className="mt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                    <span>⏰</span> Lembretes & Vencimentos ({selectedDayReminders.length})
                  </p>
                </div>

                {selectedDayReminders.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-3 text-center border border-dashed border-white/[0.08] rounded-xl">
                    Nenhum lembrete para este dia.{' '}
                    <button
                      type="button"
                      onClick={() => handleOpenNewReminder(selectedDate)}
                      className="text-emerald-400 font-semibold hover:underline"
                    >
                      Criar lembrete
                    </button>
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedDayReminders.map((r) => (
                      <div
                        key={r.id}
                        className={`rounded-2xl border p-3 transition-all ${
                          r.is_completed
                            ? 'border-emerald-500/20 bg-emerald-950/[0.1] opacity-75'
                            : 'border-white/[0.08] bg-zinc-900/60 hover:border-white/15'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-start gap-2.5 min-w-0">
                            {/* Checkbox de Quitado */}
                            <button
                              type="button"
                              onClick={() => handleToggleCompleted(r)}
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-lg border transition ${
                                r.is_completed
                                  ? 'border-emerald-400 bg-emerald-400 text-black'
                                  : 'border-white/20 bg-zinc-900 text-transparent hover:border-emerald-400'
                              }`}
                              title={r.is_completed ? 'Marcado como quitado' : 'Marcar como quitado'}
                            >
                              <IconCheck className="h-3.5 w-3.5 stroke-[3]" />
                            </button>

                            <div className="min-w-0">
                              <p
                                className={`text-xs font-bold truncate ${
                                  r.is_completed ? 'line-through text-zinc-400' : 'text-zinc-100'
                                }`}
                              >
                                {r.title}
                              </p>

                              <div className="flex items-center gap-2 text-[10px] text-zinc-400 mt-0.5 flex-wrap">
                                {r.time && (
                                  <span className="font-semibold text-amber-300/90 flex items-center gap-0.5">
                                    <span>🕒</span> {r.time}
                                  </span>
                                )}
                                {r.category_name && (
                                  <span className="rounded-full bg-zinc-800 px-1.5 py-0.5 text-zinc-300">
                                    {r.category_name}
                                  </span>
                                )}
                                {r.recurrence === 'monthly' && (
                                  <span className="text-purple-300 font-semibold">🔁 Mensal</span>
                                )}
                                {r.notify === 1 && <span title="Notificação ativa">🔔</span>}
                              </div>
                            </div>
                          </div>

                          {/* Valor e Ações */}
                          <div className="text-right shrink-0">
                            {r.amount_cents ? (
                              <p className="text-xs font-extrabold text-white tabular-nums">
                                {formatBRL(r.amount_cents)}
                              </p>
                            ) : null}

                            <div className="mt-1 flex items-center justify-end gap-1">
                              {/* Item 33: Sincronizar com Google Calendar */}
                              {!isSimple && (
                                <a
                                  href={buildGoogleCalendarUrl(r)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="rounded p-1 text-[10px] font-bold text-blue-400 hover:bg-blue-500/20 transition"
                                  title="Adicionar ao Google Calendar"
                                >
                                  📅 Google
                                </a>
                              )}

                              {/* Botão de Lançar no Extrato */}
                              <button
                                type="button"
                                onClick={() => handleLaunchReminderExpense(r)}
                                className="rounded p-1 text-[10px] font-bold text-emerald-400 hover:bg-emerald-500/20 transition"
                                title="Lançar este lembrete no Extrato como gasto"
                              >
                                Lançar
                              </button>

                              <button
                                type="button"
                                onClick={() => handleOpenEditReminder(r)}
                                className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-white transition"
                                title="Editar"
                              >
                                ✏️
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteReminder(r)}
                                className="rounded p-1 text-zinc-500 hover:bg-red-500/20 hover:text-red-400 transition"
                                title="Excluir"
                              >
                                <IconTrash className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ================= SEÇÃO: GASTOS REGISTRADOS NO DIA ================= */}
              <div className="mt-6 pt-4 border-t border-white/[0.06] space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                    <span>💳</span> Gastos Registrados ({selectedDayExpenses.length})
                  </p>
                  {selectedDayExpenses.length > 0 && (
                    <span className="text-xs font-extrabold text-red-400 tabular-nums">
                      -
                      {formatBRL(
                        selectedDayExpenses.reduce((sum, e) => sum + e.amount_cents, 0),
                      )}
                    </span>
                  )}
                </div>

                {selectedDayExpenses.length === 0 ? (
                  <p className="text-xs text-zinc-500 py-3 text-center border border-dashed border-white/[0.08] rounded-xl">
                    Nenhum gasto lançado nesta data.{' '}
                    <Link
                      to={`/lancar?data=${selectedDate}`}
                      className="text-emerald-400 font-semibold hover:underline"
                    >
                      Lançar gasto
                    </Link>
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-56 overflow-y-auto pr-1">
                    {selectedDayExpenses.map((e) => (
                      <Link
                        key={e.id}
                        to={`/extrato?busca=${encodeURIComponent(e.title || e.category_name)}`}
                        className="flex items-center justify-between gap-2 rounded-xl border border-white/[0.04] bg-zinc-900/40 p-2.5 transition hover:border-white/15 hover:bg-zinc-900/80"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-zinc-100 truncate">
                            {e.title || e.category_name}
                          </p>
                          <p className="text-[10px] text-zinc-500 truncate">
                            {e.category_name} • {e.payment_method === 'credit' ? 'Crédito' : 'Débito'}
                          </p>
                        </div>
                        <span className="text-xs font-extrabold text-zinc-200 tabular-nums shrink-0">
                          {formatBRL(e.amount_cents)}
                        </span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
