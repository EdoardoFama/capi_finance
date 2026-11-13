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
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? 'GET',
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
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
};

export type AdminUser = {
  id: number;
  username: string;
  email: string | null;
  is_active: number;
  is_admin: number;
  created_at: string;
};

export type Income = { id: number; name: string; amount_cents: number; sort_order: number };
export type Category = {
  id: number;
  name: string;
  budget_cents: number;
  note: string;
  sort_order: number;
  is_fixed?: number;
};

export type AccountId = 'nubank' | 'pluxe_alimentacao' | 'pluxe_refeicao' | 'alelo';
export type PaymentMethod = 'debit' | 'pix' | 'credit' | 'voucher';

export type AccountInfo = {
  id: AccountId;
  name: string;
  tag: string;
  color: string;
  badgeClass: string;
  borderClass: string;
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
  account_id: AccountId;
  name: string;
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
  created_at: string;
};

export type DashboardCategory = Category & { spent_cents: number; count: number; is_fixed: number };

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
  paid_at: string | null;
  paid_amount_cents: number;
  nubank_balance_cents: number;
  expenses: Expense[];
};

export type Inflow = {
  id: number;
  account_id: AccountId;
  amount_cents: number;
  description: string;
  received_on: string;
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
