import React from 'react';

export type HelpCategory = 'all' | 'workspace' | 'triage' | 'tasks' | 'lists' | 'collaboration' | 'shortcuts';

export interface DocCard {
  id: string;
  category: HelpCategory;
  title: string;
  subtitle?: string;
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
