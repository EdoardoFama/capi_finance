import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import {
  randomToken,
  sha256,
  verifyPassword,
  hashPassword,
  DUMMY_PASSWORD_HASH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  hashOtpCode,
  verifyOtpCode,
  encryptPayload,
  decryptPayload,
} from './auth';
import { sendEmail, escapeHtml } from './mailer';
import {
  getClientIp,
  getUserAgent,
  checkInMemoryBurst,
  checkRateLimit,
  resetRateLimit,
  logSecurityEvent,
  applySecurityHeaders,
  verifyCsrfAndOrigin,
} from './security';
import { parseNubankNotification, cleanEstablishmentName } from './nubank-parser';

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SMTP_USER?: string;
  SMTP_PASS?: string;
  ENCRYPTION_SECRET?: string;
};
type Vars = { userId: number; username: string; sessionId: string; isAdmin: boolean };
type AppEnv = { Bindings: Env; Variables: Vars };

const SESSION_COOKIE = 'capi_session';
const SESSION_DAYS = 14; // Expiração segura de 14 dias
const MAX_PAYLOAD_BYTES = 32_768; // 32 KB máximo por requisição JSON (proteção contra DoS)
const MAX_OTP_ATTEMPTS = 5;       // Máximo de 5 tentativas antes de destruir o código OTP

const app = new Hono<AppEnv>().basePath('/api');

function getEncryptionSecret(env: Env): string {
  return env.ENCRYPTION_SECRET || env.SMTP_PASS || 'capi_finance_aes256_internal_key_v1';
}

// ---------- helpers ----------
function bad(message: string, status: 400 | 401 | 403 | 404 | 409 | 413 | 429 = 400): never {
  throw new HTTPException(status, { message });
}

async function body(c: { req: { text: () => Promise<string> } }) {
  const raw = await c.req.text().catch(() => '');
  if (!raw) bad('Corpo da requisição vazio');
  if (raw.length > MAX_PAYLOAD_BYTES) bad('Payload excede o limite permitido (32 KB)', 413);
  let data: unknown = null;
  try {
    data = JSON.parse(raw);
  } catch {
    bad('JSON inválido');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) bad('JSON inválido');
  return data as Record<string, unknown>;
}

const str = (v: unknown, field: string, { required = true, max = 120 } = {}) => {
  if (v === undefined && !required) return undefined;
  if (typeof v !== 'string') return bad(`Campo "${field}" inválido`);
  // Remove caracteres de controle ASCII (prevenção de injeção de caracteres nulos/controle)
  const s = v.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
  if (required && !s) bad(`Campo "${field}" é obrigatório`);
  if (s.length > max) bad(`Campo "${field}" muito longo (máx ${max} caracteres)`);
  return s;
};

const validHexColor = (v: unknown, fallback = '#10b981'): string => {
  if (typeof v !== 'string') return fallback;
  const trimmed = v.trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ? trimmed : fallback;
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
  applySecurityHeaders(c);
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error('[Internal Error]', err);
  return c.json({ error: 'Erro interno no servidor' }, 500);
});
app.notFound((c) => {
  applySecurityHeaders(c);
  return c.json({ error: 'Rota não encontrada' }, 404);
});

// ============================================================================
// MIDDLEWARE GLOBAL DE SEGURANÇA (Headers, Anti-DDoS Burst, Payload Size, CSRF)
// ============================================================================
app.use('*', async (c, next) => {
  applySecurityHeaders(c);

  const ip = getClientIp(c);
  const isAuthRoute = c.req.path.startsWith('/api/auth/');

  // 1. Proteção Anti-Flood / DDoS em memória (rejeita rajadas antes de tocar no banco)
  checkInMemoryBurst(ip, isAuthRoute);

  // 2. Validação do tamanho do payload pelo Content-Length
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > MAX_PAYLOAD_BYTES) {
    bad('Payload excede o limite de segurança permitido (32 KB)', 413);
  }

  // 3. Proteção CSRF e verificação estrita de Origin / Referer
  verifyCsrfAndOrigin(c);

  await next();
});

// ---------- auth ----------
function generateOTP(): string {
  const arr = crypto.getRandomValues(new Uint32Array(1));
  return String(100000 + (arr[0] % 900000));
}

function validatePasswordStrength(password: string, fieldLabel = 'A senha') {
  if (password.length < MIN_PASSWORD_LENGTH) {
    bad(`${fieldLabel} deve ter no mínimo ${MIN_PASSWORD_LENGTH} caracteres`);
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    bad(`${fieldLabel} não pode exceder ${MAX_PASSWORD_LENGTH} caracteres`);
  }
}

