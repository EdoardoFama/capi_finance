export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = opts.body !== undefined;
  const headers: Record<string, string> = {
    'X-Requested-With': 'XMLHttpRequest',
  };
  if (hasBody) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: hasBody ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new Event('capi:unauthorized'));
    throw new ApiError(res.status, data?.error ?? 'Erro inesperado. Tente novamente.');
  }
  return data as T;
}

export type User = {
  id: number;
  username: string;
  email?: string;
  is_admin: boolean;
  pin_code?: string;
  recent_failed_logins?: number;
  last_failed_login_at?: string | null;
  last_failed_login_ip?: string | null;
};

export type AdminUser = {
  id: number;
  username: string;
  email: string | null;
  is_active: number;
  is_admin: number;
  created_at: string;
};

export type SecurityAuditLog = {
  id: number;
  user_id: number | null;
  username: string | null;
  event_type: string;
  ip_address: string;
  user_agent: string;
  details: string;
  created_at: string;
};

export type AdminSecuritySummary = {
  active_sessions_count: number;
  active_blocks_count: number;
  logs: SecurityAuditLog[];
};

export type Income = { id: number; name: string; amount_cents: number; sort_order: number };
export type Category = {
  id: number;
  name: string;
  budget_cents: number;
  note: string;
  sort_order: number;
  is_fixed?: number;
  icon?: string;
};

/** Resolve automaticamente o ícone ideal para cada categoria caso não haja um personalizado (Item 28) */
export function getCategoryIcon(name: string, customIcon?: string): string {
  if (customIcon && customIcon.trim()) return customIcon.trim();
  const s = (name || '').toLowerCase();
  if (/condom[ií]nio|aluguel|casa|moradia/i.test(s)) return '🏢';
  if (/energia|luz|enel|el[eé]trica/i.test(s)) return '⚡';
  if (/internet|fibra|wifi|brisanet/i.test(s)) return '🌐';
  if (/dados\s*m[oó]veis|celular|claro|vivo|tim/i.test(s)) return '📱';
  if (/g[aá]s|botij[aã]o/i.test(s)) return '🔥';
  if (/feira|mercado|supermercado|alimenta[cç][aã]o/i.test(s)) return '🛒';
  if (/farm[aá]cia|rem[eé]dio|sa[uú]de|m[eé]dico/i.test(s)) return '💊';
  if (/gasolina|combust[ií]vel|posto/i.test(s)) return '⛽';
  if (/carro|uber|99|transporte|oficina/i.test(s)) return '🚗';
  if (/investimento|reserva|aporte|caixinha/i.test(s)) return '📈';
  if (/lidia|fam[ií]lia|ajuda|m[aã]e|pai/i.test(s)) return '💜';
  if (/lanche|restaurante|ifood|pizza|bar|comida/i.test(s)) return '🍔';
  if (/assinatura|streaming|netflix|spotify/i.test(s)) return '🎬';
  if (/cabelo|barbearia|sal[aã]o|est[eé]tica/i.test(s)) return '💈';
  if (/roupa|vestu[aá]rio|cal[cç]ado|shopping/i.test(s)) return '👕';
  if (/jogo|game|steam|lazer|divers[aã]o/i.test(s)) return '🎮';
  if (/educa[cç][aã]o|curso|livro|faculdade/i.test(s)) return '📚';
  if (/pet|cachorro|gato|racao/i.test(s)) return '🐾';
  if (/viagem|hotel|passagem/i.test(s)) return '✈️';
  return '🏷️';
}

export type AccountId = string;
export type PaymentMethod = 'debit' | 'pix' | 'credit' | 'voucher';

export type UserAccount = {
  id: number;
  slug: string;
  name: string;
  color: string;
  sort_order: number;
};

export type AccountInfo = {
  id: string;
  name: string;
  tag: string;
  color: string;
  badgeClass?: string;
  borderClass?: string;
};

export const ACCOUNT_DEFINITIONS: AccountInfo[] = [
  {
    id: 'nubank',
    name: 'NUBANK',
    tag: 'Nubank',
    color: '#820ad1',
    badgeClass: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
    borderClass: 'border-purple-500/40 hover:border-purple-500/70',
  },
  {
    id: 'pluxe_alimentacao',
    name: 'PLUXE - ALIMENTAÇÃO',
    tag: 'Pluxe Alim.',
    color: '#10b981',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    borderClass: 'border-emerald-500/40 hover:border-emerald-500/70',
  },
  {
    id: 'pluxe_refeicao',
    name: 'PLUXE - REFEIÇÃO',
    tag: 'Pluxe Ref.',
    color: '#06b6d4',
    badgeClass: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
    borderClass: 'border-cyan-500/40 hover:border-cyan-500/70',
  },
  {
    id: 'alelo',
    name: 'ALELO',
    tag: 'Alelo',
    color: '#f97316',
    badgeClass: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    borderClass: 'border-orange-500/40 hover:border-orange-500/70',
  },
];

