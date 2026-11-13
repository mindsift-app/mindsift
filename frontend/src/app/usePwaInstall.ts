import { useEffect, useState } from 'react';
import { triggerHaptic } from '../lib/api';
import { isPhoneWidth } from '../lib/breakpoints';

// Installing MindSift as a web app (PWA): whether it already runs installed, the browser's install
// prompt (kept on window by public/pwa-install.js when it fires before the app is ready), the offer
// sheet on phones and the manual guide when the browser offers no prompt
export function usePwaInstall(userId: string | undefined) {
  const [isStandaloneApp, setIsStandaloneApp] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true
    );
  });
  const [deferredPwaPrompt, setDeferredPwaPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    typeof window !== 'undefined' ? window.__deferredPwaPrompt || null : null
  );
  const [showPwaInstallModal, setShowPwaInstallModal] = useState(false);
  const [showManualPwaGuide, setShowManualPwaGuide] = useState(false);

  useEffect(() => {
    const syncPwaPrompt = () => {
      if (window.__deferredPwaPrompt) {
        setDeferredPwaPrompt(window.__deferredPwaPrompt);
      }
    };
    const onBeforeInstallPrompt = (e: BeforeInstallPromptEvent) => {
      e.preventDefault();
      window.__deferredPwaPrompt = e;
      setDeferredPwaPrompt(e);
    };
    const onAppInstalled = () => {
      window.__deferredPwaPrompt = null;
      setDeferredPwaPrompt(null);
      setIsStandaloneApp(true);
      setShowPwaInstallModal(false);
      setShowManualPwaGuide(false);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('mindsift:pwa-ready', syncPwaPrompt);
    window.addEventListener('appinstalled', onAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('mindsift:pwa-ready', syncPwaPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  // Immediately offer Web-App installation on mobile if not yet running as installed standalone app
  useEffect(() => {
    if (!userId || isStandaloneApp) return;
    if (isPhoneWidth() && !sessionStorage.getItem('mindsift_pwa_dismissed')) {
      setShowPwaInstallModal(true);
    }
  }, [userId, isStandaloneApp]);

  const handleInstallWebApp = async () => {
    triggerHaptic(15);
    const promptEvent = deferredPwaPrompt || window.__deferredPwaPrompt;
    if (promptEvent && typeof promptEvent.prompt === 'function') {
      try {
        await promptEvent.prompt();
        const choice = await promptEvent.userChoice;
        if (choice && choice.outcome === 'accepted') {
          window.__deferredPwaPrompt = null;
          setDeferredPwaPrompt(null);
          setShowPwaInstallModal(false);
          setShowManualPwaGuide(false);
        }
      } catch {
        setShowManualPwaGuide(true);
      }
    } else {
      setShowManualPwaGuide(true);
    }
  };

  const handleDismissPwaModal = () => {
    triggerHaptic(10);
    sessionStorage.setItem('mindsift_pwa_dismissed', '1');
    setShowPwaInstallModal(false);
    setShowManualPwaGuide(false);
  };

  return {
    isStandaloneApp,
    deferredPwaPrompt,
    showPwaInstallModal,
    setShowPwaInstallModal,
    showManualPwaGuide,
    setShowManualPwaGuide,
    handleInstallWebApp,
    handleDismissPwaModal,
  };
}
