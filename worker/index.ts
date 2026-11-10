import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomToken, sha256, verifyPassword } from './auth';

type Env = { DB: D1Database; ASSETS: Fetcher };
type Vars = { userId: number; username: string; sessionId: string };
type AppEnv = { Bindings: Env; Variables: Vars };

const SESSION_COOKIE = 'capi_session';
const SESSION_DAYS = 30;

const app = new Hono<AppEnv>().basePath('/api');

// ---------- helpers ----------
const bad = (message: string, status: 400 | 401 | 404 | 409 = 400): never => {
  throw new HTTPException(status, { message });
};

async function body(c: { req: { json: () => Promise<unknown> } }) {
  const data = await c.req.json().catch(() => null);
  if (!data || typeof data !== 'object') bad('JSON inválido');
  return data as Record<string, unknown>;
}

const str = (v: unknown, field: string, { required = true, max = 120 } = {}) => {
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string') return bad(`Campo "${field}" inválido`);
  const s = v.trim();
  if (required && !s) bad(`Campo "${field}" é obrigatório`);
  if (s.length > max) bad(`Campo "${field}" muito longo`);
  return s;
};

const cents = (v: unknown, field: string, { required = true, min = 0 } = {}) => {
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > 1_000_000_000) {
    return bad(`Valor de "${field}" inválido`);
  }
  return v;
};

const idParam = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) bad('ID inválido');
  return n;
};

/** Retorna [início, fim) do mês no formato YYYY-MM-DD */
function monthRange(month: string | undefined) {
  if (!month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) bad('Mês inválido (use YYYY-MM)');
  const [y, m] = month!.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return [`${month}-01`, `${next}-01`] as const;
}

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

async function guardUnique<T>(fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (e) {
    if (String(e).includes('UNIQUE')) bad('Já existe um item com esse nome', 409);
    throw e;
  }
}

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Erro interno' }, 500);
});
app.notFound((c) => c.json({ error: 'Rota não encontrada' }, 404));

// ---------- auth ----------
app.post('/auth/login', async (c) => {
  const data = await body(c);
  const username = str(data.username, 'usuário')!.toLowerCase();
  const password = typeof data.password === 'string' ? data.password : '';

  const user = await c.env.DB.prepare('SELECT id, username, password_hash FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: number; username: string; password_hash: string }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Usuário ou senha inválidos' }, 401);
  }

  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(
      await sha256(token),
      user.id,
      expires,
    ),
  ]);

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
  return c.json({ id: user.id, username: user.username });
});

// Tudo abaixo exige sessão válida
app.use('*', async (c, next) => {
  if (c.req.path === '/api/auth/login') return next();
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: 'Não autenticado' }, 401);
  const sessionId = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(sessionId, Date.now())
    .first<{ id: number; username: string }>();
  if (!row) return c.json({ error: 'Sessão expirada' }, 401);
  c.set('userId', row.id);
  c.set('username', row.username);
  c.set('sessionId', sessionId);
  await next();
});

app.get('/auth/me', (c) => c.json({ id: c.get('userId'), username: c.get('username') }));

app.post('/auth/logout', async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(c.get('sessionId')).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// ---------- ganhos (incomes) ----------
app.get('/incomes', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, amount_cents, sort_order FROM incomes WHERE user_id = ? ORDER BY sort_order, id',
  )
    .bind(c.get('userId'))
    .all();
  return c.json(results);
});

app.post('/incomes', async (c) => {
  const data = await body(c);
  const name = str(data.name, 'nome')!;
  const amount = cents(data.amount_cents, 'valor')!;
  const uid = c.get('userId');
  const row = await guardUnique(() =>
    c.env.DB.prepare(
      `INSERT INTO incomes (user_id, name, amount_cents, sort_order)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM incomes WHERE user_id = ?))
       RETURNING id, name, amount_cents, sort_order`,
    )
      .bind(uid, name, amount, uid)
      .first(),
  );
  return c.json(row, 201);
});

app.put('/incomes/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const data = await body(c);
  const name = str(data.name, 'nome', { required: false });
  const amount = cents(data.amount_cents, 'valor', { required: false });
  const row = await guardUnique(() =>
    c.env.DB.prepare(
      `UPDATE incomes SET name = COALESCE(?, name), amount_cents = COALESCE(?, amount_cents)
       WHERE id = ? AND user_id = ? RETURNING id, name, amount_cents, sort_order`,
    )
      .bind(name ?? null, amount ?? null, id, c.get('userId'))
      .first(),
  );
  if (!row) bad('Ganho não encontrado', 404);
  return c.json(row);
});

app.delete('/incomes/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  await c.env.DB.prepare('DELETE FROM incomes WHERE id = ? AND user_id = ?').bind(id, c.get('userId')).run();
  return c.json({ ok: true });
});

