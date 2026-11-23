import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Brain,
  SquareCheckBig,
  FileText,
  CircleQuestionMark,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  ShoppingCart,
} from 'lucide-react';
import { AuthStatus, DashboardStats, User } from '../lib/types';
import { triggerHaptic } from '../lib/api';
import { ConnectionState } from '../lib/useConnectionState';
import { DemoCountdown } from '../components/DemoCountdown';
import { UserAvatar } from '../components/UserAvatar';
import { RailItemContent } from '../components/RailItemContent';
import { useDismiss } from '../lib/useDismiss';
import { APP_VERSION } from '../version';
import { ActiveTab } from './appTabs';
import { useConnectionStatus } from './AppHeader';
import { RailQuickDumpButton } from './RailQuickDumpButton';
import type { DictationOutcome } from '../features/capture/captureDictation';

// Expanded or not, per device (a convenience; private windows simply start collapsed)
export const NAV_RAIL_KEY = 'mindsift:nav-rail-expanded';

function readNavRailExpanded(): boolean {
  try {
    return localStorage.getItem(NAV_RAIL_KEY) === '1';
  } catch {
    return false;
  }
}

function useNavRailExpanded() {
  const [expanded, setExpandedState] = useState(readNavRailExpanded);
  const setExpanded = useCallback((next: boolean) => {
    setExpandedState(next);
    try {
      localStorage.setItem(NAV_RAIL_KEY, next ? '1' : '0');
    } catch {
      // only for this visit then
    }
  }, []);
  return [expanded, setExpanded] as const;
}

// The key that opens the Quick Dump (app/useQuickDumpShortcut.ts)
const QUICK_DUMP_KEY = 'C';

const PAGES: { tab: ActiveTab; icon: React.ReactNode; stat?: keyof DashboardStats }[] = [
  { tab: 'triage', icon: <Layers className="w-5 h-5" />, stat: 'inboxCount' },
  { tab: 'workspace', icon: <FileText className="w-5 h-5" /> },
  { tab: 'tasks', icon: <SquareCheckBig className="w-5 h-5" />, stat: 'tasksOpenCount' },
  { tab: 'lists', icon: <ShoppingCart className="w-5 h-5" />, stat: 'listItemsOpenCount' },
];

interface NavRailProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  stats: DashboardStats;
  authStatus: AuthStatus;
  demoDeadline: number | null;
  handleDemoCountdownElapsed: () => void;
  onQuickDump: () => void;
  // Text dictated by holding the + (saved into the inbox; names a recognised date)
  onDictated: (text: string) => Promise<DictationOutcome | void> | DictationOutcome | void;
  onSearch: () => void;
  handleOpenHelp: () => void;
  user: User;
  connection: ConnectionState;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  showProfileMenu: boolean;
  setShowProfileMenu: React.Dispatch<React.SetStateAction<boolean>>;
  // ProfileDropdown, opened to the right of the avatar
  profileMenu: React.ReactNode;
  // NotificationBell (variant "desktop"); gets the expanded state passed in by the caller
  renderBell: (expanded: boolean) => React.ReactNode;
}

