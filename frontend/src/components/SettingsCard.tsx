import React from 'react';

type DivProps = Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> & { [data: `data-${string}`]: string | boolean | undefined };

// One block of a settings page (Doku/ui-patterns.md): a framed card with a title, a short hint below it
// and, on the right, an action (a switch, a button, a badge); the content follows below. Every page of the
// account settings and the administration uses it, so spacing and headings are the same everywhere.
export function SettingsCard({
  title,
  icon,
  hint,
  action,
  children,
  active = false,
  className = '',
  ...rest
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  children?: React.ReactNode;
  // Frame in the accent colour: the thing is switched on (an alarm channel in use)
  active?: boolean;
  className?: string;
} & DivProps) {
  const head = Boolean(title || hint || action);
  return (
    <div
      {...rest}
      className={`p-4 bg-canvas border rounded-card space-y-3 ${active ? 'border-accent' : 'border-border'} ${className}`}
    >
      {head && <SettingsHeading title={title} icon={icon} hint={hint} action={action} />}
      {children}
    </div>
  );
}

// One setting in a line: title and short hint on the left, the control (a switch, a field, a button) on
// the right. On its own it is a card like SettingsCard; `plain` leaves the frame off, for rows inside one.
export function SettingRow({
  title,
  icon,
  hint,
  children,
  plain = false,
  className = '',
  ...rest
}: {
  title: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
  plain?: boolean;
  className?: string;
} & DivProps) {
  return (
    <div
      {...rest}
      className={`flex flex-wrap items-center justify-between gap-x-4 gap-y-2 ${
        plain ? 'min-h-[44px]' : 'p-4 bg-canvas border border-border rounded-card'
      } ${className}`}
    >
      <SettingText title={title} icon={icon} hint={hint} />
      {children}
    </div>
  );
}

// The heading of a card alone: title, hint and action, for parts of a page that have no frame of their own
export function SettingsHeading({
  title,
  icon,
  hint,
  action,
}: {
  title?: React.ReactNode;
  icon?: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <SettingText title={title} icon={icon} hint={hint} />
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}

// Title and hint of a card or row
function SettingText({ title, icon, hint }: { title?: React.ReactNode; icon?: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="min-w-0 flex-[1_1_12rem]">
      {title && (
        <h3 className="font-bold text-main flex items-center gap-1.5">
          {icon}
          {title}
        </h3>
      )}
      {hint && <p className="text-[11px] text-muted mt-0.5">{hint}</p>}
    </div>
  );
}
