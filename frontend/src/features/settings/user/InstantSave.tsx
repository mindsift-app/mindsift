import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from '../../../i18n';
import { User } from '../../../lib/types';
import { api } from '../../../lib/api';
import { errorMessage } from '../../../lib/errorMessage';
import { StatusMessage, StatusToast, useStatusMessage } from '../../../components/StatusToast';

type SettingsPatch = Parameters<typeof api.updateSettings>[0];

// Account settings that save as soon as they are changed (retention, voice input, language): the answer is
// a short "Gespeichert" or what went wrong, shown by InstantSaveToast like the other settings' answers
// (Doku/ui-patterns.md). Lives in the view, so a save still running finishes when the section is left.
export function useInstantSave(onUserUpdated: (u: User) => void) {
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useStatusMessage<{ type: 'ok' } | StatusMessage>();

  const save = async (patch: SettingsPatch) => {
    setSaving(true);
    try {
      onUserUpdated(await api.updateSettings(patch));
      setMsg({ type: 'ok' });
    } catch (err) {
      setMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:api.saveFailed')) });
    } finally {
      setSaving(false);
    }
  };

  return { saving, msg, setMsg, save };
}

// The confirmation is worded when it is shown, so after a change of the app's language it already speaks
// the new one
export function InstantSaveToast({ save }: { save: ReturnType<typeof useInstantSave> }) {
  const { t } = useTranslation('settings');
  const { msg, setMsg } = save;
  const shown = useMemo<StatusMessage | null>(
    () => (msg && !('text' in msg) ? { type: 'ok', text: t('api.saved') } : msg),
    [msg, t]
  );
  return <StatusToast msg={shown} onClose={() => setMsg(null)} />;
}
