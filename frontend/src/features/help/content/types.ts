import React from 'react';
import type { Capability } from '../../../lib/capabilities';

export type HelpCategory = 'all' | 'workspace' | 'triage' | 'tasks' | 'lists' | 'collaboration' | 'account' | 'shortcuts';

export interface DocCard {
  id: string;
  category: HelpCategory;
  title: string;
  subtitle?: string;
  // Title and subtitle where the instance lacks a capability and the card's topic differs (parts of its
  // content: Only in desktop.tsx)
  without?: { cap: Capability; title?: string; subtitle?: string };
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
