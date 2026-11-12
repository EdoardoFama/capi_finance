import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { randomToken, sha256, verifyPassword, hashPassword } from './auth';
import { sendEmail } from './mailer';

type Env = { DB: D1Database; ASSETS: Fetcher; SMTP_USER?: string; SMTP_PASS?: string };
type Vars = { userId: number; username: string; sessionId: string; isAdmin: boolean };
type AppEnv = { Bindings: Env; Variables: Vars };

const SESSION_COOKIE = 'capi_session';
const SESSION_DAYS = 30;

const app = new Hono<AppEnv>().basePath('/api');

// ---------- helpers ----------
function bad(message: string, status: 400 | 401 | 403 | 404 | 409 = 400): never {
  throw new HTTPException(status, { message });
}

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
function generateOTP(): string {
  const arr = crypto.getRandomValues(new Uint32Array(1));
  return String(100000 + (arr[0] % 900000));
}

// 1. Iniciar Cadastro: gera OTP e envia por e-mail
app.post('/auth/signup/request', async (c) => {
  const data = await body(c);
  const username = str(data.username, 'usuário')!.toLowerCase();
  const email = str(data.email, 'e-mail')!.toLowerCase();
  const password = typeof data.password === 'string' ? data.password : '';

  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) {
    bad('Usuário deve ter entre 3 e 30 caracteres alfanuméricos');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    bad('E-mail inválido');
  }
  if (password.length < 6) {
    bad('A senha deve ter no mínimo 6 caracteres');
  }

  // Verifica se username ou email já existem
  const existing = await c.env.DB.prepare('SELECT username, email FROM users WHERE username = ? OR email = ?')
    .bind(username, email)
    .first<{ username: string; email: string }>();

  if (existing) {
    if (existing.username === username) bad('Nome de usuário já cadastrado', 409);
    if (existing.email === email) bad('E-mail já cadastrado', 409);
  }

  const code = generateOTP();
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutos
  const passwordHash = await hashPassword(password);
  const payload = JSON.stringify({ username, password_hash: passwordHash });

  // Salva no banco
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ? AND type = "signup"').bind(email),
    c.env.DB.prepare('INSERT INTO verification_codes (email, code, type, payload, expires_at) VALUES (?, ?, "signup", ?, ?)')
      .bind(email, code, payload, expiresAt),
  ]);

  // Enviar e-mail
  if (c.env.SMTP_USER && c.env.SMTP_PASS) {
    try {
      await sendEmail({
        to: email,
        subject: `Seu código de confirmação: ${code}`,
        smtpUser: c.env.SMTP_USER,
        smtpPass: c.env.SMTP_PASS,
        html: `
          <div style="font-family: sans-serif; background-color: #000; color: #fff; padding: 30px; border-radius: 12px; max-width: 480px; margin: auto;">
            <h2 style="color: #34d399; margin-top: 0;">Bem-vindo ao Capi Finance!</h2>
            <p>Seu código de verificação para ativar sua conta é:</p>
            <div style="background-color: #18181b; padding: 16px; border-radius: 8px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #34d399; margin: 24px 0;">
              ${code}
            </div>
            <p style="color: #a1a1aa; font-size: 13px;">O código é válido por 15 minutos. Se você não solicitou este cadastro, desconsidere esta mensagem.</p>
          </div>
        `,
      });
    } catch (err: unknown) {
      console.error('Falha ao enviar e-mail:', err);
      const msg = err instanceof Error ? err.message : String(err);
      bad(`Não foi possível enviar o e-mail de confirmação: ${msg}`);
    }
  }

  return c.json({ ok: true, message: 'Código enviado para seu e-mail!' });
});

