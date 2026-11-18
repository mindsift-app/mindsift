import { AdminPage } from './AdminPage';
import { AudioSettings } from './AudioSettings';
import { ImageQualitySetting } from './ImageQualitySetting';
import { useAdminSettings } from './useAdminSettings';
import { useTranslation } from 'react-i18next';

// Administration → Media: how pictures and audio in notes are compressed, and how large an uploaded
// audio file may be (state in useAdminSettings)
export function MediaSettingsSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const { t } = useTranslation('settings');
  const { settings, demoMode, handleSaveSystemSettings } = admin;
  return (
    <AdminPage title={t('admin.nav.media')} intro={t('admin.pages.mediaIntro')} demoMode={demoMode}>
      <ImageQualitySetting settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />
      <AudioSettings settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />
    </AdminPage>
  );
}
