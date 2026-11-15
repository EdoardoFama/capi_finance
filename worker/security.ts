import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';

// ============================================================================
// 1. EXTRAÇÃO SEGURA DE IP E USER-AGENT (Cloudflare Edge)
// ============================================================================
export function getClientIp(c: Context): string {
  const cfIp = c.req.header('CF-Connecting-IP');
  if (cfIp) return cfIp.trim().slice(0, 64);
  const xff = c.req.header('X-Forwarded-For');
  if (xff) return xff.split(',')[0].trim().slice(0, 64);
  return '127.0.0.1';
}

export function getUserAgent(c: Context): string {
  return (c.req.header('User-Agent') || 'unknown').trim().slice(0, 250);
}

// ============================================================================
// 2. PROTEÇÃO ANTI-DDOS / FLOOD EM MEMÓRIA (Camada 1 - Zero Custo de Banco)
// ============================================================================
type BurstBucket = { count: number; resetAt: number };
const burstMap = new Map<string, BurstBucket>();
const BURST_WINDOW_MS = 10_000; // 10 segundos
const BURST_MAX_REQUESTS = 80;  // máx 80 reqs / 10s por IP no mesmo isolate

export function checkInMemoryBurst(ip: string, isAuthRoute: boolean): void {
  const now = Date.now();
  // Limpeza rápida se o mapa crescer demais sob ataque de múltiplos IPs
  if (burstMap.size > 5_000) {
    for (const [k, v] of burstMap) {
      if (v.resetAt <= now) burstMap.delete(k);
    }
    if (burstMap.size > 5_000) burstMap.clear();
  }

  const key = isAuthRoute ? `auth:${ip}` : `api:${ip}`;
  const limit = isAuthRoute ? 15 : BURST_MAX_REQUESTS; // rotas de auth: máx 15 reqs em 10s
  const bucket = burstMap.get(key);

  if (!bucket || bucket.resetAt <= now) {
    burstMap.set(key, { count: 1, resetAt: now + BURST_WINDOW_MS });
    return;
  }

  bucket.count += 1;
  if (bucket.count > limit) {
    throw new HTTPException(429, {
      message: 'Muitas requisições simultâneas detectadas. Aguarde alguns segundos e tente novamente.',
    });
  }
}

// ============================================================================
// 3. RATE LIMITING DISTRIBUÍDO NO D1 (Camada 2 - Anti-Brute-Force Persistente)
// ============================================================================
export interface RateLimitOptions {
  key: string;
  maxPoints: number;
  windowMs: number;
  blockDurationMs?: number;
  errorMessage?: string;
}

export async function checkRateLimit(db: D1Database, opts: RateLimitOptions): Promise<void> {
  const now = Date.now();
  const blockMs = opts.blockDurationMs ?? opts.windowMs;

  try {
    const row = await db
      .prepare('SELECT points, window_start, blocked_until FROM rate_limits WHERE key = ?')
      .bind(opts.key)
      .first<{ points: number; window_start: number; blocked_until: number }>();

    if (row) {
      // 1. Verifica se já está bloqueado temporariamente
      if (row.blocked_until > now) {
        const waitSec = Math.max(1, Math.ceil((row.blocked_until - now) / 1000));
        const waitLabel =
          waitSec >= 60 ? `${Math.ceil(waitSec / 60)} minuto(s)` : `${waitSec} segundo(s)`;
        throw new HTTPException(429, {
          message:
            opts.errorMessage ||
            `Limite de tentativas excedido por segurança. Aguarde ${waitLabel} antes de tentar novamente.`,
        });
      }

      // 2. Se ainda está dentro da janela atual, incrementa os pontos
      if (now - row.window_start < opts.windowMs) {
        const nextPoints = row.points + 1;
        const blockedUntil = nextPoints > opts.maxPoints ? now + blockMs : 0;

        await db
          .prepare('UPDATE rate_limits SET points = ?, blocked_until = ? WHERE key = ?')
          .bind(nextPoints, blockedUntil, opts.key)
          .run();

        if (blockedUntil > 0) {
          const waitSec = Math.max(1, Math.ceil(blockMs / 1000));
          const waitLabel =
            waitSec >= 60 ? `${Math.ceil(waitSec / 60)} minuto(s)` : `${waitSec} segundo(s)`;
          throw new HTTPException(429, {
            message:
              opts.errorMessage ||
              `Muitas tentativas seguidas. Acesso temporariamente bloqueado por ${waitLabel}.`,
          });
        }
        return;
      }
    }

    // 3. Nova janela ou registro inexistente
    await db
      .prepare(
        `INSERT INTO rate_limits (key, points, window_start, blocked_until)
         VALUES (?, 1, ?, 0)
         ON CONFLICT(key) DO UPDATE SET points = 1, window_start = excluded.window_start, blocked_until = 0`,
      )
      .bind(opts.key, now)
      .run();
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    // Se a tabela ainda não existir no ambiente local durante migração, ignora erro de banco
  }
}