// 2. Confirmar Cadastro com o código OTP
app.post('/auth/signup/confirm', async (c) => {
  const data = await body(c);
  const email = str(data.email, 'e-mail')!.toLowerCase();
  const code = str(data.code, 'código')!.trim();

  const record = await c.env.DB.prepare(
    'SELECT payload FROM verification_codes WHERE email = ? AND code = ? AND type = "signup" AND expires_at > ?',
  )
    .bind(email, code, Date.now())
    .first<{ payload: string }>();

  if (!record) {
    bad('Código inválido ou expirado', 400);
  }

  const { username, password_hash } = JSON.parse((record as { payload: string }).payload);

  // Insere o novo usuário ativo
  const { id: newUserId } = (await c.env.DB.prepare(
    'INSERT INTO users (username, email, password_hash, is_active, is_admin) VALUES (?, ?, ?, 1, 0) RETURNING id',
  )
    .bind(username, email, password_hash)
    .first<{ id: number }>())!;

  // Cria o orçamento padrão para o novo usuário
  const defaultIncomes = [
    ['SALÁRIO', 500000],
    ['OUTROS', 50000],
  ];
  const defaultCategories = [
    ['FEIRA', 100000],
    ['LANCHE/ETC', 30000],
    ['CARRO', 50000],
    ['CASA', 80000],
    ['FARMÁCIA', 15000],
    ['OUTROS', 20000],
  ];

  const batchStmts: D1PreparedStatement[] = [
    c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ?').bind(email),
  ];

  defaultIncomes.forEach(([name, centsVal], i) => {
    batchStmts.push(
      c.env.DB.prepare('INSERT INTO incomes (user_id, name, amount_cents, sort_order) VALUES (?, ?, ?, ?)').bind(
        newUserId,
        name,
        centsVal,
        i + 1,
      ),
    );
  });

  defaultCategories.forEach(([name, centsVal], i) => {
    batchStmts.push(
      c.env.DB.prepare('INSERT INTO categories (user_id, name, budget_cents, note, sort_order) VALUES (?, ?, ?, "", ?)').bind(
        newUserId,
        name,
        centsVal,
        i + 1,
      ),
    );
  });

  await c.env.DB.batch(batchStmts);

  // Cria sessão e autentica direto
  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').bind(
    await sha256(token),
    newUserId,
    expires,
  ).run();

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });

  return c.json({ id: newUserId, username, email, is_admin: false });
});

// 3. Esqueci Minha Senha: pede envio de código
app.post('/auth/password/request', async (c) => {
  const data = await body(c);
  const email = str(data.email, 'e-mail')!.toLowerCase();

  const user = await c.env.DB.prepare('SELECT id, username FROM users WHERE email = ? AND is_active = 1')
    .bind(email)
    .first<{ id: number; username: string }>();

  if (!user) {
    // Por segurança não revelamos se existe ou não, mas retornamos ok
    return c.json({ ok: true, message: 'Se o e-mail estiver cadastrado, o código foi enviado.' });
  }

  const code = generateOTP();
  const expiresAt = Date.now() + 15 * 60 * 1000;

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ? AND type = "reset_password"').bind(email),
    c.env.DB.prepare('INSERT INTO verification_codes (email, code, type, payload, expires_at) VALUES (?, ?, "reset_password", ?, ?)')
      .bind(email, code, String(user.id), expiresAt),
  ]);

  if (c.env.SMTP_USER && c.env.SMTP_PASS) {
    try {
      await sendEmail({
        to: email,
        subject: `Recuperação de Senha - Capi Finance: ${code}`,
        smtpUser: c.env.SMTP_USER,
        smtpPass: c.env.SMTP_PASS,
        html: `
          <div style="font-family: sans-serif; background-color: #000; color: #fff; padding: 30px; border-radius: 12px; max-width: 480px; margin: auto;">
            <h2 style="color: #34d399; margin-top: 0;">Recuperação de Senha</h2>
            <p>Olá, <b>${user.username}</b>. Você solicitou a redefinição da sua senha.</p>
            <p>Use o código abaixo para cadastrar uma nova senha:</p>
            <div style="background-color: #18181b; padding: 16px; border-radius: 8px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #34d399; margin: 24px 0;">
              ${code}
            </div>
            <p style="color: #a1a1aa; font-size: 13px;">O código é válido por 15 minutos. Se não foi você, ignore.</p>
          </div>
        `,
      });
    } catch (err) {
      console.error('Falha ao enviar e-mail de reset:', err);
    }
  }

  return c.json({ ok: true, message: 'Código de recuperação enviado para o e-mail!' });
});

