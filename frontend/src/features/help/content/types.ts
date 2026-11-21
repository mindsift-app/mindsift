import React from 'react';

export type HelpCategory = 'all' | 'workspace' | 'triage' | 'tasks' | 'lists' | 'collaboration' | 'account' | 'shortcuts';

export interface DocCard {
  id: string;
  category: HelpCategory;
  title: string;
  subtitle?: string;
  // Title and subtitle in the desktop app, where a card's topic differs (parts of its content: desktop.tsx)
  desktop?: { title?: string; subtitle?: string };
  icon: React.ComponentType<{ className?: string }>;
  keywords: string[];
  content: React.ReactNode;
}

export interface HelpShortcut {
  key: string;
  scope: string;
  desc: string;
}

export interface HelpContent {
  cards: DocCard[];
  shortcuts: HelpShortcut[];
}
