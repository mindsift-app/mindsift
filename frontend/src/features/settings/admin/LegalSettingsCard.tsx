import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LegalSettings, SystemSettings } from '../../../lib/types';

const EMPTY: LegalSettings = { imprintUrl: '', imprintContent: '', privacyUrl: '', privacyContent: '', customLinkLabel: '', customLinkUrl: '' };

// The variable that fixes each field (LEGAL_*), as the server names them in configuredViaEnv
const ENV: Record<string, string> = {
  imprintUrl: 'LEGAL_IMPRINT_URL',
  imprintContent: 'LEGAL_IMPRINT_CONTENT',
  privacyUrl: 'LEGAL_PRIVACY_URL',
  privacyContent: 'LEGAL_PRIVACY_CONTENT',
  customLink: 'LEGAL_CUSTOM_LINK_URL',
};

// Administration → Server: imprint and privacy notice (a link and/or Markdown text each, shown from the
// login screen on) and a link of one's own in the footer. Typed into a draft and saved with the button;
// a field LEGAL_* fixes shows its value and stays locked.
export function LegalSettingsCard({
  settings,
  onSave,
}: {
  settings: SystemSettings;
  onSave: (patch: Partial<SystemSettings>) => void;
}) {
  const { t } = useTranslation('settings');
  const saved = settings.legal ?? EMPTY;
  const [draft, setDraft] = useState<LegalSettings>(saved);
  const [shown, setShown] = useState(saved);
  if (shown !== saved) {
    setShown(saved);
    setDraft(saved);
  }
  const locked = (field: string) => (saved.configuredViaEnv ?? []).includes(field);
  const changed = (Object.keys(EMPTY) as (keyof LegalSettings)[]).some((k) => (draft[k] ?? '') !== (saved[k] ?? ''));
  const hint = (field: string) => (locked(field) ? <span className="text-[11px] text-muted">{t('server.fixedBy', { env: ENV[field] })}</span> : null);
  const input = (field: keyof LegalSettings, lockKey: string, placeholder: string) => (
    <input
      type="url"
      value={(draft[field] as string) ?? ''}
      disabled={locked(lockKey)}
      placeholder={placeholder}
      aria-label={t(`server.legal.${field}`)}
      onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
      className="w-full h-11 sm:h-8 px-2 input-field text-base sm:text-xs"
    />
  );
  const text = (field: 'imprintContent' | 'privacyContent') => (
    <textarea
      value={draft[field] ?? ''}
      disabled={locked(field)}
      rows={4}
      aria-label={t(`server.legal.${field}`)}
      placeholder={t('server.legal.contentPlaceholder')}
      onChange={(e) => setDraft((d) => ({ ...d, [field]: e.target.value }))}
      className="w-full px-2 py-1.5 input-field text-base sm:text-xs font-mono"
    />
  );
  return (
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3" data-admin-legal>
      <div>
        <p className="font-bold text-main">{t('server.legal.title')}</p>
        <p className="text-[11px] text-muted mt-0.5">{t('server.legal.hint')}</p>
      </div>
      {(['imprint', 'privacy'] as const).map((kind) => (
        <div key={kind} className="space-y-1.5 pt-3 border-t border-border">
          <p className="text-main font-semibold">{t(`server.legal.${kind}`)}</p>
          <label className="block text-[11px] text-muted space-y-1">
            <span>{t(`server.legal.${kind}Url`)}</span>
            {input(`${kind}Url`, `${kind}Url`, 'https://…')}
            {hint(`${kind}Url`)}
          </label>
          <label className="block text-[11px] text-muted space-y-1">
            <span>{t(`server.legal.${kind}Content`)}</span>
            {text(`${kind}Content`)}
            {hint(`${kind}Content`)}
          </label>
        </div>
      ))}
      <div className="space-y-1.5 pt-3 border-t border-border">
        <p className="text-main font-semibold">{t('server.legal.customLink')}</p>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            maxLength={60}
            value={draft.customLinkLabel ?? ''}
            disabled={locked('customLink')}
            placeholder={t('server.legal.customLinkLabelPlaceholder')}
            aria-label={t('server.legal.customLinkLabel')}
            onChange={(e) => setDraft((d) => ({ ...d, customLinkLabel: e.target.value }))}
            className="sm:w-48 h-11 sm:h-8 px-2 input-field text-base sm:text-xs"
          />
          {input('customLinkUrl', 'customLink', 'https://…')}
        </div>
        {hint('customLink')}
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          disabled={!changed}
          onClick={() => onSave({ legal: { ...draft, configuredViaEnv: undefined } })}
          className="btn-primary h-11 sm:h-8 px-4 text-xs disabled:opacity-40"
        >
          {t('server.legal.save')}
        </button>
      </div>
    </div>
  );
}
