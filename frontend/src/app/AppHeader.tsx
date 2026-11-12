import React from 'react';
import { useTranslation } from 'react-i18next';
import { Brain, ChevronDown, Download, Search } from 'lucide-react';
import { AuthStatus, User } from '../lib/types';
import { triggerHaptic } from '../lib/api';
import { ConnectionState } from '../lib/useConnectionState';
import { DemoCountdown } from '../components/DemoCountdown';
import { UserAvatar } from '../components/UserAvatar';
import { APP_VERSION } from '../version';
import { ActiveTab } from './appTabs';
import { usePwaInstall } from './usePwaInstall';

// Connection status at the profile (useConnectionState), phones and the desktop rail; full class names for Tailwind
export function useConnectionStatus(connection: ConnectionState) {
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
