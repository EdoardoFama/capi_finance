import { useState, useEffect } from 'react';
import { getWebhookToken, regenerateWebhookToken, type WebhookTokenResponse } from '../api';
import { useConfirm } from '../context';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function AutomationModal({ isOpen, onClose }: Props) {
  const confirm = useConfirm();
  const [data, setData] = useState<WebhookTokenResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setTestResult(null);
      getWebhookToken()
        .then((res) => setData(res))
        .catch((err) => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleCopy() {
    if (!data?.webhook_url) return;
    await navigator.clipboard.writeText(data.webhook_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  async function handleCopyPayload() {
    const jsonTemplate = JSON.stringify(
      {
        title: '{not_title}',
        text: '{not_body}',
      },
      null,
      2,
    );
    await navigator.clipboard.writeText(jsonTemplate);
    setCopiedPayload(true);
    setTimeout(() => setCopiedPayload(false), 2500);
  }

  async function handleRegenerate() {
    const ok = await confirm({
      title: 'Regenerar Chave de Webhook?',
      message:
        'Se você já tiver configurado o MacroDroid no celular, precisará atualizar a URL com a nova chave.',
      confirmText: 'Regenerar',
      cancelText: 'Cancelar',
      variant: 'warning',
    });
    if (!ok) return;

    setLoading(true);
    try {
      const res = await regenerateWebhookToken();
      setData(res);
      setTestResult(null);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  async function handleTest() {
    if (!data?.webhook_url) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(data.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: true }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setTestResult('✅ Conexão validada com sucesso! Endpoint pronto para receber eventos.');
      } else {
        setTestResult(`❌ Erro no teste: ${json.error || 'Falha na resposta'}`);
      }
    } catch (err) {
      setTestResult('❌ Erro de conexão com o servidor.');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-500/20 to-purple-900/40 border border-purple-500/30 text-purple-300 text-lg shadow-inner">
              ⚡
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Automação Nubank
                <span className="rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                  MacroDroid
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Seus gastos do Nubank lançados automaticamente no segundo em que acontecem
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-400 hover:bg-zinc-900 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="mt-5 space-y-5">
          {/* Webhook URL Box */}
          <div className="rounded-2xl border border-white/10 bg-zinc-900/60 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-300">Sua URL de Webhook Exclusiva:</span>
              <button
                onClick={handleRegenerate}
                disabled={loading}
                className="text-[11px] text-zinc-400 hover:text-zinc-200 underline transition"
              >
                Regenerar Token
              </button>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={loading ? 'Carregando token...' : data?.webhook_url || ''}
                className="flex-1 rounded-xl border border-white/10 bg-black/60 px-3 py-2 text-xs font-mono text-zinc-300 focus:outline-none"
              />
              <button
                onClick={handleCopy}
                disabled={loading || !data?.webhook_url}
                className={`shrink-0 rounded-xl px-3 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
                  copied
                    ? 'bg-emerald-500 text-black'
                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20 active:scale-95'
                }`}
              >
                {copied ? '✓ Copiado!' : 'Copiar URL'}
              </button>
            </div>

            {/* Test button & status */}
            <div className="flex items-center justify-between pt-1">
              <button
                onClick={handleTest}
                disabled={testing || !data?.webhook_url}
                className="text-xs font-semibold text-purple-400 hover:text-purple-300 transition flex items-center gap-1.5"
              >
                {testing ? 'Testando conexão...' : '⚡ Testar Conexão com Endpoint'}
              </button>
              {testResult && (
                <span className="text-[11px] font-medium text-zinc-300">{testResult}</span>
              )}
            </div>
          </div>

          {/* Passo a Passo */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              Passo a Passo Rápido (3 minutos no Android)
            </h3>

            <div className="space-y-2.5 text-xs text-zinc-300">
              {/* Passo 1 */}
              <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-purple-300 font-bold text-[11px]">
                  1
                </span>
                <div>
                  <p className="font-semibold text-white">Instale o MacroDroid</p>
                  <p className="text-zinc-400 mt-0.5">
                    Baixe gratuitamente na Google Play Store. Ele roda em segundo plano consumindo quase zero bateria.
                  </p>
                </div>
              </div>

              {/* Passo 2 */}
              <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-purple-300 font-bold text-[11px]">
                  2
                </span>
                <div>
                  <p className="font-semibold text-white">Adicione o Gatilho (Trigger)</p>
                  <p className="text-zinc-400 mt-0.5">
                    Toque em <strong className="text-zinc-200">Gatilhos (+)</strong> → <strong className="text-zinc-200">Notificação</strong> → <strong className="text-zinc-200">Notificação Recebida</strong> → Escolha o aplicativo <strong className="text-purple-300">Nubank</strong> (deixe conteúdo em branco ou qualquer).
                  </p>
                </div>
              </div>

              {/* Passo 3 */}
              <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-purple-300 font-bold text-[11px]">
                  3
                </span>
                <div className="w-full">
                  <p className="font-semibold text-white">Adicione a Ação (Action)</p>
                  <p className="text-zinc-400 mt-0.5">
                    Toque em <strong className="text-zinc-200">Ações (+)</strong> → <strong className="text-zinc-200">Conectividade</strong> → <strong className="text-zinc-200">Requisição HTTP</strong>:
                  </p>
                  <ul className="mt-2 space-y-1 text-[11px] text-zinc-400 pl-2 border-l border-white/10">
                    <li>• Método: <strong className="text-white">POST</strong></li>
                    <li>• URL: <strong className="text-purple-300">Cole a URL copiada acima</strong></li>
                    <li>• Tipo de conteúdo (Content Type): <strong className="text-white">application/json</strong></li>
                    <li>
                      <div className="flex items-center justify-between mt-1">
                        <span>• Corpo da requisição (Body):</span>
                        <button
                          onClick={handleCopyPayload}
                          className="text-[10px] text-purple-400 hover:text-purple-300 underline font-semibold"
                        >
                          {copiedPayload ? '✓ Copiado!' : 'Copiar JSON'}
                        </button>
                      </div>
                      <pre className="mt-1 rounded-lg bg-black p-2 font-mono text-[10px] text-emerald-300">
{`{
  "title": "{not_title}",
  "text": "{not_body}"
}`}
                      </pre>
                    </li>
                  </ul>
                </div>
              </div>

              {/* Passo 4 */}
              <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-purple-300 font-bold text-[11px]">
                  4
                </span>
                <div>
                  <p className="font-semibold text-white">Salve a Macro e Pronto!</p>
                  <p className="text-zinc-400 mt-0.5">
                    Toda compra no crédito, débito ou Pix enviado/recebido no Nubank entrará no seu extrato e saldo instantaneamente!
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-zinc-900 px-4 py-2 text-xs font-bold text-white hover:bg-zinc-800 transition"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
