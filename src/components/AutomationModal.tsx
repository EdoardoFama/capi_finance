import { useState, useEffect } from 'react';
import {
  getWebhookToken,
  regenerateWebhookToken,
  getWebhookLogs,
  reprocessWebhookLog,
  type WebhookTokenResponse,
  type WebhookLog,
} from '../api';
import { useConfirm, useToast } from '../context';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function AutomationModal({ isOpen, onClose }: Props) {
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<'setup' | 'logs'>('setup');
  const [data, setData] = useState<WebhookTokenResponse | null>(null);
  const [logs, setLogs] = useState<WebhookLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  function loadLogs() {
    setLoadingLogs(true);
    getWebhookLogs()
      .then((res) => setLogs(res))
      .catch(() => {})
      .finally(() => setLoadingLogs(false));
  }

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      setTestResult(null);
      getWebhookToken()
        .then((res) => setData(res))
        .catch((err) => console.error(err))
        .finally(() => setLoading(false));
      loadLogs();
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
        title: '[not_title]',
        text: '[notification]',
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
    } catch {
      setTestResult('❌ Erro de conexão com o servidor.');
    } finally {
      setTesting(false);
    }
  }

  async function handleReprocess(logId: number) {
    setReprocessingId(logId);
    try {
      const res = await reprocessWebhookLog(logId);
      toast(res.summary || 'Notificação reprocessada com sucesso!');
      loadLogs();
    } catch (err) {
      toast((err as Error).message || 'Erro ao reprocessar log', 'error');
    } finally {
      setReprocessingId(null);
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
                Automação Inteligente Nubank
                <span className="rounded-full bg-purple-500/15 border border-purple-500/30 px-2 py-0.5 text-[10px] font-semibold text-purple-300">
                  v2.0 Smart
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                Aprendizado de categorias, detecção de estorno, filtro de conta própria e idempotência
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

        {/* Abas */}
        <div className="mt-4 flex rounded-xl border border-white/10 bg-zinc-900/70 p-1 text-xs">
          <button
            type="button"
            onClick={() => setTab('setup')}
            className={`flex-1 rounded-lg py-1.5 font-bold transition ${
              tab === 'setup' ? 'bg-purple-600 text-white shadow' : 'text-zinc-400 hover:text-white'
            }`}
          >
            ⚙️ Configuração & Regras
          </button>
          <button
            type="button"
            onClick={() => {
              setTab('logs');
              loadLogs();
            }}
            className={`flex-1 rounded-lg py-1.5 font-bold transition flex items-center justify-center gap-1.5 ${
              tab === 'logs' ? 'bg-purple-600 text-white shadow' : 'text-zinc-400 hover:text-white'
            }`}
          >
            <span>📋 Logs de Recebimento</span>
            <span className="rounded-full bg-black/40 px-1.5 py-0.2 text-[10px]">{logs.length}</span>
          </button>
        </div>

        {tab === 'setup' ? (
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

            {/* Inteligência Ativa */}
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-2.5">
                <p className="font-bold text-emerald-300">🧠 Auto-Categorização</p>
                <p className="text-zinc-400 mt-0.5">
                  Aprende automaticamente com as categorias que você escolheu antes para o mesmo estabelecimento.
                </p>
              </div>
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-950/20 p-2.5">
                <p className="font-bold text-cyan-300">↩️ Estorno Automático</p>
                <p className="text-zinc-400 mt-0.5">
                  Detecta reembolsos e compras estornadas, revertendo o gasto sem duplicar saldo.
                </p>
              </div>
              <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-2.5">
                <p className="font-bold text-amber-300">🔄 Filtro Mesma Titularidade</p>
                <p className="text-zinc-400 mt-0.5">
                  Ignora transferências entre suas próprias contas para não inflar gastos ou receitas.
                </p>
              </div>
              <div className="rounded-xl border border-purple-500/20 bg-purple-950/20 p-2.5">
                <p className="font-bold text-purple-300">🛡️ Chave de Idempotência</p>
                <p className="text-zinc-400 mt-0.5">
                  Bloqueia envios repetidos se a internet oscilar no momento da notificação.
                </p>
              </div>
            </div>

            {/* Passo a Passo */}
            <div className="space-y-2.5 text-xs text-zinc-300">
              <div className="flex items-start gap-3 rounded-xl border border-white/5 bg-zinc-900/40 p-3">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-purple-500/20 text-purple-300 font-bold text-[11px]">
                  1
                </span>
                <div className="w-full">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-white">Corpo JSON no MacroDroid (POST):</p>
                    <button
                      onClick={handleCopyPayload}
                      className="text-[10px] text-purple-400 hover:text-purple-300 underline font-semibold"
                    >
                      {copiedPayload ? '✓ Copiado!' : 'Copiar JSON'}
                    </button>
                  </div>
                  <pre className="mt-1.5 rounded-lg bg-black p-2 font-mono text-[10px] text-emerald-300">
{`{
  "title": "[not_title]",
  "text": "[notification]"
}`}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs text-zinc-400">
                Últimas notificações recebidas pelo servidor (com opção de reprocessar):
              </p>
              <button
                type="button"
                onClick={loadLogs}
                className="text-xs font-bold text-purple-400 hover:text-purple-300"
              >
                ↻ Atualizar
              </button>
            </div>

            {loadingLogs ? (
              <p className="py-8 text-center text-xs text-zinc-500">Carregando histórico de webhooks...</p>
            ) : logs.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 p-6 text-center text-xs text-zinc-500">
                Nenhuma notificação registrada ainda nos logs recentes.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="rounded-2xl border border-white/[0.08] bg-zinc-900/60 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                          log.status === 'processed'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                            : log.status === 'duplicate'
                            ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                            : 'bg-zinc-800 text-zinc-400 border-white/10'
                        }`}
                      >
                        {log.status === 'processed'
                          ? '✓ Processado'
                          : log.status === 'duplicate'
                          ? '🛡️ Idempotência (Duplicado)'
                          : 'Ignorado'}
                      </span>
                      <span className="text-[10px] text-zinc-500 tabular-nums">{log.created_at}</span>
                    </div>

                    <p className="font-bold text-zinc-200">{log.title || '(Sem título)'}</p>
                    <p className="text-[11px] text-zinc-400 break-words">{log.body}</p>

                    <div className="flex items-center justify-between pt-1.5 border-t border-white/[0.05]">
                      <span className="text-[11px] text-emerald-400/90 font-medium truncate">
                        {log.result_summary}
                      </span>
                      <button
                        type="button"
                        disabled={reprocessingId === log.id}
                        onClick={() => handleReprocess(log.id)}
                        className="shrink-0 rounded-lg border border-purple-500/30 bg-purple-500/15 px-2.5 py-1 text-[10px] font-bold text-purple-300 hover:bg-purple-500/25 transition disabled:opacity-50"
                      >
                        {reprocessingId === log.id ? 'Reprocessando...' : '↻ Reprocessar'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 flex justify-end pt-4 border-t border-white/10">
          <button
            onClick={onClose}
            className="rounded-xl bg-zinc-800 hover:bg-zinc-700 px-5 py-2 text-xs font-bold text-white transition"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