// 4. Redefinir Senha com o código
app.post('/auth/password/reset', async (c) => {
  const data = await body(c);
  const email = str(data.email, 'e-mail')!.toLowerCase();
  const code = str(data.code, 'código')!.trim();
  const newPassword = typeof data.new_password === 'string' ? data.new_password : '';

  if (newPassword.length < 6) {
    bad('A nova senha deve ter no mínimo 6 caracteres');
  }

  const record = await c.env.DB.prepare(
    'SELECT payload FROM verification_codes WHERE email = ? AND code = ? AND type = "reset_password" AND expires_at > ?',
  )
    .bind(email, code, Date.now())
    .first<{ payload: string }>();

  if (!record) {
    bad('Código de recuperação inválido ou expirado', 400);
  }

  const userId = Number(record.payload);
  const newHash = await hashPassword(newPassword);

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, userId),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId), // desconecta outras sessões
    c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ?').bind(email),
  ]);

  return c.json({ ok: true, message: 'Senha atualizada com sucesso! Faça login.' });
});

// 5. Login
app.post('/auth/login', async (c) => {
  const data = await body(c);
  const loginInput = str(data.username, 'usuário ou e-mail')!.toLowerCase();
  const password = typeof data.password === 'string' ? data.password : '';

  const user = await c.env.DB.prepare(
    'SELECT id, username, email, password_hash, is_active, is_admin FROM users WHERE username = ? OR email = ?',
  )
    .bind(loginInput, loginInput)
    .first<{ id: number; username: string; email: string; password_hash: string; is_active: number; is_admin: number }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.json({ error: 'Usuário ou senha inválidos' }, 401);
  }

  if (user.is_active === 0) {
    return c.json({ error: 'Sua conta está bloqueada pelo administrador.' }, 403);
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
  return c.json({ id: user.id, username: user.username, email: user.email, is_admin: user.is_admin === 1 });
});

// Middleware de autenticação
app.use('*', async (c, next) => {
  if (
    c.req.path === '/api/auth/login' ||
    c.req.path === '/api/auth/signup/request' ||
    c.req.path === '/api/auth/signup/confirm' ||
    c.req.path === '/api/auth/password/request' ||
    c.req.path === '/api/auth/password/reset'
  ) {
    return next();
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: 'Não autenticado' }, 401);
  const sessionId = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.is_active, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(sessionId, Date.now())
    .first<{ id: number; username: string; is_active: number; is_admin: number }>();

  if (!row || row.is_active === 0) return c.json({ error: 'Sessão inválida ou conta bloqueada' }, 401);

  c.set('userId', row.id);
  c.set('username', row.username);
  c.set('sessionId', sessionId);
  c.set('isAdmin', row.is_admin === 1);
  await next();
});

app.get('/auth/me', async (c) => {
  const user = await c.env.DB.prepare('SELECT id, username, email, is_admin FROM users WHERE id = ?')
    .bind(c.get('userId'))
    .first<{ id: number; username: string; email: string; is_admin: number }>();
  return c.json({
    id: user?.id,
    username: user?.username,
    email: user?.email,
    is_admin: user?.is_admin === 1,
  });
});

app.post('/auth/logout', async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(c.get('sessionId')).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// ---------- PAINEL EXCLUSIVO DE ADMIN (apenas edoardofama / is_admin = 1) ----------
app.get('/admin/users', async (c) => {
  if (!c.get('isAdmin')) bad('Acesso negado: apenas o administrador pode acessar esta área', 403);
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, email, is_active, is_admin, created_at FROM users ORDER BY id ASC',
  ).all();
  return c.json(results);
});

app.post('/admin/users/:id/toggle-status', async (c) => {
  if (!c.get('isAdmin')) bad('Acesso negado', 403);
  const targetId = idParam(c.req.param('id'));
  if (targetId === c.get('userId')) bad('Você não pode bloquear sua própria conta de admin', 400);

  const target = await c.env.DB.prepare('SELECT is_active FROM users WHERE id = ?')
    .bind(targetId)
    .first<{ is_active: number }>();
  if (!target) bad('Usuário não encontrado', 404);

  const newStatus = target.is_active === 1 ? 0 : 1;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(newStatus, targetId),
    ...(newStatus === 0 ? [c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId)] : []),
  ]);

  return c.json({ id: targetId, is_active: newStatus });
});

