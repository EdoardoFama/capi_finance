import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function usePwaInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    // Verifica se já está rodando em modo standalone (PWA instalado)
    const isStandaloneMode =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((window.navigator as unknown as { standalone?: boolean }).standalone);
    setIsStandalone(isStandaloneMode);

    // Detecta se é iOS / Safari
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent);
    setIsIos(isIosDevice);

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  return { deferredPrompt, isStandalone, isIos };
}

export default function InstallPwaModal({
  isOpen,
  onClose,
  deferredPrompt,
  isIos,
}: {
  isOpen: boolean;
  onClose: () => void;
  deferredPrompt: BeforeInstallPromptEvent | null;
  isIos: boolean;
}) {
  const [installing, setInstalling] = useState(false);

  if (!isOpen) return null;

  async function handleNativeInstall() {
    if (!deferredPrompt) return;
    setInstalling(true);
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        onClose();
      }
    } catch {
      // Ignora erro
    } finally {
      setInstalling(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 p-6 shadow-2xl shadow-black/80">
        <div className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-emerald-500/20 blur-3xl" />

        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-500/30 bg-emerald-500/15 p-1 shadow-inner">
            <img src="/logo.png" alt="Capi Finance" className="h-9 w-9 object-contain" />
          </div>
          <div>
            <h3 className="text-base font-extrabold text-white">Instalar Capi Finance</h3>
            <p className="text-xs text-zinc-400">Tenha o app nativo no seu celular</p>
          </div>
        </div>

        <div className="mt-4 space-y-3 text-xs text-zinc-300">
          <div className="flex items-start gap-2.5 rounded-xl border border-white/[0.06] bg-zinc-900/60 p-3">
            <span className="text-emerald-400 text-base font-bold">⚡</span>
            <div>
              <p className="font-bold text-white">Tela cheia e ultra rápido</p>
              <p className="text-zinc-400 mt-0.5">Abre direto com 1 toque na tela de início, sem barras de navegação do browser.</p>
            </div>
          </div>

          {isIos ? (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3.5 space-y-2">
              <p className="font-bold text-emerald-300">Como instalar no iPhone / iPad (Safari):</p>
              <ol className="list-decimal list-inside space-y-1 text-zinc-300">
                <li>Toque no botão <span className="font-bold text-white">Compartilhar ⬆️</span> na barra inferior do Safari.</li>
                <li>Role para baixo e selecione <span className="font-bold text-white">"Adicionar à Tela de Início" 📲</span>.</li>
                <li>Confirme tocando em <span className="font-bold text-emerald-400">"Adicionar"</span> no topo direito.</li>
              </ol>
            </div>
          ) : (
            <p className="text-zinc-400">
              Instale agora para acessar com um toque e ter a melhor experiência mobile.
            </p>
          )}
        </div>

        <div className="mt-5 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-white/[0.08] bg-zinc-900/60 px-4 py-2.5 text-xs font-medium text-zinc-400 transition hover:bg-zinc-900 hover:text-white"
          >
            Fechar
          </button>

          {!isIos && deferredPrompt && (
            <button
              type="button"
              disabled={installing}
              onClick={handleNativeInstall}
              className="rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 px-4 py-2.5 text-xs font-bold text-black transition hover:brightness-110 shadow-lg shadow-emerald-500/20 active:scale-95 disabled:opacity-50"
            >
              {installing ? 'Instalando…' : 'Instalar no Celular'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
