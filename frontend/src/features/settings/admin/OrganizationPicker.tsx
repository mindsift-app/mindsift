import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, Plus, X } from 'lucide-react';
import { Organization } from '../../../lib/types';
import { PickerPopover } from '../../../components/PickerPopover';

/** Several organizations as chips (✕ removes one); "+" opens a search to add another. Empty is allowed. */
export function OrganizationPicker({
  organizations,
  value,
  onChange,
}: {
  organizations: Organization[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { t } = useTranslation('settings');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const rest = organizations.filter((o) => !value.includes(o.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((id) => {
        const org = organizations.find((o) => o.id === id);
        if (!org) return null;
        return (
          <span key={id} className="inline-flex items-center gap-1 h-7 pl-2 pr-1 rounded-pill bg-panel border border-border text-[11px] text-main">
            <Building2 className="w-3 h-3 text-accent shrink-0" />
            <span className="truncate max-w-[10rem]">{org.name}</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((x) => x !== id))}
              className="p-0.5 text-muted hover:text-status-err rounded-full"
              title={t('orgs.removeFromSelection', { org: org.name })}
              aria-label={t('orgs.removeFromSelection', { org: org.name })}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        );
      })}
      {rest.length > 0 && (
        <button
          type="button"
          onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
          className="btn-icon w-11 h-11 sm:w-7 sm:h-7 rounded-full border border-dashed border-border"
          title={t('orgs.addOrganization')}
          aria-label={t('orgs.addOrganization')}
          aria-expanded={Boolean(anchor)}
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      )}
      {value.length === 0 && <span className="text-[11px] text-faint">{organizations.length ? t('orgs.noneChosen') : t('orgs.empty')}</span>}
      {anchor && (
        <PickerPopover
          anchor={anchor}
          items={rest.map((o) => ({ id: o.id, label: o.name, lead: <Building2 className="w-3.5 h-3.5 text-accent" /> }))}
          placeholder={t('orgs.searchOrganization')}
          empty={t('orgs.noMatch')}
          onPick={(item) => {
            onChange([...value, item.id]);
            setAnchor(null);
          }}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  );
}