// 1. Iniciar Cadastro: gera OTP e envia por e-mail
app.post('/auth/signup/request', async (c) => {
  const ip = getClientIp(c);
  const data = await body(c);
  const rawUsername = str(data.username, 'nome') || '';
  const username = rawUsername.trim().replace(/\s+/g, ' ');
  const email = (str(data.email, 'e-mail') || '').trim().toLowerCase();
  const password = typeof data.password === 'string' ? data.password : '';

  if (!username) {
    bad('Informe seu nome');
  }
  if (/\d/.test(username)) {
    bad('O nome não pode conter números');
  }
  if (!/^[A-Za-zÀ-ÖØ-öø-ÿ\s]{2,60}$/.test(username)) {
    bad('O nome deve conter apenas letras e espaços (sem números, hífens ou símbolos)');
  }
  if (!email.includes('@') || !/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(email)) {
    bad('E-mail inválido. Informe um e-mail real com @ e domínio válido (ex: gmail.com, hotmail.com, outlook.com)');
  }
  validatePasswordStrength(password, 'A senha');

  // Rate limiting: máximo 6 solicitações de cadastro por IP a cada 15 min, e máx 3 por e-mail
  await checkRateLimit(c.env.DB, {
    key: `signup_req_ip:${ip}`,
    maxPoints: 6,
    windowMs: 15 * 60_000,
    blockDurationMs: 15 * 60_000,
    errorMessage: 'Muitas solicitações de cadastro deste IP. Aguarde 15 minutos.',
  });
  await checkRateLimit(c.env.DB, {
    key: `signup_req_email:${email}`,
    maxPoints: 3,
    windowMs: 15 * 60_000,
    blockDurationMs: 15 * 60_000,
    errorMessage: 'Muitos códigos solicitados para este e-mail. Aguarde alguns minutos.',
  });

  // Verifica se username ou email já existem
  const existing = await c.env.DB.prepare(
    'SELECT username, email FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)',
  )
    .bind(username, email)
    .first<{ username: string; email: string }>();

  if (existing) {
    if (existing.username.toLowerCase() === username.toLowerCase()) bad('Nome de usuário já cadastrado', 409);
    if (existing.email && existing.email.toLowerCase() === email.toLowerCase()) bad('E-mail já cadastrado', 409);
  }

  const code = generateOTP();
  const codeHash = await hashOtpCode(email, 'signup', code);
  const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutos
  const passwordHash = await hashPassword(password);
  const rawPayload = JSON.stringify({ username, password_hash: passwordHash });
  const encryptedPayload = await encryptPayload(rawPayload, getEncryptionSecret(c.env));

  // Salva no banco (código com hash SHA-256 e payload criptografado com AES-256-GCM)
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ? AND type = "signup"').bind(email),
    c.env.DB.prepare(
      'INSERT INTO verification_codes (email, code, type, payload, expires_at, attempts) VALUES (?, ?, "signup", ?, ?, 0)',
    ).bind(email, codeHash, encryptedPayload, expiresAt),
  ]);

  await logSecurityEvent(c.env.DB, c, 'SIGNUP_OTP_SENT', `Solicitação de cadastro para ${email} (${username})`);

  // Enviar e-mail
  if (c.env.SMTP_USER && c.env.SMTP_PASS) {
    try {
      const safeName = escapeHtml(username);
      await sendEmail({
        to: email,
        subject: `Seu código de confirmação: ${code}`,
        smtpUser: c.env.SMTP_USER,
        smtpPass: c.env.SMTP_PASS,
        html: `
          <div style="font-family: sans-serif; background-color: #000; color: #fff; padding: 30px; border-radius: 12px; max-width: 480px; margin: auto;">
            <h2 style="color: #34d399; margin-top: 0;">Bem-vindo ao Capi Finance, ${safeName}!</h2>
            <p>Seu código de verificação para ativar sua conta é:</p>
            <div style="background-color: #18181b; padding: 16px; border-radius: 8px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #34d399; margin: 24px 0;">
              ${code}
            </div>
            <p style="color: #a1a1aa; font-size: 13px;">O código é válido por 15 minutos e possui proteção contra tentativas inválidas. Se você não solicitou este cadastro, desconsidere esta mensagem.</p>
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
  const ip = getClientIp(c);
  const data = await body(c);
  const email = str(data.email, 'e-mail')!.toLowerCase();
  const code = str(data.code, 'código', { max: 20 })!.trim();

  await checkRateLimit(c.env.DB, {
    key: `signup_confirm_ip:${ip}`,
    maxPoints: 10,
    windowMs: 15 * 60_000,
    blockDurationMs: 15 * 60_000,
  });

  const record = await c.env.DB.prepare(
    'SELECT id, code, payload, COALESCE(attempts, 0) AS attempts FROM verification_codes WHERE email = ? AND type = "signup" AND expires_at > ?',
  )
    .bind(email, Date.now())
    .first<{ id: number; code: string; payload: string; attempts: number }>();

  if (!record) {
    bad('Código inválido ou expirado', 400);
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await c.env.DB.prepare('DELETE FROM verification_codes WHERE id = ?').bind(record.id).run();
    await logSecurityEvent(c.env.DB, c, 'OTP_DESTROYED_BRUTEFORCE', `Código de signup destruído após ${MAX_OTP_ATTEMPTS} falhas (${email})`);
    bad('Código invalidado por excesso de tentativas incorretas. Solicite um novo código.', 400);
  }

  const isCodeValid = await verifyOtpCode(email, 'signup', code, record.code);
  if (!isCodeValid) {
    const nextAttempts = record.attempts + 1;
    if (nextAttempts >= MAX_OTP_ATTEMPTS) {
      await c.env.DB.prepare('DELETE FROM verification_codes WHERE id = ?').bind(record.id).run();
      await logSecurityEvent(c.env.DB, c, 'OTP_DESTROYED_BRUTEFORCE', `Código de signup destruído após ${MAX_OTP_ATTEMPTS} falhas (${email})`);
      bad('Código invalidado por excesso de tentativas incorretas. Solicite um novo código.', 400);
    } else {
      await c.env.DB.prepare('UPDATE verification_codes SET attempts = ? WHERE id = ?')
        .bind(nextAttempts, record.id)
        .run();
      await logSecurityEvent(c.env.DB, c, 'OTP_FAILED', `Tentativa incorreta ${nextAttempts}/${MAX_OTP_ATTEMPTS} no signup (${email})`);
      bad(`Código incorreto (${MAX_OTP_ATTEMPTS - nextAttempts} tentativa(s) restante(s))`, 400);
    }
  }

  const decryptedJson = await decryptPayload(record.payload, getEncryptionSecret(c.env));
  const { username, password_hash } = JSON.parse(decryptedJson) as { username: string; password_hash: string };

  // Insere o novo usuário ativo
  const { id: newUserId } = (await guardUnique(() =>
    c.env.DB.prepare(
      'INSERT INTO users (username, email, password_hash, is_active, is_admin) VALUES (?, ?, ?, 1, 0) RETURNING id',
    )
      .bind(username, email, password_hash)
      .first<{ id: number }>(),
  ))!;

  // Cria conta padrão inicial para o novo usuário e remove o código usado
  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86_400_000;
  const ua = getUserAgent(c);

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ?').bind(email),
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO user_accounts (user_id, slug, name, color, sort_order)
       VALUES (?, 'nubank', 'NUBANK', '#820ad1', 1)`,
    ).bind(newUserId),
    c.env.DB.prepare(
      `INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(await sha256(token), newUserId, expires, ip, ua),
  ]);

  await logSecurityEvent(c.env.DB, c, 'SIGNUP_SUCCESS', `Conta criada com sucesso: ${username} (${email})`, newUserId);

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
  const ip = getClientIp(c);
  const data = await body(c);
  const email = str(data.email, 'e-mail')!.toLowerCase();

  await checkRateLimit(c.env.DB, {
    key: `pwd_req_ip:${ip}`,
    maxPoints: 5,
    windowMs: 15 * 60_000,
    blockDurationMs: 15 * 60_000,
    errorMessage: 'Muitas solicitações de recuperação de senha. Aguarde 15 minutos.',
  });
  await checkRateLimit(c.env.DB, {
    key: `pwd_req_email:${email}`,
    maxPoints: 3,
    windowMs: 15 * 60_000,
    blockDurationMs: 15 * 60_000,
    errorMessage: 'Muitos códigos de recuperação solicitados para este e-mail. Aguarde alguns minutos.',
  });

  const user = await c.env.DB.prepare('SELECT id, username FROM users WHERE lower(email) = lower(?) AND is_active = 1')
    .bind(email)
    .first<{ id: number; username: string }>();

  const uniformMessage = 'Se o e-mail estiver cadastrado e ativo, enviamos o código de recuperação.';

  if (!user) {
    // Executa derivação dummy para mitigar enumeração por tempo de resposta
    await verifyPassword('dummy_timing_shield', DUMMY_PASSWORD_HASH);
    await logSecurityEvent(c.env.DB, c, 'PASSWORD_RESET_UNKNOWN_EMAIL', `Solicitação de reset para e-mail não encontrado: ${email}`);
    return c.json({ ok: true, message: uniformMessage });
  }

  const code = generateOTP();
  const codeHash = await hashOtpCode(email, 'reset_password', code);
  const expiresAt = Date.now() + 15 * 60 * 1000;
  const encryptedPayload = await encryptPayload(String(user.id), getEncryptionSecret(c.env));

  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ? AND type = "reset_password"').bind(email),
    c.env.DB.prepare(
      'INSERT INTO verification_codes (email, code, type, payload, expires_at, attempts) VALUES (?, ?, "reset_password", ?, ?, 0)',
    ).bind(email, codeHash, encryptedPayload, expiresAt),
  ]);

  await logSecurityEvent(c.env.DB, c, 'PASSWORD_RESET_OTP_SENT', `Código de recuperação enviado para ${email}`, user.id);

  if (c.env.SMTP_USER && c.env.SMTP_PASS) {
    try {
      const safeName = escapeHtml(user.username);
      await sendEmail({
        to: email,
        subject: `Recuperação de Senha - Capi Finance: ${code}`,
        smtpUser: c.env.SMTP_USER,
        smtpPass: c.env.SMTP_PASS,
        html: `
          <div style="font-family: sans-serif; background-color: #000; color: #fff; padding: 30px; border-radius: 12px; max-width: 480px; margin: auto;">
            <h2 style="color: #34d399; margin-top: 0;">Recuperação de Senha</h2>
            <p>Olá, <b>${safeName}</b>. Você solicitou a redefinição da sua senha.</p>
            <p>Use o código abaixo para cadastrar uma nova senha:</p>
            <div style="background-color: #18181b; padding: 16px; border-radius: 8px; text-align: center; font-size: 32px; font-weight: bold; letter-spacing: 6px; color: #34d399; margin: 24px 0;">
              ${code}
            </div>
            <p style="color: #a1a1aa; font-size: 13px;">O código é válido por 15 minutos e expira automaticamente se houver tentativas incorretas. Se não foi você, ignore.</p>
          </div>
        `,
      });
    } catch (err) {
      console.error('Falha ao enviar e-mail de reset:', err);
    }
  }

  return c.json({ ok: true, message: uniformMessage });
});

// 4. Redefinir Senha com o código
app.post('/auth/password/reset', async (c) => {
  const ip = getClientIp(c);
  const data = await body(c);
  const email = str(data.email, 'e-mail')!.toLowerCase();
  const code = str(data.code, 'código', { max: 20 })!.trim();
  const newPassword = typeof data.new_password === 'string' ? data.new_password : '';

  validatePasswordStrength(newPassword, 'A nova senha');

  await checkRateLimit(c.env.DB, {
    key: `pwd_reset_ip:${ip}`,
    maxPoints: 10,
    windowMs: 15 * 60_000,
    blockDurationMs: 15 * 60_000,
  });

  const record = await c.env.DB.prepare(
    'SELECT id, code, payload, COALESCE(attempts, 0) AS attempts FROM verification_codes WHERE email = ? AND type = "reset_password" AND expires_at > ?',
  )
    .bind(email, Date.now())
    .first<{ id: number; code: string; payload: string; attempts: number }>();

  if (!record) {
    bad('Código de recuperação inválido ou expirado', 400);
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await c.env.DB.prepare('DELETE FROM verification_codes WHERE id = ?').bind(record.id).run();
    await logSecurityEvent(c.env.DB, c, 'OTP_DESTROYED_BRUTEFORCE', `Código de reset destruído após ${MAX_OTP_ATTEMPTS} falhas (${email})`);
    bad('Código invalidado por excesso de tentativas incorretas. Solicite um novo código.', 400);
  }

  const isCodeValid = await verifyOtpCode(email, 'reset_password', code, record.code);
  if (!isCodeValid) {
    const nextAttempts = record.attempts + 1;
    if (nextAttempts >= MAX_OTP_ATTEMPTS) {
      await c.env.DB.prepare('DELETE FROM verification_codes WHERE id = ?').bind(record.id).run();
      await logSecurityEvent(c.env.DB, c, 'OTP_DESTROYED_BRUTEFORCE', `Código de reset destruído após ${MAX_OTP_ATTEMPTS} falhas (${email})`);
      bad('Código invalidado por excesso de tentativas incorretas. Solicite um novo código.', 400);
    } else {
      await c.env.DB.prepare('UPDATE verification_codes SET attempts = ? WHERE id = ?')
        .bind(nextAttempts, record.id)
        .run();
      await logSecurityEvent(c.env.DB, c, 'OTP_FAILED', `Tentativa incorreta ${nextAttempts}/${MAX_OTP_ATTEMPTS} no reset (${email})`);
      bad(`Código incorreto (${MAX_OTP_ATTEMPTS - nextAttempts} tentativa(s) restante(s))`, 400);
    }
  }

  const decryptedUserId = await decryptPayload(record.payload, getEncryptionSecret(c.env));
  const userId = Number(decryptedUserId);
  if (!Number.isInteger(userId) || userId <= 0) {
    bad('Dados de recuperação inválidos', 400);
  }

  const newHash = await hashPassword(newPassword);

  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, userId),
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId), // desconecta todas as sessões ativas
    c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ?').bind(email),
  ]);

  await resetRateLimit(c.env.DB, `login_acct:${email}`);
  await logSecurityEvent(c.env.DB, c, 'PASSWORD_RESET_SUCCESS', `Senha redefinida via OTP (${email})`, userId);

  return c.json({ ok: true, message: 'Senha atualizada com sucesso! Faça login.' });
});

// 5. Login com proteção Anti-Brute-Force e Anti-Timing Attack
app.post('/auth/login', async (c) => {
  const ip = getClientIp(c);
  const ua = getUserAgent(c);
  const data = await body(c);
  const loginInput = str(data.username, 'usuário ou e-mail')!.toLowerCase();
  const password = typeof data.password === 'string' ? data.password : '';

  // 1. Verifica bloqueio por IP (máx 12 tentativas em 15 min) e por Conta (máx 5 falhas em 15 min)
  await checkRateLimit(c.env.DB, {
    key: `login_ip:${ip}`,
    maxPoints: 12,
    windowMs: 15 * 60_000,
    blockDurationMs: 15 * 60_000,
    errorMessage: 'Muitas tentativas de login a partir deste IP. Aguarde 15 minutos.',
  });
  await checkRateLimit(c.env.DB, {
    key: `login_acct:${loginInput}`,
    maxPoints: 5,
    windowMs: 15 * 60_000,
    blockDurationMs: 15 * 60_000,
    errorMessage: 'Conta temporariamente protegida após 5 tentativas de senha incorretas. Aguarde 15 minutos ou redefina sua senha.',
  });

  const user = await c.env.DB.prepare(
    'SELECT id, username, email, password_hash, is_active, is_admin FROM users WHERE lower(username) = lower(?) OR lower(email) = lower(?)',
  )
    .bind(loginInput, loginInput)
    .first<{ id: number; username: string; email: string; password_hash: string; is_active: number; is_admin: number }>();

  // Sempre executa o PBKDF2 mesmo que o usuário não exista (evita enumeração por Timing Side-Channel)
  const targetHash = user ? user.password_hash : DUMMY_PASSWORD_HASH;
  const passwordOk = await verifyPassword(password, targetHash);

  if (!user || !passwordOk) {
    await logSecurityEvent(c.env.DB, c, 'LOGIN_FAILED', `Credenciais inválidas para "${loginInput}"`, user?.id ?? null);
    return c.json({ error: 'Usuário ou senha inválidos' }, 401);
  }

  if (user.is_active === 0) {
    await logSecurityEvent(c.env.DB, c, 'LOGIN_BLOCKED_USER', `Tentativa de login em conta bloqueada: ${user.username}`, user.id);
    return c.json({ error: 'Sua conta está bloqueada pelo administrador.' }, 403);
  }

  // Login bem-sucedido: limpa contador de falhas desta conta
  await resetRateLimit(c.env.DB, `login_acct:${loginInput}`);
  if (user.email) await resetRateLimit(c.env.DB, `login_acct:${user.email.toLowerCase()}`);
  await resetRateLimit(c.env.DB, `login_acct:${user.username.toLowerCase()}`);

  const token = randomToken();
  const sessionHash = await sha256(token);
  const expires = Date.now() + SESSION_DAYS * 86_400_000;

  await c.env.DB.batch([
    // Remove sessões expiradas e limita a no máximo 10 sessões simultâneas por usuário
    c.env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    c.env.DB.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND id NOT IN (
         SELECT id FROM sessions WHERE user_id = ? ORDER BY expires_at DESC LIMIT 9
       )`,
    ).bind(user.id, user.id),
    c.env.DB.prepare(
      `INSERT INTO sessions (id, user_id, expires_at, ip_address, user_agent, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    ).bind(sessionHash, user.id, expires, ip, ua),
  ]);

  await logSecurityEvent(c.env.DB, c, 'LOGIN_SUCCESS', `Login efetuado com sucesso (${user.username})`, user.id);

  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  });
  return c.json({ id: user.id, username: user.username, email: user.email, is_admin: user.is_admin === 1 });
});

// Middleware de autenticação para todas as rotas privadas
app.use('*', async (c, next) => {
  if (
    c.req.path === '/api/auth/login' ||
    c.req.path === '/api/auth/signup/request' ||
    c.req.path === '/api/auth/signup/confirm' ||
    c.req.path === '/api/auth/password/request' ||
    c.req.path === '/api/auth/password/reset' ||
    c.req.path.startsWith('/api/integrations/')
  ) {
    return next();
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length < 20 || token.length > 128) {
    return c.json({ error: 'Não autenticado' }, 401);
  }
  const sessionId = await sha256(token);
  const row = await c.env.DB.prepare(
    `SELECT u.id, u.username, u.is_active, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.expires_at > ?`,
  )
    .bind(sessionId, Date.now())
    .first<{ id: number; username: string; is_active: number; is_admin: number }>();

  if (!row || row.is_active === 0) {
    deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
    return c.json({ error: 'Sessão inválida ou conta bloqueada' }, 401);
  }

  // Rate limit de escrita por usuário autenticado (evita abuso/automação de mutações)
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    await checkRateLimit(c.env.DB, {
      key: `user_write:${row.id}`,
      maxPoints: 90,
      windowMs: 60_000,
      blockDurationMs: 60_000,
      errorMessage: 'Você enviou muitas alterações em menos de 1 minuto. Aguarde alguns instantes.',
    });
  }

  c.set('userId', row.id);
  c.set('username', row.username);
  c.set('sessionId', sessionId);
  c.set('isAdmin', row.is_admin === 1);
  await next();
});

app.get('/auth/me', async (c) => {
  const uid = c.get('userId');
  const user = await c.env.DB.prepare(
    "SELECT id, username, email, is_admin, COALESCE(pin_code, '1201') AS pin_code FROM users WHERE id = ?",
  )
    .bind(uid)
    .first<{ id: number; username: string; email: string; is_admin: number; pin_code: string }>();

  const failedLogins = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count, MAX(created_at) AS last_at, MAX(ip_address) AS last_ip
     FROM security_audit_logs
     WHERE user_id = ? AND event_type = 'LOGIN_FAILED' AND created_at > datetime('now', '-24 hours')`,
  )
    .bind(uid)
    .first<{ count: number; last_at: string | null; last_ip: string | null }>();

  return c.json({
    id: user?.id,
    username: user?.username,
    email: user?.email,
    is_admin: user?.is_admin === 1,
    pin_code: user?.pin_code || '1201',
    recent_failed_logins: failedLogins?.count ?? 0,
    last_failed_login_at: failedLogins?.last_at ?? null,
    last_failed_login_ip: failedLogins?.last_ip ?? null,
  });
});

app.post('/user/pin', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const pin = str(data.pin_code, 'PIN', { max: 8 })!;
  if (!/^\d{4,8}$/.test(pin)) bad('O PIN deve conter de 4 a 8 dígitos numéricos');
  await c.env.DB.prepare('UPDATE users SET pin_code = ? WHERE id = ?').bind(pin, uid).run();
  return c.json({ ok: true, pin_code: pin });
});

app.post('/auth/logout', async (c) => {
  await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?')
    .bind(c.get('sessionId'), c.get('userId'))
    .run();
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  return c.json({ ok: true });
});

// Desconectar todas as sessões ativas do usuário (em todos os aparelhos)
app.post('/auth/logout-all', async (c) => {
  const uid = c.get('userId');
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(uid).run();
  await logSecurityEvent(c.env.DB, c, 'LOGOUT_ALL_SESSIONS', 'Usuário encerrou todas as sessões ativas', uid);
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  return c.json({ ok: true });
});

// Alterar senha estando logado
app.post('/auth/password/change', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const currentPassword = typeof data.current_password === 'string' ? data.current_password : '';
  const newPassword = typeof data.new_password === 'string' ? data.new_password : '';

  validatePasswordStrength(newPassword, 'A nova senha');

  const user = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(uid)
    .first<{ password_hash: string }>();

  if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
    await logSecurityEvent(c.env.DB, c, 'PASSWORD_CHANGE_FAILED', 'Senha atual incorreta ao tentar alterar senha', uid);
    bad('A senha atual informada está incorreta', 401);
  }

  const newHash = await hashPassword(newPassword);
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, uid),
    // Revoga todas as outras sessões exceto a atual
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(uid, c.get('sessionId')),
  ]);

  await logSecurityEvent(c.env.DB, c, 'PASSWORD_CHANGED', 'Senha alterada pelo próprio usuário (outras sessões encerradas)', uid);
  return c.json({ ok: true, message: 'Senha atualizada com sucesso!' });
});

