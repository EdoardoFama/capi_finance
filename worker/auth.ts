// Criptografia de senhas (PBKDF2-SHA256), AES-256-GCM para dados sensíveis e utilitários constant-time via Web Crypto API.
const enc = new TextEncoder();
const dec = new TextDecoder();

// Limite máximo de senha para prevenir ataque DoS de exaustão de CPU no PBKDF2
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_PASSWORD_LENGTH = 6;

// Hash PBKDF2 pré-computado (100.000 iterações) usado quando o usuário não existe no login
// Garante tempo de resposta idêntico (mitigação de Timing Attack / Enumeração de Usuários)
export const DUMMY_PASSWORD_HASH =
  'pbkdf2$100000$c2FsdHNhbHRzYWx0c2FsdA==$4f8b2c9d1e3a7f6b5c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b';

const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

const fromB64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/**
 * Comparação em tempo constante (Constant-Time Comparison) para evitar ataques de timing.
 */
export function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

export async function timingSafeEqualStr(a: string, b: string): Promise<boolean> {
  const hashA = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(a)));
  const hashB = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(b)));
  return timingSafeEqualBytes(hashA, hashB) && a.length === b.length;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const safePass = password.slice(0, MAX_PASSWORD_LENGTH);
  const key = await crypto.subtle.importKey('raw', enc.encode(safePass), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256),
  );
}

export async function hashPassword(password: string) {
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new Error('Senha excede o tamanho máximo permitido');
  }
  const iterations = 100_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string) {
  if (!password || password.length > MAX_PASSWORD_LENGTH) return false;
  try {
    const [scheme, iter, saltB64, hashB64] = stored.split('$');
    const iterations = Number(iter);
    if (scheme !== 'pbkdf2' || !iterations || iterations < 10_000 || iterations > 500_000 || !saltB64 || !hashB64) {
      return false;
    }
    const expected = fromB64(hashB64);
    const actual = await pbkdf2(password, fromB64(saltB64), iterations);
    return timingSafeEqualBytes(actual, expected);
  } catch {
    return false;
  }
}

export function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256(value: string) {
  return toB64(await crypto.subtle.digest('SHA-256', enc.encode(value)));
}

/**
 * Gera hash SHA-256 com salt de contexto para códigos OTP (nunca salva o código em texto puro no banco).
 */
export async function hashOtpCode(email: string, type: string, code: string): Promise<string> {
  const normalized = `${email.trim().toLowerCase()}:${type}:${code.trim()}`;
  return `otp_sha256$${await sha256(normalized)}`;
}

/**
 * Verifica código OTP em tempo constante (suporta formato com hash e legado).
 */
export async function verifyOtpCode(
  email: string,
  type: string,
  inputCode: string,
  storedCode: string,
): Promise<boolean> {
  if (storedCode.startsWith('otp_sha256$')) {
    const expectedHash = await hashOtpCode(email, type, inputCode);
    return timingSafeEqualStr(expectedHash, storedCode);
  }
  return timingSafeEqualStr(inputCode.trim(), storedCode.trim());
}

/**
 * Criptografia Autenticada AES-256-GCM para proteger payloads sensíveis em repouso no D1.
 */
async function deriveAesKey(secretMaterial: string): Promise<CryptoKey> {
  const keyHash = await crypto.subtle.digest('SHA-256', enc.encode(`capi_aes256_gcm_v1:${secretMaterial}`));
  return crypto.subtle.importKey('raw', keyHash, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPayload(plaintext: string, secretMaterial: string): Promise<string> {
  const key = await deriveAesKey(secretMaterial);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext));
  return `aes256gcm$${toB64(iv)}$${toB64(encrypted)}`;
}

export async function decryptPayload(ciphertext: string, secretMaterial: string): Promise<string> {
  if (!ciphertext.startsWith('aes256gcm$')) {
    // Fallback para registros legados não criptografados
    return ciphertext;
  }
  const parts = ciphertext.split('$');
  if (parts.length !== 3) throw new Error('Payload criptografado inválido');
  const iv = fromB64(parts[1]);
  const data = fromB64(parts[2]);
  const key = await deriveAesKey(secretMaterial);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return dec.decode(decrypted);
}
