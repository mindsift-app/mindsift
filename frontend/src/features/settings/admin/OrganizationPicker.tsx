import React from 'react';
import { useTranslation } from 'react-i18next';
import { Building2, X } from 'lucide-react';
import { Organization } from '../../../lib/types';

/** Several organizations as chips (✕ removes one) plus a list to add another; empty is allowed. */
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
  const rest = organizations.filter((o) => !value.includes(o.id));
  return (
    <div className="flex flex-wrap items-center gap-1.5 min-h-8">
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
        <select
          value=""
          onChange={(e) => e.target.value && onChange([...value, e.target.value])}
          className="h-11 sm:h-7 px-2 input-field text-base sm:text-[11px] bg-panel max-w-[12rem]"
          aria-label={t('orgs.addOrganization')}
        >
          <option value="">{value.length ? t('orgs.addAnother') : t('orgs.addOrganization')}</option>
          {rest.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      )}
      {organizations.length === 0 && <span className="text-[11px] text-faint">{t('orgs.empty')}</span>}
    </div>
  );
}
