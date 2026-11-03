import { Brain, Download, Share, Smartphone, X } from 'lucide-react';
import { usePwaInstall } from './usePwaInstall';

// Phones: the offer to install MindSift as an app, with the manual steps when the browser has no prompt
export function PwaInstallSheet({
  pwa,
  instanceName,
}: {
  pwa: ReturnType<typeof usePwaInstall>;
  instanceName?: string;
}) {
  const { isStandaloneApp, deferredPwaPrompt, showPwaInstallModal, showManualPwaGuide, handleInstallWebApp, handleDismissPwaModal } = pwa;
  if (!showPwaInstallModal || isStandaloneApp) return null;
  return (
    <div
      className="sm:hidden fixed inset-0 !m-0 z-50 flex items-end justify-center bg-black/65 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={handleDismissPwaModal}
    >
      <div
        className="w-full bg-panel border-t border-border rounded-t-2xl shadow-panel p-5 pb-[calc(1.75rem+env(safe-area-inset-bottom))] space-y-4 animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-accent text-on-accent shadow-md flex items-center justify-center flex-shrink-0">
              <Brain className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-main leading-tight">
                {instanceName || 'MindSift'} als App installieren
              </h3>
              <p className="text-xs text-muted mt-0.5">
                Vollbild ohne Browser-Leiste, schnellerer Start & Direktzugriff vom Home-Bildschirm.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleDismissPwaModal}
            className="p-1.5 text-faint hover:text-main rounded-btn cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {!showManualPwaGuide ? (
          <div className="space-y-2.5 pt-1">
            <button
              type="button"
              onClick={handleInstallWebApp}
              className="btn-primary w-full h-12 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 shadow-md active:scale-98 transition-transform cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Jetzt als Web-App installieren</span>
            </button>
            <button
              type="button"
              onClick={handleDismissPwaModal}
              className="btn-action w-full h-10 text-xs rounded-xl justify-center cursor-pointer"
            >
              Später im Browser weiter nutzen
            </button>
          </div>
        ) : (
          <div className="space-y-3 pt-1">
            {/* Chrome may report "installable" only after the guide opened (e.g. shortly after the
                old app was removed): then the real install is one tap away again */}
            {deferredPwaPrompt && (
              <button
                type="button"
                onClick={handleInstallWebApp}
                className="btn-primary w-full h-12 text-sm font-semibold rounded-xl flex items-center justify-center gap-2 shadow-md active:scale-98 transition-transform cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Jetzt installieren</span>
              </button>
            )}
            <div className="p-3.5 rounded-xl bg-canvas border border-border space-y-2.5 text-xs text-main">
              <p className="font-semibold text-accent flex items-center gap-1.5">
                <Smartphone className="w-4 h-4" />
                <span>In 2 Sekunden zum Home-Bildschirm hinzufügen:</span>
              </p>
              <ol className="space-y-2 text-muted list-decimal list-inside">
                <li>
                  Tippe im Browser auf{' '}
                  <strong className="text-main inline-flex items-center gap-1">
                    <Share className="w-3.5 h-3.5 text-accent inline" /> Teilen
                  </strong>{' '}
                  (iPhone/Safari) oder das{' '}
                  <strong className="text-main">Browser-Menü (⋮)</strong>.
                </li>
                <li>
                  Wähle{' '}
                  <strong className="text-main">„Zum Home-Bildschirm“</strong> bzw.{' '}
                  <strong className="text-main">„App installieren“</strong>.
                </li>
              </ol>
            </div>
            <button
              type="button"
              onClick={handleDismissPwaModal}
              className="btn-primary w-full h-11 text-xs font-semibold rounded-xl justify-center cursor-pointer"
            >
              Verstanden
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