// ---------- PAINEL EXCLUSIVO DE ADMIN (apenas edoardofama / is_admin = 1) ----------
app.get('/admin/users', async (c) => {
  if (!c.get('isAdmin')) bad('Acesso negado: apenas o administrador pode acessar esta área', 403);
  const { results } = await c.env.DB.prepare(
    'SELECT id, username, email, is_active, is_admin, created_at FROM users ORDER BY id ASC',
  ).all();
  return c.json(results);
});

app.get('/admin/security-logs', async (c) => {
  if (!c.get('isAdmin')) bad('Acesso negado', 403);
  const [logs, activeSessions, activeBlocks] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT l.id, l.user_id, u.username, l.event_type, l.ip_address, l.user_agent, l.details, l.created_at
       FROM security_audit_logs l
       LEFT JOIN users u ON u.id = l.user_id
       ORDER BY l.id DESC LIMIT 80`,
    ),
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM sessions WHERE expires_at > ?').bind(Date.now()),
    c.env.DB.prepare('SELECT COUNT(*) AS count FROM rate_limits WHERE blocked_until > ?').bind(Date.now()),
  ]);
  return c.json({
    active_sessions_count: Number((activeSessions.results[0] as { count: number })?.count ?? 0),
    active_blocks_count: Number((activeBlocks.results[0] as { count: number })?.count ?? 0),
    logs: logs.results,
  });
});

app.post('/admin/users/:id/toggle-status', async (c) => {
  if (!c.get('isAdmin')) bad('Acesso negado', 403);
  const targetId = idParam(c.req.param('id'));
  if (targetId === c.get('userId')) bad('Você não pode bloquear sua própria conta de admin', 400);

  const target = await c.env.DB.prepare('SELECT username, is_active FROM users WHERE id = ?')
    .bind(targetId)
    .first<{ username: string; is_active: number }>();
  if (!target) bad('Usuário não encontrado', 404);

  const newStatus = target.is_active === 1 ? 0 : 1;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(newStatus, targetId),
    ...(newStatus === 0 ? [c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId)] : []),
  ]);

  await logSecurityEvent(
    c.env.DB,
    c,
    newStatus === 0 ? 'ADMIN_USER_BLOCKED' : 'ADMIN_USER_UNBLOCKED',
    `Admin alterou status do usuário "${target.username}" (#${targetId}) para ${newStatus === 1 ? 'Ativo' : 'Bloqueado'}`,
    c.get('userId'),
  );

  return c.json({ id: targetId, is_active: newStatus });
});

app.delete('/admin/users/:id', async (c) => {
  if (!c.get('isAdmin')) bad('Acesso negado', 403);
  const targetId = idParam(c.req.param('id'));
  if (targetId === c.get('userId')) bad('Você não pode excluir sua própria conta de admin', 400);

  const target = await c.env.DB.prepare('SELECT username, email FROM users WHERE id = ?')
    .bind(targetId)
    .first<{ username: string; email: string | null }>();
  if (!target) bad('Usuário não encontrado', 404);

  // Exclusão em cascata atômica de todos os registros pertencentes ao usuário
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId),
    c.env.DB.prepare('DELETE FROM expenses WHERE user_id = ?').bind(targetId),
    c.env.DB.prepare('DELETE FROM inflows WHERE user_id = ?').bind(targetId),
    c.env.DB.prepare('DELETE FROM account_balances WHERE user_id = ?').bind(targetId),
    c.env.DB.prepare('DELETE FROM credit_card_invoices WHERE user_id = ?').bind(targetId),
    c.env.DB.prepare('DELETE FROM investment_snapshots WHERE user_id = ?').bind(targetId),
    c.env.DB.prepare('DELETE FROM investment_accounts WHERE user_id = ?').bind(targetId),
    c.env.DB.prepare('DELETE FROM incomes WHERE user_id = ?').bind(targetId),
    c.env.DB.prepare('DELETE FROM categories WHERE user_id = ?').bind(targetId),
    c.env.DB.prepare('DELETE FROM user_accounts WHERE user_id = ?').bind(targetId),
    ...(target.email
      ? [c.env.DB.prepare('DELETE FROM verification_codes WHERE email = ?').bind(target.email.toLowerCase())]
      : []),
    c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(targetId),
  ]);

  await logSecurityEvent(
    c.env.DB,
    c,
    'ADMIN_USER_DELETED',
    `Admin excluiu permanentemente o usuário "${target.username}" (#${targetId})`,
    c.get('userId'),
  );

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
    "SELECT id, name, budget_cents, note, sort_order, COALESCE(is_fixed, 1) AS is_fixed, COALESCE(icon, '') AS icon FROM categories WHERE user_id = ? ORDER BY is_fixed DESC, sort_order, id",
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
  const icon = str(data.icon ?? '', 'ícone', { required: false, max: 16 }) ?? '';
  const isFixed = data.is_fixed === 0 || data.is_fixed === false ? 0 : 1;
  const uid = c.get('userId');
  const row = await guardUnique(() =>
    c.env.DB.prepare(
      `INSERT INTO categories (user_id, name, budget_cents, note, sort_order, is_fixed, icon)
       VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories WHERE user_id = ?), ?, ?)
       RETURNING id, name, budget_cents, note, sort_order, is_fixed, icon`,
    )
      .bind(uid, name, budget, note, uid, isFixed, icon)
      .first(),
  );
  return c.json(row, 201);
});

app.post('/categories/reorder', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const orderedIds = Array.isArray(data.ordered_ids)
    ? data.ordered_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (orderedIds.length === 0) bad('Lista de categorias inválida');

  const stmts = orderedIds.map((catId, idx) =>
    c.env.DB.prepare('UPDATE categories SET sort_order = ? WHERE id = ? AND user_id = ?').bind(
      idx + 1,
      catId,
      uid,
    ),
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

app.put('/categories/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const data = await body(c);
  const name = str(data.name, 'nome', { required: false });
  const budget = cents(data.budget_cents, 'valor', { required: false });
  const note = str(data.note, 'observação', { required: false, max: 200 });
  const icon = str(data.icon, 'ícone', { required: false, max: 16 });
  const isFixed = data.is_fixed !== undefined ? (data.is_fixed ? 1 : 0) : null;
  const row = await guardUnique(() =>
    c.env.DB.prepare(
      `UPDATE categories SET name = COALESCE(?, name), budget_cents = COALESCE(?, budget_cents),
       note = COALESCE(?, note), is_fixed = COALESCE(?, is_fixed), icon = COALESCE(?, icon)
       WHERE id = ? AND user_id = ?
       RETURNING id, name, budget_cents, note, sort_order, is_fixed, icon`,
    )
      .bind(name ?? null, budget ?? null, note ?? null, isFixed, icon ?? null, id, c.get('userId'))
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

app.post('/categories/:id/check', async (c) => {
  const catId = idParam(c.req.param('id'));
  const uid = c.get('userId');
  const data = await body(c);
  const month = str(data.month, 'mês')!;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) bad('Mês inválido (use YYYY-MM)');

  await assertCategory(c, catId, uid);

  const existing = await c.env.DB.prepare(
    'SELECT is_checked, COALESCE(is_unlocked, 0) AS is_unlocked FROM category_month_checks WHERE user_id = ? AND category_id = ? AND month = ?',
  )
    .bind(uid, catId, month)
    .first<{ is_checked: number; is_unlocked: number }>();

  const nextChecked =
    data.is_checked !== undefined
      ? data.is_checked === true || data.is_checked === 1
        ? 1
        : 0
      : existing?.is_checked ?? 0;

  const nextUnlocked =
    data.is_unlocked !== undefined
      ? data.is_unlocked === true || data.is_unlocked === 1
        ? 1
        : 0
      : existing?.is_unlocked ?? 0;

  await c.env.DB.prepare(
    `INSERT INTO category_month_checks (user_id, category_id, month, is_checked, is_unlocked, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT (user_id, category_id, month) DO UPDATE SET
       is_checked = excluded.is_checked,
       is_unlocked = excluded.is_unlocked,
       updated_at = datetime('now')`,
  )
    .bind(uid, catId, month, nextChecked, nextUnlocked)
    .run();

  return c.json({
    ok: true,
    category_id: catId,
    month,
    is_checked: nextChecked === 1,
    is_unlocked: nextUnlocked === 1,
  });
});

// ---------- lançamentos (expenses) e contas ----------
type AccountId = string;

const EXPENSE_SELECT = `SELECT e.id, e.category_id, c.name AS category_name, e.amount_cents,
  e.title, e.description, e.spent_on, e.payment_method, COALESCE(e.account_id, 'nubank') AS account_id,
  e.installment_current, e.installment_total,
  e.installment_group_id, COALESCE(e.tags, '') AS tags, e.created_at FROM expenses e JOIN categories c ON c.id = e.category_id AND c.user_id = e.user_id`;

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

app.get('/expenses/range', async (c) => {
  const uid = c.get('userId');
  const startMonth = c.req.query('start') || '2020-01';
  const endMonth = c.req.query('end') || '2099-12';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(endMonth)) {
    bad('Período inválido (use YYYY-MM)');
  }
  const [start] = monthRange(startMonth);
  const [, end] = monthRange(endMonth);
  const { results } = await c.env.DB.prepare(
    `${EXPENSE_SELECT} WHERE e.user_id = ? AND e.spent_on >= ? AND e.spent_on < ?
     ORDER BY e.spent_on DESC, e.id DESC`,
  )
    .bind(uid, start, end)
    .all();
  return c.json(results);
});

async function assertCategory(c: { env: Env }, categoryId: number, userId: number) {
  const cat = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ? AND user_id = ?')
    .bind(categoryId, userId)
    .first();
  if (!cat) bad('Categoria inválida ou não pertence à sua conta', 403);
}

async function resolveUserAccountSlug(c: { env: Env }, rawSlug: unknown, userId: number): Promise<string> {
  if (typeof rawSlug === 'string' && rawSlug.trim()) {
    const clean = rawSlug.trim().slice(0, 60);
    const owned = await c.env.DB.prepare('SELECT slug FROM user_accounts WHERE user_id = ? AND slug = ?')
      .bind(userId, clean)
      .first<{ slug: string }>();
    if (owned) return owned.slug;
  }
  const firstAcc = await c.env.DB.prepare(
    'SELECT slug FROM user_accounts WHERE user_id = ? ORDER BY sort_order, id LIMIT 1',
  )
    .bind(userId)
    .first<{ slug: string }>();
  return firstAcc?.slug ?? 'nubank';
}

app.post('/expenses', async (c) => {
  const data = await body(c);
  const uid = c.get('userId');
  const categoryId = cents(data.category_id, 'categoria', { min: 1 })!;
  const amount = cents(data.amount_cents, 'valor', { min: 1 })!;
  const title = str(data.title, 'título', { required: true, max: 120 })!;
  const description = str(data.description ?? '', 'descrição', { required: false, max: 200 }) ?? '';
  const tags = str(data.tags ?? '', 'tags', { required: false, max: 120 }) ?? '';
  const spentOn = str(data.spent_on, 'data')!;
  if (!isDate(spentOn)) bad('Data inválida');
  await assertCategory(c, categoryId, uid);

  // Conta de pagamento validada contra as contas do próprio usuário
  const accountId = await resolveUserAccountSlug(c, data.account_id, uid);

  const rawMethod = typeof data.payment_method === 'string' ? data.payment_method : 'debit';
  const paymentMethod = ['debit', 'pix', 'credit', 'voucher'].includes(rawMethod) ? rawMethod : 'debit';

  // Parcelamento (apenas permitido quando credit)
  const installments = paymentMethod === 'credit' && typeof data.installments === 'number' && Number.isInteger(data.installments) && data.installments > 1
    ? Math.min(data.installments, 48)
    : 1;

  if (installments === 1) {
    const { id } = (await c.env.DB.prepare(
      `INSERT INTO expenses (user_id, category_id, amount_cents, title, description, spent_on, payment_method, account_id, installment_current, installment_total, tags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?) RETURNING id`,
    )
      .bind(uid, categoryId, amount, title, description, spentOn, paymentMethod, accountId, tags)
      .first<{ id: number }>())!;
    const row = await c.env.DB.prepare(`${EXPENSE_SELECT} WHERE e.id = ? AND e.user_id = ?`).bind(id, uid).first();
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
        `INSERT INTO expenses (user_id, category_id, amount_cents, title, description, spent_on, payment_method, account_id, installment_current, installment_total, installment_group_id, tags)
         VALUES (?, ?, ?, ?, ?, ?, 'credit', ?, ?, ?, ?, ?)`,
      ).bind(uid, categoryId, installmentAmount, title, description, installmentDate, accountId, i, installments, groupId, tags),
    );
  }

  await c.env.DB.batch(statements);

  const firstRow = await c.env.DB.prepare(
    `${EXPENSE_SELECT} WHERE e.installment_group_id = ? AND e.installment_current = 1 AND e.user_id = ?`,
  )
    .bind(groupId, uid)
    .first();
  return c.json(firstRow, 201);
});

