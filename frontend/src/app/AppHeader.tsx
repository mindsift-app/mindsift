import React from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, CheckSquare, ChevronDown, Download, FileText, HelpCircle, Layers, Search, ShoppingCart } from 'lucide-react';
import { AuthStatus, DashboardStats, SharedList, Thought, User } from '../lib/types';
import { triggerHaptic } from '../lib/api';
import { ConnectionState } from '../lib/useConnectionState';
import { CountBadge } from '../components/CountBadge';
import { DemoCountdown } from '../components/DemoCountdown';
import { UserAvatar } from '../components/UserAvatar';
import { InstantCaptureBar } from '../features/capture/InstantCaptureBar';
import { APP_VERSION } from '../version';
import { ActiveTab } from './appTabs';
import { usePwaInstall } from './usePwaInstall';

// Connection status at the profile (useConnectionState); full class names for Tailwind
function useConnectionStatus(connection: ConnectionState) {
  const { t } = useTranslation('app');
  const all = {
    online: { label: t('connection.online'), dot: 'bg-status-ok', title: t('connection.onlineTitle') },
    limited: { label: t('connection.limited'), dot: 'bg-status-warn', title: t('connection.limitedTitle') },
    offline: { label: t('connection.offline'), dot: 'bg-status-err', title: t('connection.offlineTitle') },
  };
  return all[connection];
}

