import React from 'react';
import { isDesktopApp } from '../../../lib/api';
import { useCapabilities, type Capability } from '../../../lib/capabilities';

// Parts of a help card that depend on what the instance offers (lib/capabilities.ts): <Only can="sharing">
// shows its content only with sharing, <Only not="sharing"> only without; can takes several, all needed.
// They decide when the card is drawn, so they follow the instance, not the time the language file was loaded.
// A card's own title and subtitle without a capability go in `DocCard.without`.
export const Only: React.FC<{ can?: Capability | Capability[]; not?: Capability; children: React.ReactNode }> = ({ can, not, children }) => {
  const caps = useCapabilities();
  const needed = can === undefined ? [] : Array.isArray(can) ? can : [can];
  if (needed.some((c) => !caps[c]) || (not !== undefined && caps[not])) return null;
  return <>{children}</>;
};

// What only the desktop app's shell changes (backups into its folder, the local API, alarms only while the
// app runs); everything that is a capability uses Only
export const NotInDesktop: React.FC<{ children: React.ReactNode }> = ({ children }) => (isDesktopApp() ? null : <>{children}</>);
export const InDesktop: React.FC<{ children: React.ReactNode }> = ({ children }) => (isDesktopApp() ? <>{children}</> : null);
