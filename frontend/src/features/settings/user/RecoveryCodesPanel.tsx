import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download } from 'lucide-react';
import { saveBlob } from '../../../lib/download';

// The ten recovery codes, shown once: when the first second factor (app or passkey) is switched on, and
// after "new recovery codes". Copy, save as text file, done.
export function RecoveryCodesPanel({ codes, account, onDone }: { codes: string[]; account: string; onDone: () => void }) {
  const { t } = useTranslation('settings');
  const [copied, setCopied] = useState(false);

  const copy = () => {
    void navigator.clipboard?.writeText(codes.join('\n')).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };

  const download = () => {
    const text = `${t('security.twoFactor.codesFileTitle', { account })}\n\n${codes.join('\n')}\n`;
    saveBlob(new Blob([text], { type: 'text/plain;charset=utf-8' }), 'mindsift-recovery-codes.txt');
  };

  return (
    <div className="p-3.5 rounded-card border border-accent/40 bg-accent/5 space-y-3" data-recovery-codes>
      <div>
        <p className="font-semibold text-main">{t('security.twoFactor.codesTitle')}</p>
        <p className="text-[11px] text-muted">{t('security.twoFactor.codesIntro')}</p>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-sm text-main bg-panel border border-border rounded-btn p-3">
        {codes.map((c) => (
          <li key={c} data-recovery-code>
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-col sm:flex-row gap-2">
        <button type="button" onClick={copy} className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5">
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          <span>{copied ? t('security.twoFactor.copied') : t('security.twoFactor.copyCodes')}</span>
        </button>
        <button type="button" onClick={download} className="btn-action h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5">
          <Download className="w-3.5 h-3.5" />
          <span>{t('security.twoFactor.downloadCodes')}</span>
        </button>
        <button type="button" onClick={onDone} className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold sm:ml-auto">
          {t('security.twoFactor.codesDone')}
        </button>
      </div>
    </div>
  );
}