app.post('/expenses/batch-category', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const ids = Array.isArray(data.ids)
    ? data.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  const categoryId = cents(data.category_id, 'categoria', { min: 1 })!;
  if (ids.length === 0 || ids.length > 200) bad('Selecione entre 1 e 200 lançamentos');
  await assertCategory(c, categoryId, uid);

  const stmts = ids.map((expId) =>
    c.env.DB.prepare('UPDATE expenses SET category_id = ? WHERE id = ? AND user_id = ?').bind(
      categoryId,
      expId,
      uid,
    ),
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, updated_count: ids.length });
});

app.post('/expenses/batch-delete', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const ids = Array.isArray(data.ids)
    ? data.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
    : [];
  if (ids.length === 0 || ids.length > 200) bad('Selecione entre 1 e 200 lançamentos');

  const stmts = ids.map((expId) =>
    c.env.DB.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?').bind(expId, uid),
  );
  await c.env.DB.batch(stmts);
  return c.json({ ok: true, deleted_count: ids.length });
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
  const tags = str(data.tags, 'tags', { required: false, max: 120 });
  const spentOn = str(data.spent_on, 'data', { required: false });
  if (spentOn !== undefined && !isDate(spentOn)) bad('Data inválida');
  if (categoryId !== undefined) await assertCategory(c, categoryId, uid);

  let rawAccount: string | null = null;
  if (typeof data.account_id === 'string' && data.account_id.trim()) {
    rawAccount = await resolveUserAccountSlug(c, data.account_id, uid);
  }
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
       payment_method = COALESCE(?, payment_method),
       tags = COALESCE(?, tags)
       WHERE installment_group_id = ? AND user_id = ?`,
    )
      .bind(categoryId ?? null, title ?? null, rawAccount, rawMethod, tags ?? null, current.installment_group_id, uid)
      .run();
  }

  const updated = await c.env.DB.prepare(
    `UPDATE expenses SET category_id = COALESCE(?, category_id), amount_cents = COALESCE(?, amount_cents),
     title = COALESCE(?, title), description = COALESCE(?, description), spent_on = COALESCE(?, spent_on),
     account_id = COALESCE(?, account_id), payment_method = COALESCE(?, payment_method),
     tags = COALESCE(?, tags)
     WHERE id = ? AND user_id = ? RETURNING id`,
  )
    .bind(categoryId ?? null, amount ?? null, title ?? null, description ?? null, spentOn ?? null, rawAccount, rawMethod, tags ?? null, id, uid)
    .first();
  if (!updated) bad('Lançamento não encontrado', 404);
  const row = await c.env.DB.prepare(`${EXPENSE_SELECT} WHERE e.id = ? AND e.user_id = ?`).bind(id, uid).first();
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

// ---------- entradas (inflows) ----------
app.get('/inflows', async (c) => {
  const [start, end] = monthRange(c.req.query('month'));
  const { results } = await c.env.DB.prepare(
    `SELECT id, account_id, amount_cents, description, received_on, created_at
     FROM inflows
     WHERE user_id = ? AND received_on >= ? AND received_on < ?
     ORDER BY received_on DESC, id DESC`,
  )
    .bind(c.get('userId'), start, end)
    .all();
  return c.json(results);
});

app.post('/inflows', async (c) => {
  const data = await body(c);
  const uid = c.get('userId');
  const amount = cents(data.amount_cents, 'valor', { min: 1 })!;
  const description = str(data.description ?? '', 'descrição', { required: false, max: 200 }) ?? '';
  const receivedOn = str(data.received_on, 'data')!;
  if (!isDate(receivedOn)) bad('Data inválida');

  const accountId = await resolveUserAccountSlug(c, data.account_id, uid);
  const month = receivedOn.slice(0, 7);

  // Verifica saldo existente da conta antes de executar transação em lote
  const existing = await c.env.DB.prepare(
    `SELECT id, initial_cents FROM account_balances WHERE user_id = ? AND account_id = ? AND month = ?`,
  )
    .bind(uid, accountId, month)
    .first<{ id: number; initial_cents: number }>();

  let balanceStmt: D1PreparedStatement;
  if (existing) {
    balanceStmt = c.env.DB.prepare(
      `UPDATE account_balances SET initial_cents = initial_cents + ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    ).bind(amount, existing.id, uid);
  } else {
    const prev = await c.env.DB.prepare(
      `SELECT initial_cents FROM account_balances WHERE user_id = ? AND account_id = ? ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(uid, accountId)
      .first<{ initial_cents: number }>();

    const base = (prev?.initial_cents ?? 0) + amount;
    balanceStmt = c.env.DB.prepare(
      `INSERT INTO account_balances (user_id, month, account_id, initial_cents, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).bind(uid, month, accountId, base);
  }

  const [inflowRes] = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO inflows (user_id, account_id, amount_cents, description, received_on)
       VALUES (?, ?, ?, ?, ?) RETURNING id, account_id, amount_cents, description, received_on, created_at`,
    ).bind(uid, accountId, amount, description, receivedOn),
    balanceStmt,
  ]);

  return c.json(inflowRes.results[0], 201);
});

app.delete('/inflows/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const uid = c.get('userId');

  const inflow = await c.env.DB.prepare(
    'SELECT account_id, amount_cents, received_on FROM inflows WHERE id = ? AND user_id = ?',
  )
    .bind(id, uid)
    .first<{ account_id: string; amount_cents: number; received_on: string }>();

  if (inflow) {
    const month = inflow.received_on.slice(0, 7);
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE account_balances SET initial_cents = MAX(0, initial_cents - ?), updated_at = datetime('now')
         WHERE user_id = ? AND account_id = ? AND month = ?`,
      ).bind(inflow.amount_cents, uid, inflow.account_id, month),
      c.env.DB.prepare('DELETE FROM inflows WHERE id = ? AND user_id = ?').bind(id, uid),
    ]);
  }
  return c.json({ ok: true });
});

// ---------- lembretes (reminders) e calendário ----------
const REMINDER_SELECT = `SELECT r.id, r.user_id, r.title, r.date, r.time, r.amount_cents,
  r.category_id, c.name AS category_name, r.is_completed, r.notify, r.recurrence, r.created_at
  FROM reminders r LEFT JOIN categories c ON c.id = r.category_id AND c.user_id = r.user_id`;

app.get('/reminders', async (c) => {
  const uid = c.get('userId');
  const month = c.req.query('month');
  const date = c.req.query('date');

  let query = `${REMINDER_SELECT} WHERE r.user_id = ?`;
  const params: (string | number)[] = [uid];

  if (month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    const [start, end] = monthRange(month);
    query += ' AND r.date >= ? AND r.date < ?';
    params.push(start, end);
  } else if (date && isDate(date)) {
    query += ' AND r.date = ?';
    params.push(date);
  }

  query += ' ORDER BY r.date ASC, (r.time IS NULL) ASC, r.time ASC, r.id ASC';

  const { results } = await c.env.DB.prepare(query).bind(...params).all();
  return c.json(results);
});