// Desktop (from sm): the navigation as a rail on the left instead of a header with tabs, so the views get the
// full height. Collapsed it shows icons only (60 px); expanded (220 px) it lies over the content with a shadow
// and does not push it, so long notes are not laid out again. Logo, the pages with their counters, Quick Dump
// and search on top; help, notifications, profile with the connection status and the toggle at the bottom.
export function NavRail({
  activeTab,
  setActiveTab,
  stats,
  authStatus,
  demoDeadline,
  handleDemoCountdownElapsed,
  onQuickDump,
  onDictated,
  onSearch,
  handleOpenHelp,
  user,
  connection,
  dropdownRef,
  showProfileMenu,
  setShowProfileMenu,
  profileMenu,
  renderBell,
}: NavRailProps) {
  const { t } = useTranslation('app');
  const status = useConnectionStatus(connection);
  const [expanded, setExpanded] = useNavRailExpanded();
  const railRef = useRef<HTMLElement | null>(null);
  const instanceName = authStatus.instanceName || 'MindSift';

  // Expanded, it is an overlay: a click beside it or Escape (unless something inside took it) folds it again;
  // the click still reaches its target
  useDismiss(railRef, () => setExpanded(false), { active: expanded, escape: 'unhandled', event: 'mousedown' });

  const pageLabel: Record<string, string> = {
    triage: t('common:nav.triage'),
    workspace: t('common:nav.workspace'),
    tasks: t('common:nav.tasks'),
    lists: t('common:nav.lists'),
  };
  const inProfile = activeTab === 'user_settings' || activeTab === 'admin_settings' || activeTab === 'groups';

  return (
    <nav
      ref={railRef}
      aria-label={t('rail.label')}
      data-nav-rail={expanded ? 'expanded' : 'collapsed'}
      className={`hidden sm:flex fixed left-0 inset-y-0 z-40 flex-col gap-1 px-2.5 py-2.5 bg-panel border-r border-border transition-[width,box-shadow] duration-200 ease-out motion-reduce:transition-none ${
        expanded ? 'w-55 shadow-panel' : 'w-15'
      }`}
    >
      {/* Logo: back to the triage; expanded with the name and the version or the demo's countdown */}
      <button
        type="button"
        onClick={() => {
          triggerHaptic(10);
          setActiveTab('triage');
        }}
        className="rail-item h-auto! min-h-11 pl-1.5! hover:bg-transparent!"
        title={instanceName}
      >
        <span className="w-7 h-7 shrink-0 bg-accent text-on-accent rounded-btn flex items-center justify-center">
          <Brain className="w-4 h-4" />
        </span>
        {expanded && (
          <span className="flex flex-col items-start text-left min-w-0">
            <span className="font-bold text-sm text-main tracking-tight leading-none truncate max-w-full">
              {instanceName}
            </span>
            {demoDeadline ? (
              <DemoCountdown
                deadline={demoDeadline}
                minutes={authStatus.demoResetMinutes}
                onElapsed={handleDemoCountdownElapsed}
                className="text-[10px] mt-1"
              />
            ) : (
              <span className="text-[10px] text-muted font-mono leading-tight mt-1">{APP_VERSION}</span>
            )}
          </span>
        )}
      </button>
      {/* Collapsed: the demo's countdown in short under the logo (the rest is in its tooltip) */}
      {!expanded && demoDeadline && (
        <DemoCountdown
          compact
          deadline={demoDeadline}
          minutes={authStatus.demoResetMinutes}
          onElapsed={handleDemoCountdownElapsed}
          className="block text-center text-[9px] -mt-1 mb-1"
        />
      )}

      <div className="flex flex-col gap-0.5 mt-1">
        {PAGES.map((p) => {
          const active = activeTab === p.tab;
          return (
            <button
              key={p.tab}
              type="button"
              onClick={() => {
                triggerHaptic(10);
                setActiveTab(p.tab);
              }}
              aria-current={active ? 'page' : undefined}
              className={`rail-item ${active ? 'rail-item-active' : ''}`}
            >
              <RailItemContent
                icon={p.icon}
                label={pageLabel[p.tab]}
                expanded={expanded}
                count={p.stat ? (stats[p.stat] as number) : undefined}
              />
            </button>
          );
        })}
      </div>

      <div className="mx-1.5 my-1.5 border-t border-border" aria-hidden />

      {/* Quick Dump: a round, neutral button (not the accent, so it does not read as a second logo); holding it
          dictates into the inbox */}
      <RailQuickDumpButton
        expanded={expanded}
        shortcut={QUICK_DUMP_KEY}
        onQuickDump={onQuickDump}
        onDictated={onDictated}
      />

      <button type="button" onClick={onSearch} data-tour="search" className="rail-item">
        <RailItemContent
          icon={<Search className="w-5 h-5" />}
          label={t('rail.search')}
          tip={t('header.searchShortcut')}
          hint={<kbd className="font-mono">{t('rail.searchKey')}</kbd>}
          expanded={expanded}
        />
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={handleOpenHelp}
        data-tour="help-entry"
        aria-current={activeTab === 'help' ? 'page' : undefined}
        className={`rail-item ${activeTab === 'help' ? 'rail-item-active' : ''}`}
      >
        <RailItemContent icon={<CircleQuestionMark className="w-5 h-5" />} label={t('rail.help')} tip={t('header.help')} expanded={expanded} />
      </button>

      {renderBell(expanded)}

      {/* Profile: the avatar with the connection status like on phones; the menu opens beside the rail */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => {
            triggerHaptic(10);
            setShowProfileMenu((prev) => !prev);
          }}
          aria-expanded={showProfileMenu}
          aria-haspopup="menu"
          className={`rail-item h-11! pl-1.5! ${inProfile || showProfileMenu ? 'bg-panel-elevated text-main' : ''}`}
          title={t('header.openUserMenu')}
        >
          <span className="relative shrink-0">
            <UserAvatar user={user} size="sm" />
            {/* Green online, yellow limited, red without server */}
            <span
              role="status"
              aria-label={status.title}
              title={status.title}
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ring-(--bg-panel) ${status.dot}`}
            />
          </span>
          {/* Collapsed, the name stays for screen readers (and tests that look for the account's button) */}
          <span className={expanded ? 'flex-1 min-w-0 flex flex-col items-start leading-tight text-left' : 'sr-only'}>
            <span className="max-w-full truncate text-xs text-main font-medium">{user.displayName}</span>
            {expanded && <span className="text-[10px] font-normal text-muted">{status.label}</span>}
          </span>
        </button>
        {showProfileMenu && profileMenu}
      </div>

      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        aria-label={expanded ? t('rail.collapse') : t('rail.expand')}
        className="rail-item"
      >
        <RailItemContent
          icon={expanded ? <PanelLeftClose className="w-5 h-5" /> : <PanelLeftOpen className="w-5 h-5" />}
          label={expanded ? t('rail.collapse') : t('rail.expand')}
          expanded={expanded}
        />
      </button>
    </nav>
  );
}