// Phones: floating bar with the logo (opens the menu of the open view), the app install button, search and
// the profile avatar with the connection status
export function MobileHeaderBar({
  isMenuOpen,
  setIsMenuOpen,
  authStatus,
  demoDeadline,
  handleDemoCountdownElapsed,
  pwa,
  setShowCommandPalette,
  setShowMobileProfile,
  activeTab,
  user,
  connection,
  bell,
}: {
  isMenuOpen: boolean;
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  authStatus: AuthStatus;
  demoDeadline: number | null;
  handleDemoCountdownElapsed: () => void;
  pwa: ReturnType<typeof usePwaInstall>;
  setShowCommandPalette: (show: boolean) => void;
  setShowMobileProfile: (show: boolean) => void;
  activeTab: ActiveTab;
  user: User;
  connection: ConnectionState;
  // Notification center (NotificationBell), between search and profile
  bell?: React.ReactNode;
}) {
  const { t } = useTranslation('app');
  const status = useConnectionStatus(connection);
  const { isStandaloneApp, setShowManualPwaGuide, setShowPwaInstallModal } = pwa;
  return (
    <div className="sm:hidden flex items-center justify-between h-14 px-4 pt-1">
      <button
        type="button"
        onClick={() => {
          triggerHaptic(12);
          setIsMenuOpen((prev) => !prev);
        }}
        data-tour="view-menu"
        className={`min-h-[44px] px-2.5 -ml-2 rounded-xl flex items-center gap-2.5 cursor-pointer select-none active:scale-95 transition-all ${
          isMenuOpen ? 'bg-panel border border-accent/40 shadow-sm' : 'hover:bg-panel/60'
        }`}
        title={t('header.openMenu')}
      >
        <div className="w-8 h-8 bg-accent text-on-accent rounded-xl shadow-sm flex items-center justify-center flex-shrink-0">
          <Brain className="w-4 h-4" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex flex-col items-start text-left">
            <span className="font-bold text-base text-main tracking-tight leading-none">
              {authStatus.instanceName || 'MindSift'}
            </span>
            {demoDeadline ? (
              <DemoCountdown
                deadline={demoDeadline}
                minutes={authStatus.demoResetMinutes}
                onElapsed={handleDemoCountdownElapsed}
                className="text-[9px] mt-0.5"
              />
            ) : (
              <span className="text-[9px] text-muted font-mono leading-tight mt-0.5">{APP_VERSION}</span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-muted transition-transform duration-150 ${
              isMenuOpen ? 'rotate-180 text-accent' : ''
            }`}
          />
        </div>
      </button>

      <div className="flex items-center gap-1.5">
        {!isStandaloneApp && (
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setShowManualPwaGuide(false);
              setShowPwaInstallModal(true);
            }}
            className="h-9 px-2.5 rounded-xl bg-accent/15 border border-accent/40 text-accent text-xs font-semibold flex items-center gap-1.5 active:scale-95 transition-transform cursor-pointer"
            title={t('header.installApp')}
          >
            <Download className="w-3.5 h-3.5" />
            {/* Very narrow phones: the icon alone, so search, bell and profile still fit */}
            <span className="max-[380px]:hidden">{t('header.app')}</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            triggerHaptic(10);
            setShowCommandPalette(true);
          }}
          data-tour="search"
          className="w-11 h-11 rounded-full flex items-center justify-center text-muted hover:text-main transition-transform active:scale-95 cursor-pointer"
          title={t('header.search')}
          aria-label={t('header.openSearch')}
        >
          {/* Same visible size as the avatar next to it; the 44px button stays the touch target */}
          <span className="w-9 h-9 rounded-full flex items-center justify-center bg-panel border border-border">
            <Search className="w-4 h-4" />
          </span>
        </button>

        {bell}

        <button
          type="button"
          onClick={() => {
            triggerHaptic(10);
            setShowMobileProfile(true);
          }}
          data-tour="help-entry"
          className={`w-11 h-11 -mr-1.5 rounded-full flex items-center justify-center transition-transform active:scale-95 cursor-pointer ${
            activeTab === 'user_settings' || activeTab === 'admin_settings' || activeTab === 'help'
              ? 'ring-2 ring-accent'
              : ''
          }`}
          title={t('header.profileAndSettings')}
        >
          <span className="relative">
            <UserAvatar user={user} size="md" className="shadow-sm" />
            {/* Connection status like in a chat app: green online, yellow limited, red without server */}
            <span
              role="status"
              aria-label={status.title}
              className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full ring-2 ring-canvas ${status.dot}`}
            />
          </span>
        </button>
      </div>
    </div>
  );
}

// Desktop: logo (back to the triage input), the capture bar with search in the middle and the profile pill
// with its dropdown on the right
export function DesktopHeaderBar({
  setActiveTab,
  handleTriggerAddButton,
  authStatus,
  demoDeadline,
  handleDemoCountdownElapsed,
  handleCaptured,
  lists,
  captureFocusCount,
  setShowCommandPalette,
  dropdownRef,
  setShowProfileMenu,
  showProfileMenu,
  user,
  connection,
  profileMenu,
  bell,
}: {
  setActiveTab: (tab: ActiveTab) => void;
  handleTriggerAddButton: () => void;
  authStatus: AuthStatus;
  demoDeadline: number | null;
  handleDemoCountdownElapsed: () => void;
  handleCaptured: (thought: Thought, target?: 'inbox' | 'task' | 'list_item' | 'document') => void;
  lists: SharedList[];
  captureFocusCount: number;
  setShowCommandPalette: (show: boolean) => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  setShowProfileMenu: React.Dispatch<React.SetStateAction<boolean>>;
  showProfileMenu: boolean;
  user: User;
  connection: ConnectionState;
  profileMenu: React.ReactNode;
  bell?: React.ReactNode;
}) {
  const { t } = useTranslation('app');
  const status = useConnectionStatus(connection);
  return (
    <div className="hidden sm:grid grid-cols-[minmax(12rem,1fr)_minmax(0,36rem)_minmax(12rem,1fr)] max-w-6xl mx-auto px-4 py-2 items-start gap-6">
      {/* Logo & Headline */}
      <div
        onClick={() => {
          setActiveTab('triage');
          handleTriggerAddButton();
        }}
        className="h-9 flex items-center gap-2.5 cursor-pointer group select-none flex-shrink-0 justify-self-start"
      >
        <div className="w-7 h-7 bg-accent text-on-accent rounded-btn flex items-center justify-center">
          <Brain className="w-4 h-4" />
        </div>
        <div className="flex flex-col items-start text-left">
          <span className="font-bold text-sm sm:text-base text-main tracking-tight leading-none">
            {authStatus.instanceName || 'MindSift'}
          </span>
          {demoDeadline ? (
            <DemoCountdown
              deadline={demoDeadline}
              minutes={authStatus.demoResetMinutes}
              onElapsed={handleDemoCountdownElapsed}
              className="text-[10px] mt-0.5"
            />
          ) : (
            <span className="text-[10px] text-muted font-mono leading-tight mt-0.5">{APP_VERSION}</span>
          )}
        </div>
      </div>

      {/* Quick-Capture Input Bubble directly in Header (above Tabs) */}
      <div className="w-full max-w-xl mx-auto flex items-center gap-2">
        <div className="flex-1" data-tour="capture">
          <InstantCaptureBar
            onCaptured={handleCaptured}
            lists={lists}
            autoFocusTrigger={captureFocusCount}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCommandPalette(true)}
          data-tour="search"
          className="w-8 h-8 rounded-full bg-panel border border-border text-muted hover:text-main flex items-center justify-center transition-colors cursor-pointer shrink-0"
          title={t('header.searchShortcut')}
          aria-label={t('header.searchShortcut')}
        >
          <Search className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* User Profile Pill & Dropdown Menu */}
      <div className="relative h-9 flex items-center gap-3 flex-shrink-0 justify-self-end">
        {bell}
        <div className="relative h-9 flex items-center" ref={dropdownRef}>
        <button
          onClick={() => {
            triggerHaptic(10);
            setShowProfileMenu((prev) => !prev);
          }}
          className="h-8 flex items-center gap-2 text-xs font-medium text-main hover:opacity-85 transition-opacity cursor-pointer group"
          title={t('header.openUserMenu')}
        >
          <UserAvatar user={user} size="sm" />
          {/* Wide enough for the longest status (German "eingeschränkt"), so switching status moves nothing */}
          <span className="flex flex-col items-start leading-tight min-w-[5.5rem]">
            <span className="max-w-[130px] truncate hidden sm:inline text-main font-medium">
              {user.displayName}
            </span>
            <span
              role="status"
              title={status.title}
              className="hidden sm:inline-flex items-center gap-1 text-[10px] font-normal text-muted"
            >
              <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />
              {status.label}
            </span>
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-muted group-hover:text-main transition-colors" />
        </button>

        {showProfileMenu && profileMenu}
        </div>
      </div>
    </div>
  );
}

