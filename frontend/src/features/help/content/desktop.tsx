import React from 'react';
import { isDesktopApp } from '../../../lib/api';

// Parts of a help card that differ in the desktop app (one person on one computer: no sharing, no mail,
// no installing as an app). They decide when the card is drawn, so they follow the app, not the time the
// language file was loaded. A card's own title and subtitle for the desktop go in `DocCard.desktop`.
export const NotInDesktop: React.FC<{ children: React.ReactNode }> = ({ children }) => (isDesktopApp() ? null : <>{children}</>);
export const InDesktop: React.FC<{ children: React.ReactNode }> = ({ children }) => (isDesktopApp() ? <>{children}</> : null);
