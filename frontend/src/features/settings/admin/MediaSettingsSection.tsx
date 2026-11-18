import { AdminPage } from './AdminPage';
import { AudioSettings } from './AudioSettings';
import { ImageSettings } from './ImageSettings';
import { MediaQuotaSetting } from './MediaQuotaSetting';
import { useAdminSettings } from './useAdminSettings';
import { useTranslation } from 'react-i18next';

// Administration → Media: images and audio in notes (whether they may go in, compression, sizes) and
// the storage per person (state in useAdminSettings)
export function MediaSettingsSection({
  admin,
}: {
  admin: ReturnType<typeof useAdminSettings>;
}) {
  const { t } = useTranslation('settings');
  const { settings, demoMode, handleSaveSystemSettings } = admin;
  return (
    <AdminPage title={t('admin.nav.media')} intro={t('admin.pages.mediaIntro')} demoMode={demoMode}>
      <ImageSettings settings={settings} demoMode={demoMode} onSave={(patch) => handleSaveSystemSettings(patch)} />
      <AudioSettings settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />
      <MediaQuotaSetting settings={settings} onSave={(patch) => handleSaveSystemSettings(patch)} />
    </AdminPage>
  );
}