// Desktop: the page tabs below the header with their counters, help on the right
export function DesktopNav({
  activeTab,
  setActiveTab,
  stats,
  handleOpenHelp,
}: {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  stats: DashboardStats;
  handleOpenHelp: () => void;
}) {
  const { t } = useTranslation('app');
  return (
    <nav className="hidden sm:flex max-w-6xl mx-auto px-2 border-t border-border items-stretch justify-between">
      <div className="flex items-stretch overflow-x-auto no-scrollbar">
        <button
          onClick={() => {
            triggerHaptic(10);
            setActiveTab('triage');
          }}
          className={`tab-btn ${activeTab === 'triage' ? 'tab-btn-active' : ''}`}
        >
          <Layers className="w-4 h-4" />
          <span className="inline-flex items-center">
            <span>{t('common:nav.triage')}</span>
            <CountBadge count={stats.inboxCount} variant="accent" position="text" />
          </span>
        </button>

        <button
          onClick={() => {
            triggerHaptic(10);
            setActiveTab('workspace');
          }}
          className={`tab-btn ${activeTab === 'workspace' ? 'tab-btn-active' : ''}`}
        >
          <FileText className="w-4 h-4" />
          <span>{t('common:nav.workspace')}</span>
        </button>

        <button
          onClick={() => {
            triggerHaptic(10);
            setActiveTab('tasks');
          }}
          className={`tab-btn ${activeTab === 'tasks' ? 'tab-btn-active' : ''}`}
        >
          <CheckSquare className="w-4 h-4" />
          <span className="inline-flex items-center">
            <span>{t('common:nav.tasks')}</span>
            <CountBadge count={stats.tasksOpenCount} variant="accent" position="text" />
          </span>
        </button>

        <button
          onClick={() => {
            triggerHaptic(10);
            setActiveTab('lists');
          }}
          className={`tab-btn ${activeTab === 'lists' ? 'tab-btn-active' : ''}`}
        >
          <ShoppingCart className="w-4 h-4" />
          <span className="inline-flex items-center">
            <span>{t('common:nav.lists')}</span>
            <CountBadge count={stats.listItemsOpenCount} variant="accent" position="text" />
          </span>
        </button>
      </div>

      {/* Borderless Circled Question Mark Help Button in Tab Bar */}
      <div className="flex items-center pr-2 flex-shrink-0">
        <button
          type="button"
          onClick={handleOpenHelp}
          data-tour="help-entry"
          className={`p-1.5 transition-colors cursor-pointer rounded-full ${
            activeTab === 'help'
              ? 'text-accent'
              : 'text-muted hover:text-main'
          }`}
          title={t('header.help')}
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
    </nav>
  );
}