app.delete('/admin/users/:id', async (c) => {
  if (!c.get('isAdmin')) bad('Acesso negado', 403);
  const targetId = idParam(c.req.param('id'));
  if (targetId === c.get('userId')) bad('Você não pode excluir sua própria conta de admin', 400);

  await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId).run();
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
    'SELECT id, name, budget_cents, note, sort_order, COALESCE(is_fixed, 1) AS is_fixed FROM categories WHERE user_id = ? ORDER BY is_fixed DESC, sort_order, id',
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
  const isFixed = data.is_fixed === 0 || data.is_fixed === false ? 0 : 1;
  const uid = c.get('userId');
  const row = await guardUnique(() =>
    c.env.DB.prepare(
      `INSERT INTO categories (user_id, name, budget_cents, note, sort_order, is_fixed)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE user_id = ?), ?)
       RETURNING id, name, budget_cents, note, sort_order, is_fixed`,
    )
      .bind(uid, name, budget, note, uid, isFixed)
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
  const isFixed = data.is_fixed !== undefined ? (data.is_fixed ? 1 : 0) : null;
  const row = await guardUnique(() =>
    c.env.DB.prepare(
      `UPDATE categories SET name = COALESCE(?, name), budget_cents = COALESCE(?, budget_cents),
       note = COALESCE(?, note), is_fixed = COALESCE(?, is_fixed) WHERE id = ? AND user_id = ?
       RETURNING id, name, budget_cents, note, sort_order, is_fixed`,
    )
      .bind(name ?? null, budget ?? null, note ?? null, isFixed, id, c.get('userId'))
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
const VALID_ACCOUNTS = ['nubank', 'pluxe_alimentacao', 'pluxe_refeicao', 'alelo'] as const;
type AccountId = (typeof VALID_ACCOUNTS)[number];
const ACCOUNT_NAMES: Record<AccountId, string> = {
  nubank: 'NUBANK',
  pluxe_alimentacao: 'PLUXE - ALIMENTAÇÃO',
  pluxe_refeicao: 'PLUXE - REFEIÇÃO',
  alelo: 'ALELO',
};

const EXPENSE_SELECT = `SELECT e.id, e.category_id, c.name AS category_name, e.amount_cents,
  e.title, e.description, e.spent_on, e.payment_method, COALESCE(e.account_id, 'nubank') AS account_id,
  e.installment_current, e.installment_total,
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
  const title = str(data.title, 'título', { required: true, max: 120 })!;
  const description = str(data.description ?? '', 'descrição', { required: false, max: 200 }) ?? '';
  const spentOn = str(data.spent_on, 'data')!;
  if (!isDate(spentOn)) bad('Data inválida');
  await assertCategory(c, categoryId, uid);

  // Conta de pagamento e forma
  const rawAccount = typeof data.account_id === 'string' ? data.account_id : 'nubank';
  const accountId: AccountId = (VALID_ACCOUNTS as readonly string[]).includes(rawAccount)
    ? (rawAccount as AccountId)
    : 'nubank';

  const rawMethod = typeof data.payment_method === 'string'
    ? data.payment_method
    : (accountId === 'nubank' ? 'debit' : 'voucher');
  const paymentMethod = ['debit', 'pix', 'credit', 'voucher'].includes(rawMethod)
    ? rawMethod
    : (accountId === 'nubank' ? 'debit' : 'voucher');

  // Parcelamento (apenas permitido quando credit e na conta nubank)
  const installments = accountId === 'nubank' && paymentMethod === 'credit' && typeof data.installments === 'number' && Number.isInteger(data.installments) && data.installments > 1
    ? Math.min(data.installments, 48)
    : 1;

  if (installments === 1) {
    const { id } = (await c.env.DB.prepare(
      `INSERT INTO expenses (user_id, category_id, amount_cents, title, description, spent_on, payment_method, account_id, installment_current, installment_total)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1) RETURNING id`,
    )
      .bind(uid, categoryId, amount, title, description, spentOn, paymentMethod, accountId)
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
        `INSERT INTO expenses (user_id, category_id, amount_cents, title, description, spent_on, payment_method, account_id, installment_current, installment_total, installment_group_id)
         VALUES (?, ?, ?, ?, ?, ?, 'credit', ?, ?, ?, ?)`,
      ).bind(uid, categoryId, installmentAmount, title, description, installmentDate, accountId, i, installments, groupId),
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
  const allInstallments = c.req.query('all_installments') === 'true';
  const categoryId = cents(data.category_id, 'categoria', { required: false, min: 1 });
  const amount = cents(data.amount_cents, 'valor', { required: false, min: 1 });
  const title = str(data.title, 'título', { required: false, max: 120 });
  const description = str(data.description, 'descrição', { required: false, max: 200 });
  const spentOn = str(data.spent_on, 'data', { required: false });
  if (spentOn !== undefined && !isDate(spentOn)) bad('Data inválida');
  if (categoryId !== undefined) await assertCategory(c, categoryId, uid);

  const rawAccount = typeof data.account_id === 'string' && (VALID_ACCOUNTS as readonly string[]).includes(data.account_id)
    ? data.account_id
    : null;
  const rawMethod = typeof data.payment_method === 'string' && ['debit', 'pix', 'credit', 'voucher'].includes(data.payment_method)
    ? data.payment_method
    : null;

  const current = await c.env.DB.prepare('SELECT installment_group_id FROM expenses WHERE id = ? AND user_id = ?')
    .bind(id, uid)
    .first<{ installment_group_id: string | null }>();
  if (!current) bad('Lançamento não encontrado', 404);

  if (allInstallments && current.installment_group_id) {
    await c.env.DB.prepare(
      `UPDATE expenses SET category_id = COALESCE(?, category_id),
       title = COALESCE(?, title),
       account_id = COALESCE(?, account_id),
       payment_method = COALESCE(?, payment_method)
       WHERE installment_group_id = ? AND user_id = ?`,
    )
      .bind(categoryId ?? null, title ?? null, rawAccount, rawMethod, current.installment_group_id, uid)
      .run();
  }

  const updated = await c.env.DB.prepare(
    `UPDATE expenses SET category_id = COALESCE(?, category_id), amount_cents = COALESCE(?, amount_cents),
     title = COALESCE(?, title), description = COALESCE(?, description), spent_on = COALESCE(?, spent_on),
     account_id = COALESCE(?, account_id), payment_method = COALESCE(?, payment_method)
     WHERE id = ? AND user_id = ? RETURNING id`,
  )
    .bind(categoryId ?? null, amount ?? null, title ?? null, description ?? null, spentOn ?? null, rawAccount, rawMethod, id, uid)
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
  const month = c.req.query('month') || new Date().toISOString().slice(0, 7);
  const [start, end] = monthRange(month);
  const uid = c.get('userId');

  const [cats, inc] = await c.env.DB.batch<Record<string, number | string>>([
    c.env.DB.prepare(
      `SELECT c.id, c.name, c.budget_cents, c.note, c.sort_order, COALESCE(c.is_fixed, 1) AS is_fixed,
              COALESCE(SUM(e.amount_cents), 0) AS spent_cents, COUNT(e.id) AS count
       FROM categories c
       LEFT JOIN expenses e ON e.category_id = c.id AND e.spent_on >= ? AND e.spent_on < ?
       WHERE c.user_id = ?
       GROUP BY c.id ORDER BY c.is_fixed DESC, c.sort_order, c.id`,
    ).bind(start, end, uid),
    c.env.DB.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM incomes WHERE user_id = ?').bind(uid),
  ]);

  const categories = cats.results as unknown as { id: number; name: string; budget_cents: number; note: string; sort_order: number; is_fixed: number; spent_cents: number; count: number }[];

  // 1. Balances definidos pelo usuário (prioriza o mês atual, fallback para o mais recente)
  const { results: balanceRows } = await c.env.DB.prepare(
    `SELECT account_id, month, initial_cents, updated_at
     FROM account_balances
     WHERE user_id = ?
     ORDER BY updated_at DESC`,
  ).bind(uid).all<{ account_id: string; month: string; initial_cents: number; updated_at: string }>();

  const balancesMap: Record<string, { initial_cents: number; updated_at: string }> = {};
  for (const b of balanceRows) {
    if (!balancesMap[b.account_id]) {
      balancesMap[b.account_id] = { initial_cents: b.initial_cents, updated_at: b.updated_at };
    } else if (b.month === month) {
      balancesMap[b.account_id] = { initial_cents: b.initial_cents, updated_at: b.updated_at };
    }
  }

  // 2. Gastos que foram criados APENAS APÓS a data/hora em que o saldo daquela conta foi definido
  // (gastos passados já existentes na conta não são abatidos)
  const spentMap: Record<string, number> = {};
  for (const accId of VALID_ACCOUNTS) {
    const b = balancesMap[accId];
    if (b && b.initial_cents > 0 && b.updated_at) {
      const row = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM expenses
         WHERE user_id = ?
           AND COALESCE(account_id, 'nubank') = ?
           AND created_at >= ?`,
      )
        .bind(uid, accId, b.updated_at)
        .first<{ total: number }>();
      spentMap[accId] = row?.total ?? 0;
    } else {
      spentMap[accId] = 0;
    }
  }

  const accounts = VALID_ACCOUNTS.map((accId) => {
    const initial_cents = balancesMap[accId]?.initial_cents ?? 0;
    const spent_cents = spentMap[accId] ?? 0;
    return {
      account_id: accId,
      name: ACCOUNT_NAMES[accId],
      initial_cents,
      spent_cents,
      current_cents: initial_cents - spent_cents,
    };
  });

  const totalIncomeCents = Number(inc.results[0]?.total ?? 0);
  const fixedCats = categories.filter((c) => c.is_fixed === 1);
  const variableCats = categories.filter((c) => c.is_fixed === 0);

  const fixedBudgetCents = fixedCats.reduce((s, x) => s + x.budget_cents, 0);
  const fixedSpentCents = fixedCats.reduce((s, x) => s + x.spent_cents, 0);
  const variableSpentCents = variableCats.reduce((s, x) => s + x.spent_cents, 0);

  const porForaBudgetCents = totalIncomeCents - fixedBudgetCents;
  const porForaSpentCents = variableSpentCents;
  const porForaRemainingCents = porForaBudgetCents - porForaSpentCents;

  return c.json({
    month,
    total_income_cents: totalIncomeCents,
    total_budget_cents: fixedBudgetCents,
    total_spent_cents: fixedSpentCents + variableSpentCents,
    fixed_budget_cents: fixedBudgetCents,
    fixed_spent_cents: fixedSpentCents,
    variable_spent_cents: variableSpentCents,
    por_fora_budget_cents: porForaBudgetCents,
    por_fora_spent_cents: porForaSpentCents,
    por_fora_remaining_cents: porForaRemainingCents,
    categories,
    accounts,
  });
});