export type AccountBalance = {
  id?: number;
  account_id: string;
  name: string;
  color?: string;
  initial_cents: number;
  spent_cents: number;
  current_cents: number;
};

export type Expense = {
  id: number;
  category_id: number;
  category_name: string;
  amount_cents: number;
  title: string;
  description: string;
  spent_on: string;
  account_id: AccountId;
  payment_method: PaymentMethod;
  installment_current: number;
  installment_total: number;
  installment_group_id: string | null;
  tags?: string;
  created_at: string;
};

export type DashboardCategory = Category & {
  spent_cents: number;
  count: number;
  is_fixed: number;
  is_checked?: boolean;
  is_unlocked?: boolean;
  icon?: string;
};

export type SavingsGoal = {
  id: number;
  name: string;
  icon: string;
  target_cents: number;
  current_cents: number;
  color: string;
  created_at: string;
};

export type DashboardProjection = {
  bank_balance_cents: number;
  expected_income_cents: number;
  inflows_total_cents: number;
  expected_remaining_income_cents: number;
  invoice_remaining_cents: number;
  fixed_remaining_cents: number;
  predicted_surplus_cents: number;
};

export type Dashboard = {
  month: string;
  total_income_cents: number;
  total_budget_cents: number;
  total_spent_cents: number;
  fixed_budget_cents: number;
  fixed_spent_cents: number;
  variable_spent_cents: number;
  por_fora_budget_cents: number;
  por_fora_spent_cents: number;
  por_fora_remaining_cents: number;
  categories: DashboardCategory[];
  accounts: AccountBalance[];
  projection: DashboardProjection;
  top_expenses?: Expense[];
  daily_heatmap?: { date: string; total_cents: number; count: number }[];
  savings_goals?: SavingsGoal[];
};

export type MonthlyAnalyticsItem = {
  month: string;
  month_label: string;
  expenses_cents: number;
  inflows_cents: number;
  credit_card_cents: number;
  debit_cents: number;
  investments_cents: number;
  net_cents: number;
};

export type InvestmentAccount = {
  id: number;
  name: string;
  color: string;
  sort_order: number;
};

export type InvestmentSnapshot = {
  account_id: number;
  month: string;
  balance_cents: number;
  delta_cents: number;
};

export type InvestmentsData = {
  accounts: InvestmentAccount[];
  snapshots: InvestmentSnapshot[];
};

export type CreditCardInvoice = {
  month: string;
  total_cents: number;
  count: number;
  is_paid: boolean;
  is_partial?: boolean;
  paid_at: string | null;
  paid_amount_cents: number;
  remaining_cents: number;
  nubank_balance_cents: number;
  expenses: Expense[];
  by_category?: { category_id: number; category_name: string; total_cents: number; count: number }[];
  history?: { month: string; total_cents: number }[];
  cycle?: {
    closing_day: number;
    due_day: number;
    before_closing_cents: number;
    after_closing_cents: number;
    next_month: string;
    next_month_scheduled_cents: number;
  };
};

export type Inflow = {
  id: number;
  account_id: AccountId;
  amount_cents: number;
  description: string;
  received_on: string;
  created_at: string;
};

export type InvoicePayment = {
  id: number;
  invoice_month: string;
  account_id: AccountId;
  amount_cents: number;
  is_partial: number;
  paid_on: string;
  created_at: string;
};

export type RedeemResult = {
  ok: boolean;
  account_id: number;
  account_name: string;
  redeemed_cents: number;
  new_balance_cents: number;
  month: string;
};

export type WebhookTokenResponse = {
  webhook_token: string;
  webhook_url: string;
};

export type WebhookLog = {
  id: number;
  title: string;
  body: string;
  parsed_type: string;
  status: 'processed' | 'ignored' | 'duplicate' | 'error';
  result_summary: string;
  expense_id: number | null;
  created_at: string;
};

export const getWebhookToken = () => api<WebhookTokenResponse>('/user/webhook-token');
export const regenerateWebhookToken = () => api<WebhookTokenResponse>('/user/webhook-token/regenerate', { method: 'POST' });
export const getWebhookLogs = () => api<WebhookLog[]>('/user/webhook-logs');
export const reprocessWebhookLog = (id: number) =>
  api<{ ok: boolean; expense_id: number; summary: string }>(`/user/webhook-logs/${id}/reprocess`, { method: 'POST' });

export const toggleCategoryCheck = (
  id: number,
  month: string,
  is_checked?: boolean,
  is_unlocked?: boolean,
) =>
  api<{ ok: boolean; category_id: number; month: string; is_checked: boolean; is_unlocked: boolean }>(
    `/categories/${id}/check`,
    {
      method: 'POST',
      body: { month, is_checked, is_unlocked },
    },
  );

