import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusMessage, StatusToast, useStatusMessage } from './StatusToast';

// The event the desktop app's shell sends when it saved a download of the page or could not
// (desktop/downloads.go): WebKitGTK saves nothing by itself, so the shell asks where to save and tells the
// page how it went. A browser (and WebView2 with its own download bar) sends none, so nothing shows there.
export const DOWNLOAD_NOTICE_EVENT = 'mindsift:desktop-download';

// A notice at the bottom of the screen like the settings' (StatusToast): "„x.zip“ gespeichert" for a few
// seconds, or that it could not be saved until it is closed.
export function DownloadNotice() {
  const { t } = useTranslation();
  const [msg, setMsg] = useStatusMessage<StatusMessage>();

  useEffect(() => {
    const onDownload = (e: Event) => {
      const detail = (e as CustomEvent<{ saved?: unknown; name?: unknown }>).detail;
      if (!detail || typeof detail.name !== 'string') return;
      const saved = detail.saved === true;
      setMsg({ type: saved ? 'ok' : 'err', text: t(saved ? 'fileSaved' : 'fileSaveFailed', { name: detail.name }) });
    };
    window.addEventListener(DOWNLOAD_NOTICE_EVENT, onDownload);
    return () => window.removeEventListener(DOWNLOAD_NOTICE_EVENT, onDownload);
  }, [setMsg, t]);

  return <StatusToast msg={msg} onClose={() => setMsg(null)} />;
}