// ---------- saldos das contas (abertos para edição) ----------
app.put('/accounts/balance', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const month = str(data.month, 'mês')!;
  if (!/^\d{4}-\d{2}$/.test(month)) bad('Mês inválido');
  const accountId = str(data.account_id, 'conta')!;
  if (!(VALID_ACCOUNTS as readonly string[]).includes(accountId)) bad('Conta inválida');
  const initialCents = cents(data.initial_cents, 'saldo em conta')!;

  await c.env.DB.prepare(
    `INSERT INTO account_balances (user_id, month, account_id, initial_cents, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, month, account_id)
     DO UPDATE SET initial_cents = excluded.initial_cents, updated_at = datetime('now')`,
  )
    .bind(uid, month, accountId, initialCents)
    .run();

  return c.json({ ok: true, account_id: accountId, month, initial_cents: initialCents });
});

// ---------- investimentos ----------
app.get('/investments', async (c) => {
  const uid = c.get('userId');

  // Buscar contas
  const { results: accounts } = await c.env.DB.prepare(
    'SELECT id, name, color, sort_order FROM investment_accounts WHERE user_id = ? ORDER BY sort_order, id',
  )
    .bind(uid)
    .all<{ id: number; name: string; color: string; sort_order: number }>();

  // Buscar todos os snapshots
  const { results: snapshots } = await c.env.DB.prepare(
    'SELECT account_id, month, balance_cents, delta_cents FROM investment_snapshots WHERE user_id = ? ORDER BY month ASC',
  )
    .bind(uid)
    .all<{ account_id: number; month: string; balance_cents: number; delta_cents: number }>();

  return c.json({
    accounts,
    snapshots,
  });
});