app.post('/reminders', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const title = str(data.title, 'título', { max: 120 })!;
  const date = str(data.date, 'data')!;
  if (!isDate(date)) bad('Data inválida (use YYYY-MM-DD)');

  let time: string | null = null;
  if (typeof data.time === 'string' && data.time.trim()) {
    const t = data.time.trim();
    if (!/^\d{2}:\d{2}$/.test(t)) bad('Horário inválido (use HH:MM)');
    time = t;
  }

  const amountCents = cents(data.amount_cents, 'valor', { required: false });
  const categoryId = typeof data.category_id === 'number' ? data.category_id : undefined;
  if (categoryId !== undefined) await assertCategory(c, categoryId, uid);

  const notify = data.notify === 0 || data.notify === false ? 0 : 1;
  const recurrence = data.recurrence === 'monthly' ? 'monthly' : 'none';

  const res = await c.env.DB.prepare(
    `INSERT INTO reminders (user_id, title, date, time, amount_cents, category_id, notify, recurrence)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(uid, title, date, time, amountCents ?? null, categoryId ?? null, notify, recurrence)
    .first<{ id: number }>();

  const created = await c.env.DB.prepare(`${REMINDER_SELECT} WHERE r.id = ? AND r.user_id = ?`)
    .bind(res!.id, uid)
    .first();

  return c.json(created, 201);
});

app.put('/reminders/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const uid = c.get('userId');
  const data = await body(c);

  const existing = await c.env.DB.prepare('SELECT id FROM reminders WHERE id = ? AND user_id = ?')
    .bind(id, uid)
    .first();
  if (!existing) bad('Lembrete não encontrado', 404);

  const updates: string[] = ["updated_at = datetime('now')"];
  const params: (string | number | null)[] = [];

  if (data.title !== undefined) {
    const title = str(data.title, 'título', { max: 120 })!;
    updates.push('title = ?');
    params.push(title);
  }
  if (data.date !== undefined) {
    const d = str(data.date, 'data')!;
    if (!isDate(d)) bad('Data inválida (use YYYY-MM-DD)');
    updates.push('date = ?');
    params.push(d);
  }
  if (data.time !== undefined) {
    if (data.time === null || data.time === '') {
      updates.push('time = NULL');
    } else {
      const t = str(data.time, 'horário')!;
      if (!/^\d{2}:\d{2}$/.test(t)) bad('Horário inválido (use HH:MM)');
      updates.push('time = ?');
      params.push(t);
    }
  }
  if (data.amount_cents !== undefined) {
    const val = data.amount_cents === null ? null : cents(data.amount_cents, 'valor', { required: false });
    updates.push('amount_cents = ?');
    params.push(val ?? null);
  }
  if (data.category_id !== undefined) {
    if (data.category_id === null) {
      updates.push('category_id = NULL');
    } else {
      const catId = typeof data.category_id === 'number' ? data.category_id : idParam(String(data.category_id));
      await assertCategory(c, catId, uid);
      updates.push('category_id = ?');
      params.push(catId);
    }
  }
  if (data.is_completed !== undefined) {
    updates.push('is_completed = ?');
    params.push(data.is_completed === 1 || data.is_completed === true ? 1 : 0);
  }
  if (data.notify !== undefined) {
    updates.push('notify = ?');
    params.push(data.notify === 0 || data.notify === false ? 0 : 1);
  }
  if (data.recurrence !== undefined) {
    updates.push('recurrence = ?');
    params.push(data.recurrence === 'monthly' ? 'monthly' : 'none');
  }

  params.push(id, uid);
  await c.env.DB.prepare(`UPDATE reminders SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`)
    .bind(...params)
    .run();

  const updated = await c.env.DB.prepare(`${REMINDER_SELECT} WHERE r.id = ? AND r.user_id = ?`)
    .bind(id, uid)
    .first();

  return c.json(updated);
});

app.delete('/reminders/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const uid = c.get('userId');
  const res = await c.env.DB.prepare('DELETE FROM reminders WHERE id = ? AND user_id = ?')
    .bind(id, uid)
    .run();
  if (res.meta.changes === 0) bad('Lembrete não encontrado', 404);
  return c.json({ ok: true });
});

// ---------- cofres e metas de reserva (savings_goals) ----------
app.get('/savings-goals', async (c) => {
  const uid = c.get('userId');
  const { results } = await c.env.DB.prepare(
    'SELECT id, name, icon, target_cents, current_cents, color, created_at FROM savings_goals WHERE user_id = ? ORDER BY id ASC',
  )
    .bind(uid)
    .all();
  return c.json(results);
});

app.post('/savings-goals', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const name = str(data.name, 'nome da meta', { max: 80 })!;
  const icon = str(data.icon ?? '🎯', 'ícone', { required: false, max: 16 }) || '🎯';
  const targetCents = cents(data.target_cents ?? 0, 'meta', { min: 0 })!;
  const currentCents = cents(data.current_cents ?? 0, 'valor atual', { min: 0 })!;
  const color = validHexColor(data.color, '#10b981');

  const row = await c.env.DB.prepare(
    `INSERT INTO savings_goals (user_id, name, icon, target_cents, current_cents, color)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING id, name, icon, target_cents, current_cents, color, created_at`,
  )
    .bind(uid, name, icon, targetCents, currentCents, color)
    .first();

  return c.json(row, 201);
});

app.put('/savings-goals/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const uid = c.get('userId');
  const data = await body(c);

  const existing = await c.env.DB.prepare(
    'SELECT id, current_cents FROM savings_goals WHERE id = ? AND user_id = ?',
  )
    .bind(id, uid)
    .first<{ id: number; current_cents: number }>();
  if (!existing) bad('Meta/Cofre não encontrado', 404);

  const name = str(data.name, 'nome', { required: false, max: 80 });
  const icon = str(data.icon, 'ícone', { required: false, max: 16 });
  const targetCents = cents(data.target_cents, 'meta', { required: false, min: 0 });
  let currentCents = cents(data.current_cents, 'valor atual', { required: false, min: 0 });
  if (typeof data.add_cents === 'number' && Number.isInteger(data.add_cents)) {
    currentCents = Math.max(0, existing.current_cents + data.add_cents);
  }
  const color = data.color !== undefined ? validHexColor(data.color) : null;

  const updated = await c.env.DB.prepare(
    `UPDATE savings_goals SET
       name = COALESCE(?, name),
       icon = COALESCE(?, icon),
       target_cents = COALESCE(?, target_cents),
       current_cents = COALESCE(?, current_cents),
       color = COALESCE(?, color),
       updated_at = datetime('now')
     WHERE id = ? AND user_id = ?
     RETURNING id, name, icon, target_cents, current_cents, color, created_at`,
  )
    .bind(name ?? null, icon ?? null, targetCents ?? null, currentCents ?? null, color, id, uid)
    .first();

  return c.json(updated);
});

app.delete('/savings-goals/:id', async (c) => {
  const id = idParam(c.req.param('id'));
  const uid = c.get('userId');
  await c.env.DB.prepare('DELETE FROM savings_goals WHERE id = ? AND user_id = ?')
    .bind(id, uid)
    .run();
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
              COALESCE(c.icon, '') AS icon,
              COALESCE(SUM(e.amount_cents), 0) AS spent_cents, COUNT(e.id) AS count
       FROM categories c
       LEFT JOIN expenses e ON e.category_id = c.id AND e.user_id = c.user_id AND e.spent_on >= ? AND e.spent_on < ?
       WHERE c.user_id = ?
       GROUP BY c.id ORDER BY c.is_fixed DESC, c.sort_order, c.id`,
    ).bind(start, end, uid),
    c.env.DB.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS total FROM incomes WHERE user_id = ?').bind(uid),
  ]);

  // Busca marcações de categorias quitadas e desbloqueadas no mês
  const { results: checkRows } = await c.env.DB.prepare(
    'SELECT category_id, is_checked, COALESCE(is_unlocked, 0) AS is_unlocked FROM category_month_checks WHERE user_id = ? AND month = ?',
  )
    .bind(uid, month)
    .all<{ category_id: number; is_checked: number; is_unlocked: number }>();
  const checkedSet = new Set(checkRows.filter((r) => r.is_checked === 1).map((r) => r.category_id));
  const unlockedSet = new Set(checkRows.filter((r) => r.is_unlocked === 1).map((r) => r.category_id));

  const rawCats = cats.results as unknown as {
    id: number;
    name: string;
    budget_cents: number;
    note: string;
    sort_order: number;
    is_fixed: number;
    icon: string;
    spent_cents: number;
    count: number;
  }[];
  const categories = rawCats.map((cat) => ({
    ...cat,
    is_checked: checkedSet.has(cat.id),
    is_unlocked: unlockedSet.has(cat.id),
  }));

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

  // 2. Busca contas configuradas pelo usuário
  const userAccRows = await c.env.DB.prepare(
    'SELECT id, slug, name, color FROM user_accounts WHERE user_id = ? ORDER BY sort_order, id',
  )
    .bind(uid)
    .all<{ id: number; slug: string; name: string; color: string }>();

  // Gastos que foram criados APENAS APÓS a data/hora em que o saldo daquela conta foi definido
  const accounts = [];
  for (const uAcc of userAccRows.results) {
    const b = balancesMap[uAcc.slug];
    let spent_cents = 0;
    if (b && b.initial_cents > 0 && b.updated_at) {
      const row = await c.env.DB.prepare(
        `SELECT COALESCE(SUM(amount_cents), 0) AS total
         FROM expenses
         WHERE user_id = ?
           AND account_id = ?
           AND payment_method != 'credit'
           AND spent_on >= ?
           AND created_at >= ?`,
      )
        .bind(uid, uAcc.slug, start, b.updated_at)
        .first<{ total: number }>();
      spent_cents = row?.total ?? 0;
    }
    const initial_cents = b?.initial_cents ?? 0;
    accounts.push({
      id: uAcc.id,
      account_id: uAcc.slug,
      name: uAcc.name,
      color: uAcc.color,
      initial_cents,
      spent_cents,
      current_cents: initial_cents - spent_cents,
    });
  }

  const totalIncomeCents = Number(inc.results[0]?.total ?? 0);
  const fixedCats = categories.filter((c) => c.is_fixed === 1);
  const variableCats = categories.filter((c) => c.is_fixed === 0);

  const fixedBudgetCents = fixedCats.reduce((s, x) => s + x.budget_cents, 0);
  const fixedSpentCents = fixedCats.reduce((s, x) => s + x.spent_cents, 0);
  const variableSpentCents = variableCats.reduce((s, x) => s + x.spent_cents, 0);

  const porForaBudgetCents = totalIncomeCents - fixedBudgetCents;
  const porForaSpentCents = variableSpentCents;
  const porForaRemainingCents = porForaBudgetCents - porForaSpentCents;

  // Projeção de Fechamento do Mês ("Quanto vai me sobrar?")
  const inflowRow = await c.env.DB.prepare(
    'SELECT COALESCE(SUM(amount_cents), 0) AS total FROM inflows WHERE user_id = ? AND received_on >= ? AND received_on < ?'
  )
    .bind(uid, start, end)
    .first<{ total: number }>();
  const inflowsTotalCents = inflowRow?.total ?? 0;

  const ccRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses WHERE user_id = ? AND payment_method = 'credit' AND spent_on >= ? AND spent_on < ?`
  )
    .bind(uid, start, end)
    .first<{ total: number }>();
  const ccTotalCents = ccRow?.total ?? 0;

  const invoiceRow = await c.env.DB.prepare(
    `SELECT paid_amount_cents FROM credit_card_invoices WHERE user_id = ? AND month = ?`
  )
    .bind(uid, month)
    .first<{ paid_amount_cents: number }>();
  const ccPaidCents = invoiceRow?.paid_amount_cents ?? 0;
  const invoiceRemainingCents = Math.max(0, ccTotalCents - ccPaidCents);

  const fixedRemainingCents = fixedCats.reduce(
    (sum, cat) => sum + (cat.is_checked ? 0 : Math.max(0, cat.budget_cents - cat.spent_cents)),
    0
  );

  const expectedRemainingIncomeCents = Math.max(0, totalIncomeCents - inflowsTotalCents);

  const nubankAcc = accounts.find((a) => a.account_id === 'nubank');
  const bankBalanceCents = nubankAcc ? nubankAcc.current_cents : 0;

  const predictedSurplusCents =
    bankBalanceCents + expectedRemainingIncomeCents - invoiceRemainingCents - fixedRemainingCents;

  const projection = {
    bank_balance_cents: bankBalanceCents,
    expected_income_cents: totalIncomeCents,
    inflows_total_cents: inflowsTotalCents,
    expected_remaining_income_cents: expectedRemainingIncomeCents,
    invoice_remaining_cents: invoiceRemainingCents,
    fixed_remaining_cents: fixedRemainingCents,
    predicted_surplus_cents: predictedSurplusCents,
  };

  const [topExpRows, heatmapRows, goalsRows] = await c.env.DB.batch([
    c.env.DB.prepare(
      `${EXPENSE_SELECT} WHERE e.user_id = ? AND e.spent_on >= ? AND e.spent_on < ?
       ORDER BY e.amount_cents DESC, e.id DESC LIMIT 5`,
    ).bind(uid, start, end),
    c.env.DB.prepare(
      `SELECT spent_on AS date, COALESCE(SUM(amount_cents), 0) AS total_cents, COUNT(*) AS count
       FROM expenses
       WHERE user_id = ? AND spent_on >= ? AND spent_on < ?
       GROUP BY spent_on ORDER BY spent_on ASC`,
    ).bind(uid, start, end),
    c.env.DB.prepare(
      'SELECT id, name, icon, target_cents, current_cents, color, created_at FROM savings_goals WHERE user_id = ? ORDER BY id ASC',
    ).bind(uid),
  ]);

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
    projection,
    top_expenses: topExpRows.results,
    daily_heatmap: heatmapRows.results,
    savings_goals: goalsRows.results,
  });
});

// ---------- comparativo analítico mensal (últimos N meses) ----------
app.get('/analytics/monthly', async (c) => {
  const uid = c.get('userId');
  const count = Math.min(12, Math.max(2, Number(c.req.query('months') || 6)));
  const currentMonthParam = c.req.query('month') || new Date().toISOString().slice(0, 7);

  // Gera lista ordenada dos últimos `count` meses até o mês solicitado
  const months: string[] = [];
  const [currY, currM] = currentMonthParam.split('-').map(Number);
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(currY, currM - 1 - i, 1));
    const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    months.push(ym);
  }

  const [earliestStart] = monthRange(months[0]);
  const [, latestEnd] = monthRange(months[months.length - 1]);

  // Busca saídas agrupadas por mês
  const { results: expensesRows } = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', spent_on) as month,
            COALESCE(SUM(amount_cents), 0) as total_expenses,
            COALESCE(SUM(CASE WHEN payment_method = 'credit' THEN amount_cents ELSE 0 END), 0) as credit_card,
            COALESCE(SUM(CASE WHEN payment_method != 'credit' THEN amount_cents ELSE 0 END), 0) as debit
     FROM expenses
     WHERE user_id = ? AND spent_on >= ? AND spent_on < ?
     GROUP BY strftime('%Y-%m', spent_on)`
  )
    .bind(uid, earliestStart, latestEnd)
    .all<{ month: string; total_expenses: number; credit_card: number; debit: number }>();

  // Busca entradas agrupadas por mês
  const { results: inflowsRows } = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', received_on) as month,
            COALESCE(SUM(amount_cents), 0) as total_inflows
     FROM inflows
     WHERE user_id = ? AND received_on >= ? AND received_on < ?
     GROUP BY strftime('%Y-%m', received_on)`
  )
    .bind(uid, earliestStart, latestEnd)
    .all<{ month: string; total_inflows: number }>();

  // Busca investimentos agrupados por mês
  const { results: investRows } = await c.env.DB.prepare(
    `SELECT month, COALESCE(SUM(balance_cents), 0) as total_investments
     FROM investment_snapshots
     WHERE user_id = ? AND month >= ? AND month <= ?
     GROUP BY month`
  )
    .bind(uid, months[0], months[months.length - 1])
    .all<{ month: string; total_investments: number }>();

  const expMap = new Map(expensesRows.map((r) => [r.month, r]));
  const infMap = new Map(inflowsRows.map((r) => [r.month, r.total_inflows]));
  const invMap = new Map(investRows.map((r) => [r.month, r.total_investments]));

  const SHORT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const results = months.map((m) => {
    const [, monthNum] = m.split('-').map(Number);
    const label = `${SHORT_MONTHS[(monthNum || 1) - 1]}/${m.slice(2, 4)}`;
    const exp = expMap.get(m);
    const expensesCents = exp?.total_expenses ?? 0;
    const inflowsCents = infMap.get(m) ?? 0;
    const ccCents = exp?.credit_card ?? 0;
    const debitCents = exp?.debit ?? 0;
    const investCents = invMap.get(m) ?? 0;

    return {
      month: m,
      month_label: label,
      expenses_cents: expensesCents,
      inflows_cents: inflowsCents,
      credit_card_cents: ccCents,
      debit_cents: debitCents,
      investments_cents: investCents,
      net_cents: inflowsCents - expensesCents,
    };
  });

  return c.json(results);
});

// ---------- gerenciamento de contas do usuário ----------
app.get('/accounts', async (c) => {
  const uid = c.get('userId');
  const accounts = await c.env.DB.prepare(
    'SELECT id, slug, name, color, sort_order FROM user_accounts WHERE user_id = ? ORDER BY sort_order, id',
  )
    .bind(uid)
    .all();
  return c.json(accounts.results);
});

app.post('/accounts', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const name = str(data.name, 'nome')!.toUpperCase();
  const color = validHexColor(data.color, '#10b981');

  let baseSlug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
  if (!baseSlug) baseSlug = 'conta';

  let slug = baseSlug;
  let counter = 1;
  while (true) {
    const existing = await c.env.DB.prepare(
      'SELECT id FROM user_accounts WHERE user_id = ? AND slug = ?',
    )
      .bind(uid, slug)
      .first();
    if (!existing) break;
    counter++;
    slug = `${baseSlug}_${counter}`;
  }

  const row = await c.env.DB.prepare(
    `INSERT INTO user_accounts (user_id, slug, name, color, sort_order)
     VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM user_accounts WHERE user_id = ?))
     RETURNING id, slug, name, color, sort_order`,
  )
    .bind(uid, slug, name, color, uid)
    .first<{ id: number; slug: string; name: string; color: string; sort_order: number }>();

  if (!row) bad('Erro ao criar conta');

  // Se passou initial_cents e month, já define o saldo inicial diretamente
  if (typeof data.initial_cents === 'number' && data.initial_cents > 0 && typeof data.month === 'string' && /^\d{4}-\d{2}$/.test(data.month)) {
    await c.env.DB.prepare(
      `INSERT INTO account_balances (user_id, month, account_id, initial_cents, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, month, account_id)
       DO UPDATE SET initial_cents = excluded.initial_cents, updated_at = datetime('now')`,
    )
      .bind(uid, data.month, row.slug, cents(data.initial_cents, 'saldo inicial')!)
      .run();
  }

  return c.json(row, 201);
});

// ---------- saldos das contas (abertos para edição) ----------
// IMPORTANTE: Definido ANTES de /accounts/:id para evitar que "balance" seja interpretado como id!
app.put('/accounts/balance', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const month = str(data.month, 'mês')!;
  if (!/^\d{4}-\d{2}$/.test(month)) bad('Mês inválido');
  const rawAccountId = str(data.account_id, 'conta', { max: 60 })!;
  const initialCents = cents(data.initial_cents, 'saldo em conta')!;

  // Verifica se a conta pertence ao usuário antes de permitir alteração de saldo
  const ownedAccount = await c.env.DB.prepare(
    'SELECT slug FROM user_accounts WHERE user_id = ? AND slug = ?',
  )
    .bind(uid, rawAccountId)
    .first<{ slug: string }>();

  if (!ownedAccount) {
    bad('Conta não encontrada ou não pertence ao seu usuário', 403);
  }

  await c.env.DB.prepare(
    `INSERT INTO account_balances (user_id, month, account_id, initial_cents, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, month, account_id)
     DO UPDATE SET initial_cents = excluded.initial_cents, updated_at = datetime('now')`,
  )
    .bind(uid, month, ownedAccount.slug, initialCents)
    .run();

  return c.json({ ok: true, account_id: ownedAccount.slug, month, initial_cents: initialCents });
});

app.put('/accounts/:id', async (c) => {
  const uid = c.get('userId');
  const id = idParam(c.req.param('id'));
  const data = await body(c);
  const name = str(data.name, 'nome', { required: false })?.toUpperCase();
  const color = data.color !== undefined ? validHexColor(data.color) : null;

  const row = await c.env.DB.prepare(
    `UPDATE user_accounts SET name = COALESCE(?, name), color = COALESCE(?, color)
     WHERE id = ? AND user_id = ?
     RETURNING id, slug, name, color, sort_order`,
  )
    .bind(name ?? null, color, id, uid)
    .first();

  if (!row) bad('Conta não encontrada', 404);
  return c.json(row);
});

app.delete('/accounts/:id', async (c) => {
  const uid = c.get('userId');
  const id = idParam(c.req.param('id'));

  const acc = await c.env.DB.prepare('SELECT id, slug FROM user_accounts WHERE id = ? AND user_id = ?')
    .bind(id, uid)
    .first<{ id: number; slug: string }>();

  if (!acc) bad('Conta não encontrada', 404);

  // Remove saldos e conta em lote atômico
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM account_balances WHERE user_id = ? AND account_id = ?').bind(uid, acc.slug),
    c.env.DB.prepare('DELETE FROM user_accounts WHERE id = ? AND user_id = ?').bind(id, uid),
  ]);

  return c.json({ ok: true });
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

  // PROTEÇÃO ANTI-IDOR: verifica se a corretora pertence ao usuário logado
  const ownedInvAccount = await c.env.DB.prepare(
    'SELECT id FROM investment_accounts WHERE id = ? AND user_id = ?',
  )
    .bind(accountId, uid)
    .first<{ id: number }>();

  if (!ownedInvAccount) {
    bad('Corretora de investimento não encontrada ou não pertence à sua conta', 403);
  }

  const balance = cents(data.balance_cents, 'saldo')!;
  let delta: number;

  if (typeof data.delta_cents === 'number' && Number.isInteger(data.delta_cents) && Math.abs(data.delta_cents) <= 1_000_000_000) {
    delta = data.delta_cents;
  } else {
    // Auto-calcula variação com base no snapshot do mês anterior mais recente
    const prevSnap = await c.env.DB.prepare(
      `SELECT balance_cents FROM investment_snapshots
       WHERE user_id = ? AND account_id = ? AND month < ?
       ORDER BY month DESC LIMIT 1`,
    )
      .bind(uid, accountId, month)
      .first<{ balance_cents: number }>();

    delta = prevSnap ? balance - prevSnap.balance_cents : 0;
  }

  await c.env.DB.prepare(
    `INSERT INTO investment_snapshots (user_id, account_id, month, balance_cents, delta_cents)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, account_id, month) DO UPDATE SET
       balance_cents = excluded.balance_cents,
       delta_cents = excluded.delta_cents`,
  )
    .bind(uid, accountId, month, balance, delta)
    .run();

  return c.json({ ok: true, balance_cents: balance, delta_cents: delta });
});

app.post('/investments/redeem', async (c) => {
  const data = await body(c);
  const uid = c.get('userId');
  const accountId = idParam(String(data.account_id));
  const amount = cents(data.amount_cents, 'valor de resgate', { min: 1 })!;

  const dateParam = typeof data.date === 'string' && isDate(data.date)
    ? data.date
    : new Date().toISOString().slice(0, 10);

  // 1. Verifica se a corretora de investimento existe e pertence ao usuário
  const invAccount = await c.env.DB.prepare(
    'SELECT id, name FROM investment_accounts WHERE id = ? AND user_id = ?',
  )
    .bind(accountId, uid)
    .first<{ id: number; name: string }>();

  if (!invAccount) bad('Corretora de investimento não encontrada', 404);

  // 2. Busca o snapshot mais recente dessa corretora para saber o saldo real atual
  const latestSnap = await c.env.DB.prepare(
    `SELECT month, balance_cents, delta_cents FROM investment_snapshots
     WHERE user_id = ? AND account_id = ?
     ORDER BY month DESC LIMIT 1`,
  )
    .bind(uid, accountId)
    .first<{ month: string; balance_cents: number; delta_cents: number }>();

  if (!latestSnap || latestSnap.balance_cents <= 0) {
    bad(`A corretora ${invAccount.name} não possui saldo disponível para resgate`, 400);
  }

  // Verifica se foi solicitado um mês específico que tenha saldo suficiente
  const requestedMonth = typeof data.snapshot_month === 'string' && /^\d{4}-\d{2}$/.test(data.snapshot_month)
    ? data.snapshot_month
    : typeof data.month === 'string' && /^\d{4}-\d{2}$/.test(data.month)
      ? data.month
      : undefined;

  let snapToUpdate = latestSnap;

  if (requestedMonth) {
    const specifiedSnap = await c.env.DB.prepare(
      `SELECT month, balance_cents, delta_cents FROM investment_snapshots
       WHERE user_id = ? AND account_id = ? AND month = ?`,
    )
      .bind(uid, accountId, requestedMonth)
      .first<{ month: string; balance_cents: number; delta_cents: number }>();

    if (specifiedSnap && specifiedSnap.balance_cents >= amount) {
      snapToUpdate = specifiedSnap;
    }
  }

  const availableBalance = snapToUpdate.balance_cents;

  if (amount > availableBalance) {
    bad(
      `O valor a resgatar (${(amount / 100).toFixed(2).replace('.', ',')}) é maior que o saldo disponível na corretora ${invAccount.name} (${(availableBalance / 100).toFixed(2).replace('.', ',')})`,
      400,
    );
  }

  const newBalance = snapToUpdate.balance_cents - amount;
  const newDelta = snapToUpdate.delta_cents - amount;
  const targetMonth = snapToUpdate.month;

  // 3. Determina e valida a conta de destino do usuário
  const destAccountId = await resolveUserAccountSlug(c, data.destination_account_id ?? 'nubank', uid);
  const destMonth = dateParam.slice(0, 7);

  const destBal = await c.env.DB.prepare(
    `SELECT id, initial_cents FROM account_balances
     WHERE user_id = ? AND account_id = ? AND month = ?`,
  )
    .bind(uid, destAccountId, destMonth)
    .first<{ id: number; initial_cents: number }>();

  let destBalanceStmt: D1PreparedStatement;
  if (destBal) {
    destBalanceStmt = c.env.DB.prepare(
      `UPDATE account_balances SET initial_cents = initial_cents + ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
    ).bind(amount, destBal.id, uid);
  } else {
    const prevDest = await c.env.DB.prepare(
      `SELECT initial_cents FROM account_balances WHERE user_id = ? AND account_id = ? ORDER BY updated_at DESC LIMIT 1`,
    )
      .bind(uid, destAccountId)
      .first<{ initial_cents: number }>();

    const baseBal = (prevDest?.initial_cents ?? 0) + amount;
    destBalanceStmt = c.env.DB.prepare(
      `INSERT INTO account_balances (user_id, month, account_id, initial_cents, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).bind(uid, destMonth, destAccountId, baseBal);
  }

  // 4. Executa abate da corretora + crédito na conta + registro de entrada em LOTE ATÔMICO
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO investment_snapshots (user_id, account_id, month, balance_cents, delta_cents)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, account_id, month) DO UPDATE SET
         balance_cents = excluded.balance_cents,
         delta_cents = excluded.delta_cents`,
    ).bind(uid, accountId, targetMonth, newBalance, newDelta),
    destBalanceStmt,
    c.env.DB.prepare(
      `INSERT INTO inflows (user_id, account_id, amount_cents, description, received_on)
       VALUES (?, ?, ?, ?, ?)`,
    ).bind(uid, destAccountId, amount, `Resgate Investimento - ${invAccount.name}`, dateParam),
  ]);

  return c.json({
    ok: true,
    account_id: accountId,
    account_name: invAccount.name,
    destination_account: destAccountId,
    redeemed_cents: amount,
    new_balance_cents: newBalance,
    month: targetMonth,
  });
});