// ---------- categorias / gastos previstos ----------
app.get('/categories', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, budget_cents, note, sort_order FROM categories WHERE user_id = ? ORDER BY sort_order, id',
  )
    .bind(c.get('userId'))
    .all();
  return c.json(results);
});

app.post('/categories', async (c) => {
  const data = await body(c);
  const name = str(data.name, 'nome')!;
  const budget = cents(data.budget_cents, 'valor')!;
  const note = str(data.note ?? '', 'observação', { required: false, max: 200 }) ?? '';
  const uid = c.get('userId');
  const row = await guardUnique(() =>
    c.env.DB.prepare(
      `INSERT INTO categories (user_id, name, budget_cents, note, sort_order)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE user_id = ?))
       RETURNING id, name, budget_cents, note, sort_order`,
    )
      .bind(uid, name, budget, note, uid)
      .first(),
  );
  return c.json(row, 201);
});

app.put('/categories/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const data = await body(c);
  const name = str(data.name, 'nome', { required: false });
  const budget = cents(data.budget_cents, 'valor', { required: false });
  const note = str(data.note, 'observação', { required: false, max: 200 });
  const row = await guardUnique(() =>
    c.env.DB.prepare(
      `UPDATE categories SET name = COALESCE(?, name), budget_cents = COALESCE(?, budget_cents),
       note = COALESCE(?, note) WHERE id = ? AND user_id = ?
       RETURNING id, name, budget_cents, note, sort_order`,
    )
      .bind(name ?? null, budget ?? null, note ?? null, id, c.get('userId'))
      .first(),
  );
  if (!row) bad('Categoria não encontrada', 404);
  return c.json(row);
});

app.delete('/categories/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const uid = c.get('userId');
  const used = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM expenses WHERE category_id = ? AND user_id = ?')
    .bind(id, uid)
    .first<{ n: number }>();
  if (used && used.n > 0) {
    bad(`Essa categoria tem ${used.n} lançamento(s). Exclua os lançamentos antes.`, 409);
  }
  await c.env.DB.prepare('DELETE FROM categories WHERE id = ? AND user_id = ?').bind(id, uid).run();
  return c.json({ ok: true });
});

// ---------- lançamentos (expenses) ----------
const EXPENSE_SELECT = `SELECT e.id, e.category_id, c.name AS category_name, e.amount_cents,
  e.description, e.spent_on, e.payment_method, e.installment_current, e.installment_total,
  e.installment_group_id, e.created_at FROM expenses e JOIN categories c ON c.id = e.category_id`;

function addMonthsToDate(isoDate: string, monthsToAdd: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  // Gera no dia correspondente, limitando aos dias máximos daquele mês
  const targetMonthIndex = (m - 1) + monthsToAdd;
  const targetYear = y + Math.floor(targetMonthIndex / 12);
  const targetMonth = (targetMonthIndex % 12 + 12) % 12 + 1;
  const daysInMonth = new Date(targetYear, targetMonth, 0).getDate();
  const targetDay = Math.min(d, daysInMonth);

  const pad = (n: number) => String(n).padStart(2, '0');
  return `${targetYear}-${pad(targetMonth)}-${pad(targetDay)}`;
}

app.get('/expenses', async (c) => {
  const [start, end] = monthRange(c.req.query('month'));
  const { results } = await c.env.DB.prepare(
    `${EXPENSE_SELECT} WHERE e.user_id = ? AND e.spent_on >= ? AND e.spent_on < ?
     ORDER BY e.spent_on DESC, e.id DESC`,
  )
    .bind(c.get('userId'), start, end)
    .all();
  return c.json(results);
});

async function assertCategory(c: { env: Env }, categoryId: number, userId: number) {
  const cat = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
    .bind(categoryId, userId)
    .first();
  if (!cat) bad('Categoria inválida');
}