app.post('/investments/snapshot', async (c) => {
  const data = await body(c);
  const uid = c.get('userId');
  const accountId = idParam(String(data.account_id));
  const month = str(data.month, 'mês')!;
  if (!/^\d{4}-\d{2}$/.test(month)) bad('Formato de mês inválido (use YYYY-MM)');

  const balance = cents(data.balance_cents, 'saldo')!;
  const delta = typeof data.delta_cents === 'number' && Number.isInteger(data.delta_cents)
    ? data.delta_cents
    : 0;

  await c.env.DB.prepare(
    `INSERT INTO investment_snapshots (user_id, account_id, month, balance_cents, delta_cents)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, account_id, month) DO UPDATE SET
       balance_cents = excluded.balance_cents,
       delta_cents = excluded.delta_cents`,
  )
    .bind(uid, accountId, month, balance, delta)
    .run();

  return c.json({ ok: true });
});

app.post('/investments/accounts', async (c) => {
  const data = await body(c);
  const uid = c.get('userId');
  const name = str(data.name, 'nome')!.toUpperCase();
  const color = str(data.color ?? '#10b981', 'cor', { required: false, max: 20 }) ?? '#10b981';

  const row = await guardUnique(() =>
    c.env.DB.prepare(
      `INSERT INTO investment_accounts (user_id, name, color, sort_order)
       VALUES (?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM investment_accounts WHERE user_id = ?))
       RETURNING id, name, color, sort_order`,
    )
      .bind(uid, name, color, uid)
      .first(),
  );

  return c.json(row, 201);
});

