import { useTranslation } from 'react-i18next';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { SystemSettings } from '../../../lib/types';

// Administration → Server: link previews for the whole server. Off, the server fetches no pages and the
// app shows neither preview cards nor the switch per device. Always off in the demo.
export function LinkPreviewSetting({
  settings,
  demoMode,
  onSave,
}: {
  settings: SystemSettings;
  demoMode: boolean;
  onSave: (patch: Partial<SystemSettings>) => void;
}) {
  const { t } = useTranslation('settings');
  return (
    <div className="p-4 bg-canvas border border-border rounded-card flex items-center justify-between gap-4" data-admin-link-previews>
      <div className="pr-4">
        <p className="font-bold text-main">{t('server.linkPreviews')}</p>
        <p className="text-[11px] text-muted mt-0.5">
          {t('server.linkPreviewsHint')}
          {demoMode && ` ${t('server.fixedBy', { env: 'MINDSIFT_DEMO' })}`}
        </p>
      </div>
      <ToggleSwitch
        checked={!demoMode && settings.linkPreviews !== false}
        disabled={demoMode}
        onChange={(linkPreviews) => onSave({ linkPreviews })}
        title={t('server.linkPreviews')}
      />
    </div>
  );
}