export async function resetRateLimit(db: D1Database, key: string): Promise<void> {
  try {
    await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
  } catch {}
}

// ============================================================================
// 4. AUDITORIA DE SEGURANÇA (Security Audit Trail)
// ============================================================================
export async function logSecurityEvent(
  db: D1Database,
  c: Context,
  eventType: string,
  details: string,
  userId?: number | null,
): Promise<void> {
  try {
    const ip = getClientIp(c);
    const ua = getUserAgent(c);
    await db
      .prepare(
        `INSERT INTO security_audit_logs (user_id, event_type, ip_address, user_agent, details)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(userId ?? null, eventType.slice(0, 64), ip, ua, details.slice(0, 500))
      .run();

    // Limpeza probabilística (2% das vezes) para não acumular registros expirados
    if (Math.random() < 0.02) {
      const expiredWindow = Date.now() - 24 * 60 * 60 * 1000;
      await db.batch([
        db.prepare('DELETE FROM rate_limits WHERE window_start < ? AND blocked_until < ?').bind(expiredWindow, Date.now()),
        db.prepare('DELETE FROM verification_codes WHERE expires_at < ?').bind(Date.now()),
        db.prepare("DELETE FROM security_audit_logs WHERE created_at < datetime('now', '-90 days')"),
      ]);
    }
  } catch {}
}

// ============================================================================
// 5. CABEÇALHOS HTTP DE SEGURANÇA & PROTEÇÃO CSRF / ORIGIN
// ============================================================================
export function applySecurityHeaders(c: Context): void {
  // Evita MIME-sniffing
  c.header('X-Content-Type-Options', 'nosniff');
  // Bloqueia Clickjacking (iframes externos)
  c.header('X-Frame-Options', 'DENY');
  // Política estrita de Referrer
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Desativa APIs sensíveis do navegador que o app financeiro não usa
  c.header(
    'Permissions-Policy',
    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
  );
  // HSTS: força HTTPS por 1 ano incluindo subdomínios
  c.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  // Content Security Policy para respostas da API
  c.header(
    'Content-Security-Policy',
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  );
  // NUNCA armazenar dados financeiros da API em cache de navegador ou proxy compartilhado
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, private');
  c.header('Pragma', 'no-cache');
  c.header('Expires', '0');
}

export function verifyCsrfAndOrigin(c: Context): void {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;

  // Webhooks e integrações externas autenticadas por Token / API Key
  if (c.req.path.startsWith('/api/integrations/')) return;

  // 1. Verifica Sec-Fetch-Site quando enviado por navegadores modernos
  const secFetchSite = c.req.header('Sec-Fetch-Site');
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    throw new HTTPException(403, {
      message: 'Requisição cross-site bloqueada pela proteção CSRF (Sec-Fetch-Site).',
    });
  }

  // 2. Verifica se Origin ou Referer batem com o Host da aplicação
  const host = c.req.header('Host') || c.req.header('X-Forwarded-Host');
  const origin = c.req.header('Origin');
  const referer = c.req.header('Referer');

  if (host) {
    if (origin && origin !== 'null') {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          throw new HTTPException(403, {
            message: 'Origem da requisição não autorizada (CSRF Origin mismatch).',
          });
        }
      } catch (e) {
        if (e instanceof HTTPException) throw e;
        throw new HTTPException(403, { message: 'Cabeçalho Origin inválido.' });
      }
    } else if (referer) {
      try {
        const refererHost = new URL(referer).host;
        if (refererHost !== host) {
          throw new HTTPException(403, {
            message: 'Referer da requisição não autorizado (CSRF Referer mismatch).',
          });
        }
      } catch (e) {
        if (e instanceof HTTPException) throw e;
      }
    }
  }
}