// ---------- export (todos os dados do usuário) ----------
app.get('/export', async (c) => {
  const uid = c.get('userId');
  const db = c.env.DB;
  const [incomes, categories, expenses, accounts, snapshots] = await db.batch([
    db.prepare('SELECT name, amount_cents FROM incomes WHERE user_id = ? ORDER BY sort_order, id').bind(uid),
    db.prepare('SELECT name, budget_cents, note FROM categories WHERE user_id = ? ORDER BY sort_order, id').bind(uid),
    db.prepare(
      `SELECT e.spent_on, e.title, e.description, c.name AS category, e.amount_cents, e.payment_method,
              COALESCE(e.account_id, 'nubank') AS account_id,
              e.installment_current, e.installment_total
       FROM expenses e JOIN categories c ON c.id = e.category_id
       WHERE e.user_id = ? ORDER BY e.spent_on, e.id`,
    ).bind(uid),
    db.prepare('SELECT id, name FROM investment_accounts WHERE user_id = ? ORDER BY sort_order, id').bind(uid),
    db.prepare(
      'SELECT account_id, month, balance_cents, delta_cents FROM investment_snapshots WHERE user_id = ? ORDER BY month',
    ).bind(uid),
  ]);
  return c.json({
    generated_at: new Date().toISOString(),
    user: c.get('username'),
    incomes: incomes.results,
    categories: categories.results,
    expenses: expenses.results,
    investment_accounts: accounts.results,
    investment_snapshots: snapshots.results,
  });
});

// ---------- cartão de crédito & faturas ----------
app.get('/credit-card/invoice', async (c) => {
  const uid = c.get('userId');
  const monthParam = c.req.query('month');
  const [start, end] = monthRange(monthParam);
  const month = monthParam!;

  const { results: expenses } = await c.env.DB.prepare(
    `${EXPENSE_SELECT} WHERE e.user_id = ? AND e.payment_method = 'credit' AND e.spent_on >= ? AND e.spent_on < ?
     ORDER BY e.spent_on DESC, e.id DESC`,
  )
    .bind(uid, start, end)
    .all();

  const totalCents = expenses.reduce((s, x) => s + Number(x.amount_cents || 0), 0);

  const invoice = await c.env.DB.prepare(
    `SELECT is_paid, paid_at, paid_amount_cents FROM credit_card_invoices WHERE user_id = ? AND month = ?`,
  )
    .bind(uid, month)
    .first<{ is_paid: number; paid_at: string | null; paid_amount_cents: number }>();

  const nubankRow = await c.env.DB.prepare(
    `SELECT initial_cents FROM account_balances WHERE user_id = ? AND account_id = 'nubank' ORDER BY updated_at DESC LIMIT 1`,
  )
    .bind(uid)
    .first<{ initial_cents: number }>();

  return c.json({
    month,
    total_cents: totalCents,
    count: expenses.length,
    is_paid: Boolean(invoice?.is_paid),
    paid_at: invoice?.paid_at ?? null,
    paid_amount_cents: invoice?.paid_amount_cents ?? 0,
    nubank_balance_cents: nubankRow?.initial_cents ?? 0,
    expenses,
  });
});