export const reorderCategories = (ordered_ids: number[]) =>
  api<{ ok: boolean }>('/categories/reorder', {
    method: 'POST',
    body: { ordered_ids },
  });

export const getSavingsGoals = () => api<SavingsGoal[]>('/savings-goals');
export const createSavingsGoal = (data: {
  name: string;
  icon?: string;
  target_cents: number;
  current_cents?: number;
  color?: string;
}) => api<SavingsGoal>('/savings-goals', { method: 'POST', body: data });

export const updateSavingsGoal = (
  id: number,
  data: Partial<{
    name: string;
    icon: string;
    target_cents: number;
    current_cents: number;
    add_cents: number;
    color: string;
  }>,
) => api<SavingsGoal>(`/savings-goals/${id}`, { method: 'PUT', body: data });

export const deleteSavingsGoal = (id: number) =>
  api<{ ok: boolean }>(`/savings-goals/${id}`, { method: 'DELETE' });

export const batchUpdateCategory = (ids: number[], category_id: number) =>
  api<{ ok: boolean; updated_count: number }>('/expenses/batch-category', {
    method: 'POST',
    body: { ids, category_id },
  });

export const batchDeleteExpenses = (ids: number[]) =>
  api<{ ok: boolean; deleted_count: number }>('/expenses/batch-delete', {
    method: 'POST',
    body: { ids },
  });

export const getExpensesRange = (start: string, end: string) =>
  api<Expense[]>(`/expenses/range?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);

export const updateUserPin = (pin_code: string) =>
  api<{ ok: boolean; pin_code: string }>('/user/pin', {
    method: 'POST',
    body: { pin_code },
  });

/** Item 73: Fila de sincronização Offline para lançamentos feitos sem internet */
const OFFLINE_QUEUE_KEY = 'capi:offline_expenses_queue';

export function getOfflineQueue(): Record<string, unknown>[] {
  try {
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function enqueueOfflineExpense(payload: Record<string, unknown>) {
  try {
    const queue = getOfflineQueue();
    queue.push({ ...payload, _queued_at: new Date().toISOString() });
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch {}
}

export async function syncOfflineExpenses(): Promise<number> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 0;
  const queue = getOfflineQueue();
  if (queue.length === 0) return 0;

  let synced = 0;
  const remaining: Record<string, unknown>[] = [];
  for (const item of queue) {
    try {
      const { _queued_at, ...bodyData } = item;
      await api('/expenses', { method: 'POST', body: bodyData });
      synced++;
    } catch {
      remaining.push(item);
    }
  }
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining));
  } catch {}
  return synced;
}

/** Item 95: Efeito Sonoro de Sucesso Sintetizado via Web Audio API */
export function playSuccessSound(type: 'coin' | 'check' | 'unlock' = 'coin') {
  try {
    if (localStorage.getItem('capi:sound_muted') === '1') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'coin') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.07); // A5
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);
      osc.start(now);
      osc.stop(now + 0.28);
    } else if (type === 'check') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.setValueAtTime(659.25, now + 0.06); // E5
      osc.frequency.setValueAtTime(783.99, now + 0.12); // G5
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      osc.start(now);
      osc.stop(now + 0.32);
    } else {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.setValueAtTime(660, now + 0.08);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now);
      osc.stop(now + 0.22);
    }
  } catch {}
}

export type Reminder = {
  id: number;
  user_id: number;
  title: string;
  date: string;
  time: string | null;
  amount_cents: number | null;
  category_id: number | null;
  category_name?: string | null;
  is_completed: number;
  notify: number;
  recurrence: 'none' | 'monthly';
  created_at: string;
};

export const getReminders = (month?: string, date?: string) => {
  const query = month ? `?month=${month}` : date ? `?date=${date}` : '';
  return api<Reminder[]>(`/reminders${query}`);
};

export const createReminder = (data: {
  title: string;
  date: string;
  time?: string | null;
  amount_cents?: number | null;
  category_id?: number | null;
  notify?: boolean | number;
  recurrence?: 'none' | 'monthly';
  months?: string[];
}) => api<Reminder>('/reminders', { method: 'POST', body: data });

export const updateReminder = (
  id: number,
  data: Partial<{
    title: string;
    date: string;
    time: string | null;
    amount_cents: number | null;
    category_id: number | null;
    is_completed: number | boolean;
    notify: number | boolean;
    recurrence: 'none' | 'monthly';
  }>,
) => api<Reminder>(`/reminders/${id}`, { method: 'PUT', body: data });

export const deleteReminder = (id: number) =>
  api<{ ok: boolean }>(`/reminders/${id}`, { method: 'DELETE' });