app.post('/investments/accounts', async (c) => {
  const data = await body(c);
  const uid = c.get('userId');
  const name = str(data.name, 'nome')!.toUpperCase();
  const color = validHexColor(data.color, '#10b981');

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

app.put('/investments/accounts/:id', async (c) => {
  const uid = c.get('userId');
  const id = idParam(c.req.param('id'));
  const data = await body(c);
  const name = str(data.name, 'nome', { required: false })?.toUpperCase();
  const color = data.color !== undefined ? validHexColor(data.color) : null;

  const row = await c.env.DB.prepare(
    `UPDATE investment_accounts SET name = COALESCE(?, name), color = COALESCE(?, color)
     WHERE id = ? AND user_id = ?
     RETURNING id, name, color, sort_order`,
  )
    .bind(name ?? null, color, id, uid)
    .first();

  if (!row) bad('Corretora não encontrada', 404);
  return c.json(row);
});

app.delete('/investments/accounts/:id', async (c) => {
  const uid = c.get('userId');
  const id = idParam(c.req.param('id'));

  const acc = await c.env.DB.prepare('SELECT id FROM investment_accounts WHERE id = ? AND user_id = ?')
    .bind(id, uid)
    .first();

  if (!acc) bad('Corretora não encontrada', 404);

  // Remove snapshots e corretora em lote atômico
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM investment_snapshots WHERE account_id = ? AND user_id = ?').bind(id, uid),
    c.env.DB.prepare('DELETE FROM investment_accounts WHERE id = ? AND user_id = ?').bind(id, uid),
  ]);

  return c.json({ ok: true });
});