app.post('/credit-card/pay', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const month = str(data.month, 'mês')!;
  const [start, end] = monthRange(month);

  const existing = await c.env.DB.prepare(
    `SELECT is_paid FROM credit_card_invoices WHERE user_id = ? AND month = ?`,
  )
    .bind(uid, month)
    .first<{ is_paid: number }>();

  if (existing?.is_paid) bad('Esta fatura já está marcada como paga');

  const totalRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses
     WHERE user_id = ? AND payment_method = 'credit' AND spent_on >= ? AND spent_on < ?`,
  )
    .bind(uid, start, end)
    .first<{ total: number }>();

  const totalCents = totalRow?.total ?? 0;
  if (totalCents <= 0) bad('Não há despesas no cartão nesta fatura para pagar');

  // Abater do saldo da conta Nubank
  const nubankBalance = await c.env.DB.prepare(
    `SELECT id, month, initial_cents FROM account_balances
     WHERE user_id = ? AND account_id = 'nubank'
     ORDER BY (month = ?) DESC, updated_at DESC LIMIT 1`,
  )
    .bind(uid, month)
    .first<{ id: number; month: string; initial_cents: number }>();

  if (nubankBalance) {
    const newBalance = Math.max(0, nubankBalance.initial_cents - totalCents);
    await c.env.DB.prepare(
      `UPDATE account_balances SET initial_cents = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(newBalance, nubankBalance.id)
      .run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO account_balances (user_id, month, account_id, initial_cents, updated_at)
       VALUES (?, ?, 'nubank', 0, datetime('now'))`,
    )
      .bind(uid, month)
      .run();
  }

  await c.env.DB.prepare(
    `INSERT INTO credit_card_invoices (user_id, month, is_paid, paid_at, paid_amount_cents)
     VALUES (?, ?, 1, datetime('now'), ?)
     ON CONFLICT(user_id, month)
     DO UPDATE SET is_paid = 1, paid_at = datetime('now'), paid_amount_cents = excluded.paid_amount_cents`,
  )
    .bind(uid, month, totalCents)
    .run();

  return c.json({ ok: true, month, paid_amount_cents: totalCents });
});

app.post('/credit-card/reopen', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const month = str(data.month, 'mês')!;

  const existing = await c.env.DB.prepare(
    `SELECT is_paid, paid_amount_cents FROM credit_card_invoices WHERE user_id = ? AND month = ?`,
  )
    .bind(uid, month)
    .first<{ is_paid: number; paid_amount_cents: number }>();

  if (!existing || !existing.is_paid) bad('Esta fatura não está paga');

  // Restaurar o valor abatido no saldo da Nubank
  const nubankBalance = await c.env.DB.prepare(
    `SELECT id, initial_cents FROM account_balances
     WHERE user_id = ? AND account_id = 'nubank'
     ORDER BY (month = ?) DESC, updated_at DESC LIMIT 1`,
  )
    .bind(uid, month)
    .first<{ id: number; initial_cents: number }>();

  if (nubankBalance) {
    const restored = nubankBalance.initial_cents + (existing.paid_amount_cents || 0);
    await c.env.DB.prepare(
      `UPDATE account_balances SET initial_cents = ?, updated_at = datetime('now') WHERE id = ?`,
    )
      .bind(restored, nubankBalance.id)
      .run();
  }

  await c.env.DB.prepare(
    `UPDATE credit_card_invoices SET is_paid = 0, paid_at = NULL, paid_amount_cents = 0 WHERE user_id = ? AND month = ?`,
  )
    .bind(uid, month)
    .run();

  return c.json({ ok: true, month });
});

export default app;
