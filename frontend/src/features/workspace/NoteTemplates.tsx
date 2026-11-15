import React, { useMemo } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { PickerPopover, PickerItem } from '../../components/PickerPopover';
import type { Document } from '../../lib/types';
import { compareText } from '../../lib/format';

// Note templates (lib/noteTemplate.ts, Doku/modules/workspace.md "Templates"): the person's templates as
// choices, the quiet mark in the folder tree and the searchable picker of /vorlage and "Neue Notiz".

export interface TemplateChoice {
  id: string;
  title: string;
  icon?: string;
  folderPath?: string;
}

/** The person's templates among the notes of the list, by title. */
export function templateChoices(docs: Document[]): TemplateChoice[] {
  return docs
    .filter((d) => d.isTemplate && !d.isArchived)
    .map((d) => ({ id: d.id, title: d.title, icon: d.icon, folderPath: d.folderPath }))
    .sort((a, b) => compareText(a.title, b.title));
}

/** Small mark behind a template's title in the folder tree */
export const TemplateMark: React.FC = () => {
  const { t } = useTranslation('workspace');
  return (
    <span role="img" aria-label={t('template.mark')} title={t('template.mark')} className="shrink-0 inline-flex">
      <LayoutTemplate className="w-3 h-3 text-faint" />
    </span>
  );
};

interface TemplatePickerProps {
  anchor: HTMLElement;
  templates: TemplateChoice[];
  onPick: (template: TemplateChoice) => void;
  onClose: () => void;
}

/** The person's templates to choose one, searchable (PickerPopover). */
export const TemplatePicker: React.FC<TemplatePickerProps> = ({ anchor, templates, onPick, onClose }) => {
  const { t } = useTranslation('workspace');
  const items = useMemo<PickerItem[]>(
    () =>
      templates.map((tpl) => ({
        id: tpl.id,
        label: tpl.title || t('editor.untitled'),
        hint: tpl.folderPath || undefined,
        lead: <span className="w-4 text-center">{tpl.icon || '🗒️'}</span>,
      })),
    [templates, t]
  );
  return (
    <PickerPopover
      anchor={anchor}
      items={items}
      placeholder={t('template.search')}
      empty={t('template.none')}
      onPick={(item) => {
        const tpl = templates.find((x) => x.id === item.id);
        if (tpl) onPick(tpl);
      }}
      onClose={onClose}
    />
  );
};