// ---------- export (todos os dados do usuário) ----------
app.get('/export', async (c) => {
  const uid = c.get('userId');
  const db = c.env.DB;
  const [incomes, categories, expenses, inflows, accounts, snapshots] = await db.batch([
    db.prepare('SELECT name, amount_cents FROM incomes WHERE user_id = ? ORDER BY sort_order, id').bind(uid),
    db.prepare('SELECT name, budget_cents, note FROM categories WHERE user_id = ? ORDER BY sort_order, id').bind(uid),
    db.prepare(
      `SELECT e.spent_on, e.title, e.description, c.name AS category, e.amount_cents, e.payment_method,
              COALESCE(e.account_id, 'nubank') AS account_id,
              e.installment_current, e.installment_total
       FROM expenses e JOIN categories c ON c.id = e.category_id AND c.user_id = e.user_id
       WHERE e.user_id = ? ORDER BY e.spent_on, e.id`,
    ).bind(uid),
    db.prepare('SELECT account_id, amount_cents, description, received_on FROM inflows WHERE user_id = ? ORDER BY received_on, id').bind(uid),
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
    inflows: inflows.results,
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
    `SELECT initial_cents, updated_at FROM account_balances WHERE user_id = ? AND account_id = 'nubank' ORDER BY (month = ?) DESC, updated_at DESC LIMIT 1`,
  )
    .bind(uid, month)
    .first<{ initial_cents: number; updated_at: string }>();

  let nubankBalanceCents = nubankRow?.initial_cents ?? 0;
  if (nubankRow && nubankBalanceCents > 0 && nubankRow.updated_at) {
    const spentRow = await c.env.DB.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS total
       FROM expenses
       WHERE user_id = ?
         AND account_id = 'nubank'
         AND payment_method != 'credit'
         AND spent_on >= ?
         AND created_at >= ?`,
    )
      .bind(uid, start, nubankRow.updated_at)
      .first<{ total: number }>();
    nubankBalanceCents = Math.max(0, nubankBalanceCents - (spentRow?.total ?? 0));
  }

  const paidAmountCents = invoice?.paid_amount_cents ?? 0;
  const remainingCents = Math.max(0, totalCents - paidAmountCents);
  const isPaid = (totalCents > 0 && paidAmountCents >= totalCents) || Boolean(invoice?.is_paid && remainingCents === 0);

  // Item 16: Divisão da fatura por categoria
  const byCategoryMap = new Map<string, { category_id: number; category_name: string; total_cents: number; count: number }>();
  for (const exp of expenses as any[]) {
    const key = String(exp.category_id);
    const prev = byCategoryMap.get(key) || {
      category_id: Number(exp.category_id),
      category_name: String(exp.category_name || 'Outros'),
      total_cents: 0,
      count: 0,
    };
    prev.total_cents += Number(exp.amount_cents || 0);
    prev.count += 1;
    byCategoryMap.set(key, prev);
  }
  const byCategory = Array.from(byCategoryMap.values()).sort((a, b) => b.total_cents - a.total_cents);

  // Item 15: Histórico gráfico de faturas (últimos 6 meses)
  const [currY, currM] = month.split('-').map(Number);
  const histMonths: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(currY, currM - 1 - i, 1);
    histMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const histFirstStart = `${histMonths[0]}-01`;
  const [, histLastEnd] = monthRange(histMonths[histMonths.length - 1]);

  const { results: histRows } = await c.env.DB.prepare(
    `SELECT substr(spent_on, 1, 7) AS m, COALESCE(SUM(amount_cents), 0) AS total_cents
     FROM expenses
     WHERE user_id = ? AND payment_method = 'credit' AND spent_on >= ? AND spent_on < ?
     GROUP BY m`,
  )
    .bind(uid, histFirstStart, histLastEnd)
    .all<{ m: string; total_cents: number }>();
  const histMap = new Map(histRows.map((r) => [r.m, r.total_cents]));
  const history = histMonths.map((m) => ({
    month: m,
    total_cents: histMap.get(m) ?? 0,
  }));

  // Item 12: Simulador de Fechamento de Fatura (Fecha dia 21 e vence dia 27)
  const nextMonthDate = new Date(currY, currM, 1);
  const nextMonthStr = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, '0')}`;
  const [nextStart, nextEnd] = monthRange(nextMonthStr);
  const nextProjRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses
     WHERE user_id = ? AND payment_method = 'credit' AND spent_on >= ? AND spent_on < ?`,
  )
    .bind(uid, nextStart, nextEnd)
    .first<{ total: number }>();

  const before21Cents = (expenses as any[])
    .filter((e) => Number(String(e.spent_on).slice(8, 10)) < 21)
    .reduce((s, e) => s + Number(e.amount_cents || 0), 0);
  const from21Cents = totalCents - before21Cents;

  return c.json({
    month,
    total_cents: totalCents,
    paid_amount_cents: paidAmountCents,
    remaining_cents: remainingCents,
    count: expenses.length,
    is_paid: isPaid,
    is_partial: paidAmountCents > 0 && remainingCents > 0,
    paid_at: invoice?.paid_at ?? null,
    nubank_balance_cents: nubankBalanceCents,
    expenses,
    by_category: byCategory,
    history,
    cycle: {
      closing_day: 21,
      due_day: 27,
      before_closing_cents: before21Cents,
      after_closing_cents: from21Cents,
      next_month: nextMonthStr,
      next_month_scheduled_cents: nextProjRow?.total ?? 0,
    },
  });
});

app.post('/credit-card/pay', async (c) => {
  const uid = c.get('userId');
  const data = await body(c);
  const month = str(data.month, 'mês')!;
  const [start, end] = monthRange(month);

  const totalRow = await c.env.DB.prepare(
    `SELECT COALESCE(SUM(amount_cents), 0) AS total FROM expenses
     WHERE user_id = ? AND payment_method = 'credit' AND spent_on >= ? AND spent_on < ?`,
  )
    .bind(uid, start, end)
    .first<{ total: number }>();

  const totalCents = totalRow?.total ?? 0;
  if (totalCents <= 0) bad('Não há despesas no cartão nesta fatura para pagar');

  const existing = await c.env.DB.prepare(
    `SELECT is_paid, paid_amount_cents FROM credit_card_invoices WHERE user_id = ? AND month = ?`,
  )
    .bind(uid, month)
    .first<{ is_paid: number; paid_amount_cents: number }>();

  const currentPaid = existing?.paid_amount_cents ?? 0;
  const remaining = Math.max(0, totalCents - currentPaid);
  if (remaining <= 0) bad('Esta fatura já está totalmente quitada');

  // Suporte a pagamento parcial ou total
  let payCents = remaining;
  if (data.amount_cents !== undefined && data.amount_cents !== null && data.amount_cents !== '') {
    payCents = cents(data.amount_cents, 'valor a pagar', { min: 1 })!;
    if (payCents > remaining) {
      bad(`O valor a pagar não pode exceder o restante da fatura (R$ ${(remaining / 100).toFixed(2).replace('.', ',')})`);
    }
  }

  const newTotalPaid = currentPaid + payCents;
  const isPaid = newTotalPaid >= totalCents ? 1 : 0;

  // Abater do saldo da conta Nubank e atualizar fatura de forma atômica
  const nubankBalance = await c.env.DB.prepare(
    `SELECT id, month, initial_cents FROM account_balances
     WHERE user_id = ? AND account_id = 'nubank'
     ORDER BY (month = ?) DESC, updated_at DESC LIMIT 1`,
  )
    .bind(uid, month)
    .first<{ id: number; month: string; initial_cents: number }>();

  const balanceStmt = nubankBalance
    ? c.env.DB.prepare(
        `UPDATE account_balances SET initial_cents = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      ).bind(Math.max(0, nubankBalance.initial_cents - payCents), nubankBalance.id, uid)
    : c.env.DB.prepare(
        `INSERT INTO account_balances (user_id, month, account_id, initial_cents, updated_at)
         VALUES (?, ?, 'nubank', 0, datetime('now'))`,
      ).bind(uid, month);

  await c.env.DB.batch([
    balanceStmt,
    c.env.DB.prepare(
      `INSERT INTO credit_card_invoices (user_id, month, is_paid, paid_at, paid_amount_cents)
       VALUES (?, ?, ?, datetime('now'), ?)
       ON CONFLICT(user_id, month)
       DO UPDATE SET is_paid = excluded.is_paid, paid_at = datetime('now'), paid_amount_cents = excluded.paid_amount_cents`,
    ).bind(uid, month, isPaid, newTotalPaid),
  ]);

  return c.json({
    ok: true,
    month,
    paid_now_cents: payCents,
    total_paid_cents: newTotalPaid,
    remaining_cents: Math.max(0, totalCents - newTotalPaid),
    is_paid: isPaid === 1,
  });
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

  if (!existing || (existing.paid_amount_cents || 0) <= 0) {
    bad('Nenhum pagamento registrado nesta fatura para desfazer');
  }

  const paidAmount = existing.paid_amount_cents || 0;

  // Restaurar o valor abatido no saldo da Nubank
  const nubankBalance = await c.env.DB.prepare(
    `SELECT id, initial_cents FROM account_balances
     WHERE user_id = ? AND account_id = 'nubank'
     ORDER BY (month = ?) DESC, updated_at DESC LIMIT 1`,
  )
    .bind(uid, month)
    .first<{ id: number; initial_cents: number }>();

  const stmts: D1PreparedStatement[] = [];
  if (nubankBalance) {
    const restored = nubankBalance.initial_cents + paidAmount;
    stmts.push(
      c.env.DB.prepare(
        `UPDATE account_balances SET initial_cents = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`,
      ).bind(restored, nubankBalance.id, uid),
    );
  }

  stmts.push(
    c.env.DB.prepare(
      `UPDATE credit_card_invoices SET is_paid = 0, paid_at = NULL, paid_amount_cents = 0 WHERE user_id = ? AND month = ?`,
    ).bind(uid, month),
  );

  await c.env.DB.batch(stmts);

  return c.json({ ok: true, month, restored_cents: paidAmount });
});

// ============================================================================
// INTEGRAÇÃO NUBANK / MACRODROID (WEBHOOK AUTOMÁTICO)
// ============================================================================

function getTodayBrasilia(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

// Retorna token de integração do usuário autenticado para configuração no celular
app.get('/user/webhook-token', async (c) => {
  const uid = c.get('userId');
  let user = await c.env.DB.prepare('SELECT webhook_token FROM users WHERE id = ?')
    .bind(uid)
    .first<{ webhook_token: string | null }>();

  let token = user?.webhook_token;
  if (!token) {
    token = 'capi_live_' + randomToken() + randomToken().slice(0, 8);
    await c.env.DB.prepare('UPDATE users SET webhook_token = ? WHERE id = ?')
      .bind(token, uid)
      .run();
  }

  const url = new URL(c.req.url);
  const webhookUrl = `${url.origin}/api/integrations/nubank?token=${token}`;

  return c.json({ webhook_token: token, webhook_url: webhookUrl });
});

// Regenera token de integração
app.post('/user/webhook-token/regenerate', async (c) => {
  const uid = c.get('userId');
  const token = 'capi_live_' + randomToken() + randomToken().slice(0, 8);
  await c.env.DB.prepare('UPDATE users SET webhook_token = ? WHERE id = ?')
    .bind(token, uid)
    .run();

  await logSecurityEvent(c.env.DB, c, 'WEBHOOK_TOKEN_REGENERATED', 'Token de webhook regenerado pelo usuário', uid);

  const url = new URL(c.req.url);
  const webhookUrl = `${url.origin}/api/integrations/nubank?token=${token}`;

  return c.json({ webhook_token: token, webhook_url: webhookUrl });
});

// Lista os últimos logs de webhook do usuário (Item 05)
app.get('/user/webhook-logs', async (c) => {
  const uid = c.get('userId');
  const { results } = await c.env.DB.prepare(
    `SELECT id, title, body, parsed_type, status, result_summary, expense_id, created_at
     FROM webhook_logs
     WHERE user_id = ?
     ORDER BY id DESC LIMIT 40`,
  )
    .bind(uid)
    .all();
  return c.json(results);
});

// Reprocessa um log de webhook salvo (Item 05)
app.post('/user/webhook-logs/:id/reprocess', async (c) => {
  const uid = c.get('userId');
  const logId = idParam(c.req.param('id'));
  const log = await c.env.DB.prepare(
    'SELECT id, title, body FROM webhook_logs WHERE id = ? AND user_id = ?',
  )
    .bind(logId, uid)
    .first<{ id: number; title: string; body: string }>();

  if (!log) bad('Log de webhook não encontrado', 404);

  const parsed = parseNubankNotification(log.title, log.body);
  if (parsed.title) parsed.title = cleanEstablishmentName(parsed.title);

  if (parsed.type === 'ignore' || parsed.amount_cents <= 0) {
    bad(`Não foi possível extrair valor válido deste log (${parsed.description || 'ignorado'})`);
  }

  const today = getTodayBrasilia();

  // Auto-categorização inteligente por histórico do usuário (Item 03)
  const learned = await c.env.DB.prepare(
    'SELECT category_id FROM expenses WHERE user_id = ? AND lower(title) = lower(?) ORDER BY id DESC LIMIT 1',
  )
    .bind(uid, parsed.title)
    .first<{ category_id: number }>();

  const categories = await c.env.DB.prepare('SELECT id, name FROM categories WHERE user_id = ?')
    .bind(uid)
    .all<{ id: number; name: string }>();

  let matchedCat = learned
    ? categories.results.find((cat) => cat.id === learned.category_id)
    : undefined;
  if (!matchedCat) {
    const targetCategoryHint = (parsed.category_hint || 'OUTROS').toUpperCase();
    matchedCat =
      categories.results.find((cat) => cat.name.toUpperCase() === targetCategoryHint) ||
      categories.results.find((cat) => cat.name.toUpperCase() === 'OUTROS') ||
      categories.results[0];
  }
  const categoryId = matchedCat?.id ?? 1;

  const { id: expId } = (await c.env.DB.prepare(
    `INSERT INTO expenses (user_id, category_id, amount_cents, title, description, spent_on, payment_method, account_id, installment_current, installment_total)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'nubank', 1, 1) RETURNING id`,
  )
    .bind(uid, categoryId, parsed.amount_cents, parsed.title, parsed.description, today, parsed.payment_method)
    .first<{ id: number }>())!;

  const summary = `Reprocessado: ${parsed.title} — R$ ${(parsed.amount_cents / 100).toFixed(2).replace('.', ',')} (${matchedCat?.name || 'Outros'})`;
  await c.env.DB.prepare(
    `UPDATE webhook_logs SET status = 'processed', result_summary = ?, expense_id = ? WHERE id = ?`,
  )
    .bind(summary, expId, log.id)
    .run();

  return c.json({ ok: true, expense_id: expId, summary });
});

// Endpoint receptor público autenticado por Token de Webhook
app.post('/integrations/nubank', async (c) => {
  const ip = getClientIp(c);

  // Rate limit para prevenir força bruta no token de webhook
  await checkRateLimit(c.env.DB, {
    key: `webhook_flood:${ip}`,
    maxPoints: 120,
    windowMs: 60_000,
    blockDurationMs: 60_000,
    errorMessage: 'Muitas requisições de webhook. Aguarde um instante.',
  });

  const authHeader = c.req.header('Authorization');
  let token: string | undefined = c.req.header('X-Api-Key') || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined);
  if (!token) token = c.req.query('token') || undefined;

  const rawData: Record<string, any> = (await body(c).catch(() => ({}))) as Record<string, any>;
  if (!token && typeof rawData.token === 'string') {
    token = rawData.token;
  }

  if (!token || typeof token !== 'string' || token.length < 16) {
    await logSecurityEvent(c.env.DB, c, 'WEBHOOK_UNAUTHORIZED', 'Tentativa de webhook sem token ou com token curto');
    return c.json({ error: 'Token de autenticação não fornecido ou inválido' }, 401);
  }

  // Buscar usuário dono do webhook_token
  const user = await c.env.DB.prepare(
    'SELECT id, username, is_active FROM users WHERE webhook_token = ?'
  )
    .bind(token)
    .first<{ id: number; username: string; is_active: number }>();

  if (!user || user.is_active === 0) {
    await logSecurityEvent(c.env.DB, c, 'WEBHOOK_TOKEN_INVALID', `Token inválido tentou webhook: ${token.slice(0, 10)}...`);
    return c.json({ error: 'Token de integração inválido ou conta inativa' }, 401);
  }

  // Se for ping de teste
  if (rawData.test === true || rawData.ping === true) {
    return c.json({
      ok: true,
      status: 'pong',
      message: `Conexão bem-sucedida para o usuário ${user.username}! Capi Finance pronto para receber notificações.`,
    });
  }

  // Obter texto e título da notificação
  const title = String(rawData.title || rawData.notification_title || rawData.header || '').trim();
  const text = String(rawData.text || rawData.notification_text || rawData.message || rawData.content || '').trim();
  const today = getTodayBrasilia();

  // Item 07: Chave de Idempotência (evita duplicatas se o MacroDroid reenviar por oscilação de sinal)
  const dedupHash = await sha256(`${user.id}:${title}:${text}:${today}`);
  const recentDupLog = await c.env.DB.prepare(
    `SELECT id, expense_id, result_summary FROM webhook_logs
     WHERE user_id = ? AND dedup_hash = ? AND status = 'processed' AND created_at > datetime('now', '-3 minutes')
     LIMIT 1`,
  )
    .bind(user.id, dedupHash)
    .first<{ id: number; expense_id: number | null; result_summary: string }>();

  if (recentDupLog) {
    await c.env.DB.prepare(
      `INSERT INTO webhook_logs (user_id, title, body, dedup_hash, parsed_type, status, result_summary, expense_id)
       VALUES (?, ?, ?, ?, 'duplicate', 'duplicate', 'Ignorado por chave de idempotência (envio duplicado)', ?)`,
    )
      .bind(user.id, title.slice(0, 150), text.slice(0, 300), dedupHash, recentDupLog.expense_id)
      .run();

    return c.json({
      ok: true,
      action: 'ignored_duplicate',
      message: 'Notificação idêntica já processada recentemente (Idempotência)',
      expense_id: recentDupLog.expense_id,
    });
  }

  // Parsing do evento Nubank
  const parsed = parseNubankNotification(title, text);

  // Log de diagnóstico em tempo real
  await logSecurityEvent(
    c.env.DB,
    c,
    'WEBHOOK_DEBUG',
    `Recebido: title="${title}" | text="${text}" | parsed=${parsed.type} R$ ${(parsed.amount_cents / 100).toFixed(2)}`,
    user.id,
  );

  // Sobrescrever se vier explícito
  if (typeof rawData.amount_cents === 'number' && rawData.amount_cents > 0) {
    parsed.amount_cents = rawData.amount_cents;
  }
  if (typeof rawData.title === 'string' && rawData.title.trim() && parsed.title === 'Compra Nubank') {
    parsed.title = cleanEstablishmentName(rawData.title.trim()) || 'Compra Nubank';
  }
  if (parsed.title) {
    parsed.title = cleanEstablishmentName(parsed.title);
  }

  if (parsed.type === 'ignore' || parsed.amount_cents <= 0) {
    const reason = parsed.description || 'Notificação sem valor financeiro ou ignorada por regra';
    await c.env.DB.prepare(
      `INSERT INTO webhook_logs (user_id, title, body, dedup_hash, parsed_type, status, result_summary)
       VALUES (?, ?, ?, ?, 'ignore', 'ignored', ?)`,
    )
      .bind(user.id, title.slice(0, 150), text.slice(0, 300), dedupHash, reason.slice(0, 200))
      .run();

    return c.json({
      ok: true,
      action: 'ignored',
      reason,
      raw_text: parsed.raw_text,
    });
  }

  // Item 02: Estorno / Reembolso Automático
  if (parsed.type === 'refund') {
    const matchingExpense = await c.env.DB.prepare(
      `SELECT id, title, amount_cents FROM expenses
       WHERE user_id = ? AND amount_cents = ?
       ORDER BY id DESC LIMIT 1`,
    )
      .bind(user.id, parsed.amount_cents)
      .first<{ id: number; title: string; amount_cents: number }>();

    if (matchingExpense) {
      await c.env.DB.prepare('DELETE FROM expenses WHERE id = ? AND user_id = ?')
        .bind(matchingExpense.id, user.id)
        .run();

      const summary = `Estorno automático: lançamento "${matchingExpense.title}" (R$ ${(parsed.amount_cents / 100).toFixed(2).replace('.', ',')}) revertido!`;
      await c.env.DB.prepare(
        `INSERT INTO webhook_logs (user_id, title, body, dedup_hash, parsed_type, status, result_summary, expense_id)
         VALUES (?, ?, ?, ?, 'refund', 'processed', ?, ?)`,
      )
        .bind(user.id, title.slice(0, 150), text.slice(0, 300), dedupHash, summary, matchingExpense.id)
        .run();

      return c.json({
        ok: true,
        action: 'refund_reverted',
        message: summary,
        reverted_expense_id: matchingExpense.id,
      });
    } else {
      const { id: inflowId } = (await c.env.DB.prepare(
        `INSERT INTO inflows (user_id, account_id, amount_cents, description, received_on)
         VALUES (?, 'nubank', ?, ?, ?) RETURNING id`,
      )
        .bind(user.id, parsed.amount_cents, `Estorno/Reembolso: ${parsed.title}`, today)
        .first<{ id: number }>())!;

      const summary = `Estorno creditado como entrada: R$ ${(parsed.amount_cents / 100).toFixed(2).replace('.', ',')}`;
      await c.env.DB.prepare(
        `INSERT INTO webhook_logs (user_id, title, body, dedup_hash, parsed_type, status, result_summary)
         VALUES (?, ?, ?, ?, 'refund', 'processed', ?)`,
      )
        .bind(user.id, title.slice(0, 150), text.slice(0, 300), dedupHash, summary)
        .run();

      return c.json({
        ok: true,
        action: 'refund_credited',
        inflow_id: inflowId,
        message: summary,
      });
    }
  }

  // Anti-duplicação nos últimos 120 segundos
  if (parsed.type === 'expense') {
    const existing = await c.env.DB.prepare(
      `SELECT id FROM expenses
       WHERE user_id = ? AND amount_cents = ? AND title = ? AND created_at > datetime('now', '-2 minutes')`
    )
      .bind(user.id, parsed.amount_cents, parsed.title)
      .first<{ id: number }>();

    if (existing) {
      return c.json({
        ok: true,
        action: 'ignored_duplicate',
        message: 'Lançamento já registrado recentemente (anti-duplicação)',
        expense_id: existing.id,
      });
    }

    // Item 03: Auto-categorização inteligente baseada no histórico do próprio usuário
    const learned = await c.env.DB.prepare(
      'SELECT category_id FROM expenses WHERE user_id = ? AND lower(title) = lower(?) ORDER BY id DESC LIMIT 1',
    )
      .bind(user.id, parsed.title)
      .first<{ category_id: number }>();

    const categories = await c.env.DB.prepare(
      'SELECT id, name FROM categories WHERE user_id = ?'
    )
      .bind(user.id)
      .all<{ id: number; name: string }>();

    let matchedCat = learned
      ? categories.results.find((cat) => cat.id === learned.category_id)
      : undefined;

    if (!matchedCat) {
      const targetCategoryHint = (parsed.category_hint || 'OUTROS').toUpperCase();
      matchedCat = categories.results.find((cat) => cat.name.toUpperCase() === targetCategoryHint);
      if (!matchedCat) {
        matchedCat = categories.results.find((cat) => cat.name.toUpperCase() === 'OUTROS') || categories.results[0];
      }
    }
    const categoryId = matchedCat?.id ?? 1;
    const formattedAmount = `R$ ${(parsed.amount_cents / 100).toFixed(2).replace('.', ',')}`;
    const notificationMsg = `Compra de ${formattedAmount} em ${parsed.title} lançada em ${matchedCat?.name || 'Outros'}!`;

    // Inserção da despesa à vista
    if (parsed.installments <= 1) {
      const { id } = (await c.env.DB.prepare(
        `INSERT INTO expenses (user_id, category_id, amount_cents, title, description, spent_on, payment_method, account_id, installment_current, installment_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'nubank', 1, 1) RETURNING id`
      )
        .bind(
          user.id,
          categoryId,
          parsed.amount_cents,
          parsed.title,
          parsed.description,
          today,
          parsed.payment_method
        )
        .first<{ id: number }>())!;

      await c.env.DB.prepare(
        `INSERT INTO webhook_logs (user_id, title, body, dedup_hash, parsed_type, status, result_summary, expense_id)
         VALUES (?, ?, ?, ?, 'expense', 'processed', ?, ?)`,
      )
        .bind(user.id, title.slice(0, 150), text.slice(0, 300), dedupHash, notificationMsg, id)
        .run();

      await logSecurityEvent(c.env.DB, c, 'WEBHOOK_NUBANK_EXPENSE', `Despesa automática: ${parsed.title} (${formattedAmount})`, user.id);

      return c.json({
        ok: true,
        action: 'expense_created',
        notification_message: notificationMsg,
        data: {
          id,
          title: parsed.title,
          amount_cents: parsed.amount_cents,
          amount_formatted: formattedAmount,
          category: matchedCat?.name,
          learned_from_history: Boolean(learned),
          payment_method: parsed.payment_method,
          spent_on: today,
        },
      }, 201);
    } else {
      // Parcelado em N vezes
      const groupId = randomToken();
      const baseInstallment = Math.floor(parsed.amount_cents / parsed.installments);
      const remainder = parsed.amount_cents % parsed.installments;

      const statements: D1PreparedStatement[] = [];
      for (let i = 1; i <= parsed.installments; i++) {
        const instAmount = i === 1 ? baseInstallment + remainder : baseInstallment;
        const instDate = addMonthsToDate(today, i - 1);
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO expenses (user_id, category_id, amount_cents, title, description, spent_on, payment_method, account_id, installment_current, installment_total, installment_group_id)
             VALUES (?, ?, ?, ?, ?, ?, 'credit', 'nubank', ?, ?, ?)`
          ).bind(
            user.id,
            categoryId,
            instAmount,
            parsed.title,
            parsed.description,
            instDate,
            i,
            parsed.installments,
            groupId
          )
        );
      }
      await c.env.DB.batch(statements);

      await c.env.DB.prepare(
        `INSERT INTO webhook_logs (user_id, title, body, dedup_hash, parsed_type, status, result_summary)
         VALUES (?, ?, ?, ?, 'expense_installments', 'processed', ?)`,
      )
        .bind(user.id, title.slice(0, 150), text.slice(0, 300), dedupHash, `${notificationMsg} (${parsed.installments}x)`)
      .run();

      await logSecurityEvent(c.env.DB, c, 'WEBHOOK_NUBANK_EXPENSE_PARCELADO', `Despesa parcelada (${parsed.installments}x): ${parsed.title}`, user.id);

      return c.json({
        ok: true,
        action: 'expense_installment_created',
        notification_message: `${notificationMsg} (${parsed.installments}x)`,
        data: {
          title: parsed.title,
          installments: parsed.installments,
          total_amount_formatted: formattedAmount,
          first_installment_formatted: `R$ ${((baseInstallment + remainder) / 100).toFixed(2).replace('.', ',')}`,
          category: matchedCat?.name,
          spent_on: today,
        },
      }, 201);
    }
  }

  if (parsed.type === 'inflow') {
    const existingInflow = await c.env.DB.prepare(
      `SELECT id FROM inflows
       WHERE user_id = ? AND amount_cents = ? AND description = ? AND created_at > datetime('now', '-2 minutes')`
    )
      .bind(user.id, parsed.amount_cents, parsed.description)
      .first<{ id: number }>();

    if (existingInflow) {
      return c.json({
        ok: true,
        action: 'ignored_duplicate',
        message: 'Entrada já registrada recentemente (anti-duplicação)',
        inflow_id: existingInflow.id,
      });
    }

    const { id } = (await c.env.DB.prepare(
      `INSERT INTO inflows (user_id, account_id, amount_cents, description, received_on)
       VALUES (?, 'nubank', ?, ?, ?) RETURNING id`
    )
      .bind(user.id, parsed.amount_cents, parsed.description, today)
      .first<{ id: number }>())!;

    const inflowSummary = `Entrada recebida: R$ ${(parsed.amount_cents / 100).toFixed(2).replace('.', ',')} (${parsed.title})`;
    await c.env.DB.prepare(
      `INSERT INTO webhook_logs (user_id, title, body, dedup_hash, parsed_type, status, result_summary)
       VALUES (?, ?, ?, ?, 'inflow', 'processed', ?)`,
    )
      .bind(user.id, title.slice(0, 150), text.slice(0, 300), dedupHash, inflowSummary)
      .run();

    await logSecurityEvent(c.env.DB, c, 'WEBHOOK_NUBANK_INFLOW', `Entrada automática: R$ ${(parsed.amount_cents / 100).toFixed(2)}`, user.id);

    return c.json({
      ok: true,
      action: 'inflow_created',
      notification_message: inflowSummary,
      data: {
        id,
        amount_cents: parsed.amount_cents,
        amount_formatted: `R$ ${(parsed.amount_cents / 100).toFixed(2).replace('.', ',')}`,
        description: parsed.description,
        received_on: today,
      },
    }, 201);
  }

  return c.json({ ok: false, message: 'Tipo não processável' }, 400);
});

export default app;
