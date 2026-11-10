// Cliente SMTP nativo sobre TLS Socket (Cloudflare Workers connect())
import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();

function toBase64(str: string): string {
  const bytes = enc.encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function sendEmail({
  to,
  subject,
  html,
  smtpUser,
  smtpPass,
}: {
  to: string;
  subject: string;
  html: string;
  smtpUser: string;
  smtpPass: string;
}) {
  // Conexão direta TLS na porta 465 (SMTPS)
  const socket = connect(
    {
      hostname: 'smtp.gmail.com',
      port: 465,
    },
    {
      secureTransport: 'on',
      allowHalfOpen: false,
    },
  );

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  let buffer = '';

  async function readResponse(timeoutMs = 12000): Promise<string> {
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Tempo esgotado aguardando resposta do servidor de e-mail')), timeoutMs),
    );

    const readLoop = async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += dec.decode(value, { stream: true });
        if (buffer.includes('\r\n')) {
          const lines = buffer.split('\r\n');
          const lastLine = lines[lines.length - 2]; // última linha completa
          // Código SMTP seguido de espaço indica última linha da resposta
          if (/^\d{3}\s/.test(lastLine)) {
            const resp = buffer;
            buffer = '';
            return resp;
          }
        }
      }
      const resp = buffer;
      buffer = '';
      return resp;
    };

    return Promise.race([readLoop(), timeoutPromise]);
  }

  async function sendCommand(cmd: string, expectedCode?: string) {
    await writer.write(enc.encode(cmd + '\r\n'));
    const resp = await readResponse();
    if (expectedCode && !resp.startsWith(expectedCode)) {
      const summary = cmd.length > 30 ? cmd.slice(0, 30) + '...' : cmd;
      throw new Error(`SMTP Error [${summary}]: ${resp.trim()}`);
    }
    return resp;
  }

  try {
    // 1. Saudação do servidor (220 smtp.gmail.com ...)
    await readResponse();

    // 2. EHLO
    await sendCommand('EHLO localhost', '250');

    // 3. AUTH LOGIN
    await sendCommand('AUTH LOGIN', '334');
    await sendCommand(toBase64(smtpUser), '334');
    await sendCommand(toBase64(smtpPass), '235');

    // 4. Remetente e Destinatário
    await sendCommand(`MAIL FROM:<${smtpUser}>`, '250');
    await sendCommand(`RCPT TO:<${to}>`, '250');

    // 5. Envio do corpo do e-mail (DATA)
    await sendCommand('DATA', '354');

    const base64Body = toBase64(html).match(/.{1,76}/g)?.join('\r\n') || '';

    const emailBody = [
      `From: "Capi Finance" <${smtpUser}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${toBase64(subject)}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Body,
      '.',
    ].join('\r\n');

    await sendCommand(emailBody, '250');
    await sendCommand('QUIT');
  } finally {
    try {
      reader.releaseLock();
      writer.releaseLock();
      socket.close();
    } catch {}
  }
}
