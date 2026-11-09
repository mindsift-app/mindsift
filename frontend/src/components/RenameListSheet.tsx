import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { FormSheet } from './FormSheet';
import { EmojiIconButton } from './EmojiIconButton';
import { showError } from './ErrorNotice';

// Renames a task list or shopping list (icon and name), laid out like "Neue Liste"
export function RenameListSheet({
  initialTitle,
  initialIcon,
  onSave,
  onClose,
}: {
  initialTitle: string;
  initialIcon: string;
  onSave: (title: string, icon: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation('common');
  const [title, setTitle] = useState(initialTitle);
  const [icon, setIcon] = useState(initialIcon);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await onSave(name, icon);
      onClose();
    } catch (err: any) {
      showError(err?.message || t('listMenu.renameFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormSheet
      title={t('listMenu.renameTitle')}
      icon={<Pencil className="w-4 h-4 text-accent" />}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitLabel={t('save')}
      busy={busy}
    >
      <div>
        <label className="block text-xs text-muted mb-1">{t('listMenu.name')}</label>
        <div className="flex items-center gap-1.5">
          <EmojiIconButton value={icon} onChange={setIcon} />
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            autoFocus
            required
            className="flex-1 min-w-0 h-11 sm:h-8 input-field px-2.5 text-base sm:text-xs"
          />
        </div>
      </div>
    </FormSheet>
  );
}
