// Cliente SMTP nativo sobre TLS Socket (Cloudflare Workers connect())
import { connect } from 'cloudflare:sockets';

const enc = new TextEncoder();
const dec = new TextDecoder();

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
  const socket = connect({
    hostname: 'smtp.gmail.com',
    port: 465, // SSL / TLS direto
  });

  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();

  let buffer = '';

  async function readResponse(): Promise<string> {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      if (buffer.includes('\r\n')) {
        const lines = buffer.split('\r\n');
        const lastLine = lines[lines.length - 2]; // última linha completa
        // SMTP: resposta final tem código seguido de espaço (ex: "250 ") ou fim de bloco
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
  }

  async function sendCommand(cmd: string, expectedCode?: string) {
    await writer.write(enc.encode(cmd + '\r\n'));
    const resp = await readResponse();
    if (expectedCode && !resp.startsWith(expectedCode)) {
      throw new Error(`SMTP Error [${cmd}]: ${resp.trim()}`);
    }
    return resp;
  }

  try {
    // 1. Saudação do servidor
    await readResponse();

    // 2. EHLO
    await sendCommand('EHLO localhost', '250');

    // 3. AUTH LOGIN
    await sendCommand('AUTH LOGIN', '334');
    await sendCommand(btoa(smtpUser), '334');
    await sendCommand(btoa(smtpPass), '235');

    // 4. MAIL FROM e RCPT TO
    await sendCommand(`MAIL FROM:<${smtpUser}>`, '250');
    await sendCommand(`RCPT TO:<${to}>`, '250');

    // 5. DATA
    await sendCommand('DATA', '354');

    const emailBody = [
      `From: "Capi Finance" <${smtpUser}>`,
      `To: <${to}>`,
      `Subject: =?UTF-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      btoa(unescape(encodeURIComponent(html))),
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

