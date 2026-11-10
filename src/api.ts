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

export type User = { id: number; username: string };
export type Income = { id: number; name: string; amount_cents: number; sort_order: number };
export type Category = { id: number; name: string; budget_cents: number; note: string; sort_order: number };
export type PaymentMethod = 'debit' | 'pix' | 'credit';

export type Expense = {
  id: number;
  category_id: number;
  category_name: string;
  amount_cents: number;
  description: string;
  spent_on: string;
  payment_method: PaymentMethod;
  installment_current: number;
  installment_total: number;
  installment_group_id: string | null;
  created_at: string;
};
export type DashboardCategory = Category & { spent_cents: number; count: number };
export type Dashboard = {
  month: string;
  total_income_cents: number;
  total_budget_cents: number;
  total_spent_cents: number;
  categories: DashboardCategory[];
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

