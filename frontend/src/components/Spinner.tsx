import React from 'react';
import { useTranslation } from 'react-i18next';
import { LoaderCircle } from 'lucide-react';

const SIZES = { xs: 'w-3 h-3', sm: 'w-3.5 h-3.5', md: 'w-4 h-4', lg: 'w-5 h-5', xl: 'w-6 h-6' } as const;
const TONES = { accent: 'text-accent', muted: 'text-muted', current: '' } as const;

export type SpinnerSize = keyof typeof SIZES;

// The one loading indicator of the app (Doku/ui-patterns.md): a turning circle in the size of the icon it
// stands in for (sm in buttons and small rows, md in lists, lg for a whole area). Without a label it is
// decoration next to a text that says what loads; with one it says so to screen readers itself.
export function Spinner({
  size = 'sm',
  tone = 'current',
  label,
  className = '',
}: {
  size?: SpinnerSize;
  tone?: keyof typeof TONES;
  label?: string;
  className?: string;
}) {
  return (
    <LoaderCircle
      className={`${SIZES[size]} ${TONES[tone]} animate-spin shrink-0 ${className}`}
      {...(label ? { role: 'status', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}

// Something that is still loading where its content will be: spinner and a short text ("Wird geladen …"
// or "Notizen werden geladen …"), centred in the area, or `inline` at the start of a row.
export function LoadingState({ label, inline = false, className = '' }: { label?: string; inline?: boolean; className?: string }) {
  const { t } = useTranslation();
  return (
    <div role="status" className={`flex items-center gap-2 text-xs text-muted ${inline ? '' : 'justify-center px-3 py-6'} ${className}`}>
      <Spinner size={inline ? 'sm' : 'md'} tone="accent" />
      <span>{label ?? t('loading')}</span>
    </div>
  );
}