app.post('/expenses', async (c) => {
  const data = await body(c);
  const uid = c.get('userId');
  const categoryId = cents(data.category_id, 'categoria', { min: 1 })!;
  const amount = cents(data.amount_cents, 'valor', { min: 1 })!;
  const description = str(data.description ?? '', 'descrição', { required: false, max: 200 }) ?? '';
  const spentOn = str(data.spent_on, 'data')!;
  if (!isDate(spentOn)) bad('Data inválida');
  await assertCategory(c, categoryId, uid);

  // Forma de pagamento
  const rawMethod = typeof data.payment_method === 'string' ? data.payment_method : 'debit';
  const paymentMethod = ['debit', 'pix', 'credit'].includes(rawMethod) ? rawMethod : 'debit';

  // Parcelamento (apenas permitido quando credit)
  const installments = paymentMethod === 'credit' && typeof data.installments === 'number' && Number.isInteger(data.installments) && data.installments > 1
    ? Math.min(data.installments, 48)
    : 1;

  if (installments === 1) {
    const { id } = (await c.env.DB.prepare(
      `INSERT INTO expenses (user_id, category_id, amount_cents, description, spent_on, payment_method, installment_current, installment_total)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1) RETURNING id`,
    )
      .bind(uid, categoryId, amount, description, spentOn, paymentMethod)
      .first<{ id: number }>())!;
    const row = await c.env.DB.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).bind(id).first();
    return c.json(row, 201);
  }

  // Parcelado em N vezes
  const groupId = randomToken();
  const baseInstallment = Math.floor(amount / installments);
  const remainder = amount % installments; // centavos sobressalentes adicionados na primeira parcela

  const statements: D1PreparedStatement[] = [];
  for (let i = 1; i <= installments; i++) {
    const installmentAmount = i === 1 ? baseInstallment + remainder : baseInstallment;
    const installmentDate = addMonthsToDate(spentOn, i - 1);
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO expenses (user_id, category_id, amount_cents, description, spent_on, payment_method, installment_current, installment_total, installment_group_id)
         VALUES (?, ?, ?, ?, ?, 'credit', ?, ?, ?)`,
      ).bind(uid, categoryId, installmentAmount, description, installmentDate, i, installments, groupId),
    );
  }

  await c.env.DB.batch(statements);

  const firstRow = await c.env.DB.prepare(
    `${EXPENSE_SELECT} WHERE e.installment_group_id = ? AND e.installment_current = 1`,
  )
    .bind(groupId)
    .first();
  return c.json(firstRow, 201);
});

app.put('/expenses/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const data = await body(c);
  const uid = c.get('userId');
  const categoryId = cents(data.category_id, 'categoria', { required: false, min: 1 });
  const amount = cents(data.amount_cents, 'valor', { required: false, min: 1 });
  const description = str(data.description, 'descrição', { required: false, max: 200 });
  const spentOn = str(data.spent_on, 'data', { required: false });
  if (spentOn !== undefined && !isDate(spentOn)) bad('Data inválida');
  if (categoryId !== undefined) await assertCategory(c, categoryId, uid);
  const updated = await c.env.DB.prepare(
    `UPDATE expenses SET category_id = COALESCE(?, category_id), amount_cents = COALESCE(?, amount_cents),
     description = COALESCE(?, description), spent_on = COALESCE(?, spent_on)
     WHERE id = ? AND user_id = ? RETURNING id`,
  )
    .bind(categoryId ?? null, amount ?? null, description ?? null, spentOn ?? null, id, uid)
    .first();
  if (!updated) bad('Lançamento não encontrado', 404);
  const row = await c.env.DB.prepare(`${EXPENSE_SELECT} WHERE e.id = ?`).bind(id).first();
  return c.json(row);
});

app.delete('/expenses/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const deleteAllGroup = c.req.query('all_installments') === 'true';
  const uid = c.get('userId');

  const exp = await c.env.DB.prepare('SELECT installment_group_id FROM expenses WHERE id = ? AND user_id = ?')
    .bind(id, uid)
    .first<{ installment_group_id: string | null }>();

  if (!exp) return c.json({ ok: true });

  if (deleteAllGroup && exp.installment_group_id) {
    await c.env.DB.prepare('DELETE FROM expenses WHERE installment_group_id = ? AND user_id = ?')
      .bind(exp.installment_group_id, uid)
      .run();
  } else {
    await c.env.DB.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').bind(id, uid).run();
  }
  return c.json({ ok: true });
});

// ---------- dashboard ----------
app.get('/dashboard', async (c) => {
  const month = c.req.query('month');
  const [start, end] = monthRange(month);
  const uid = c.get('userId');
  const [cats, inc] = await c.env.DB.batch<Record<string, number | string>>([
    c.env.DB.prepare(
      `SELECT c.id, c.name, c.budget_cents, c.note, c.sort_order,
              COALESCE(SUM(e.amount_cents), 0) AS spent_cents, COUNT(e.id) AS count
       FROM categories c
       LEFT JOIN expenses e ON e.category_id = c.id AND e.spent_on >= ? AND e.spent_on < ?
       WHERE c.user_id = ?
       GROUP BY c.id ORDER BY c.sort_order, c.id`,
    ).bind(start, end, uid),
    c.env.DB.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM incomes WHERE user_id = ?').bind(uid),
  ]);
  const categories = cats.results as unknown as { budget_cents: number; spent_cents: number }[];
  return c.json({
    month,
    total_income_cents: Number(inc.results[0]?.total ?? 0),
    total_budget_cents: categories.reduce((s, x) => s + x.budget_cents, 0),
    total_spent_cents: categories.reduce((s, x) => s + x.spent_cents, 0),
    categories,
  });
});

export default app;
