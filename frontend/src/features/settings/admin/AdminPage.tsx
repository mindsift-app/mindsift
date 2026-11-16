import React from 'react';

// Frame of a settings page in the administration: heading, one line of intro and the rows below it.
// In the demo everything inside is read only.
export function AdminPage({
  title,
  intro,
  demoMode,
  children,
}: {
  title: string;
  intro: string;
  demoMode: boolean;
  children: React.ReactNode;
}) {
  return (
    <fieldset disabled={demoMode} className="min-w-0 border-0 p-0 m-0">
      <div className="space-y-6">
        <div className="border-b border-border pb-3">
          <h2 className="text-sm font-bold text-main">{title}</h2>
          <p className="text-muted mt-0.5">{intro}</p>
        </div>
        <div className="space-y-4">{children}</div>
      </div>
    </fieldset>
  );
}
