import { Brain, HelpCircle, LogOut, Palette, Settings, Shield, Smartphone, Users, X } from 'lucide-react';
import { User } from '../lib/types';
import { isSharingDisabled, triggerHaptic } from '../lib/api';
import { ThemeId, ThemeOption } from '../lib/theme';
import { UserAvatar } from '../components/UserAvatar';
import { ThemeQuickPicker } from '../components/ThemeQuickPicker';
import { APP_VERSION } from '../version';
import { ActiveTab } from './appTabs';
import { usePwaInstall } from './usePwaInstall';

interface ProfileMenuProps {
  user: User;
  roleLabel: string;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  activeTheme: ThemeId;
  allThemes: ThemeOption[];
  handleChangeTheme: (id: ThemeId) => void;
  isServerAdmin: boolean;
  handleOpenHelp: () => void;
  handleLogout: () => void;
}

// Desktop: the dropdown below the profile pill (account, theme, settings, groups, help, admin, logout)
export function ProfileDropdown({
  user,
  roleLabel,
  activeTab,
  setActiveTab,
  activeTheme,
  allThemes,
  handleChangeTheme,
  isServerAdmin,
  handleOpenHelp,
  handleLogout,
  setShowProfileMenu,
}: ProfileMenuProps & { setShowProfileMenu: (show: boolean) => void }) {
  return (
    <div className="absolute right-0 top-full mt-1.5 w-64 panel-surface shadow-panel overflow-hidden z-50 divide-y divide-border text-xs origin-top-right animate-in fade-in zoom-in-95 slide-in-from-top-1 duration-150">
      {/* User Info Header */}
      <div className="p-3 bg-canvas flex items-center gap-2.5">
        <UserAvatar user={user} size="md" className="border border-border/70" />
        <div className="min-w-0 flex-1">
          <p className="font-bold text-main truncate">{user.displayName}</p>
          <p className="text-[11px] text-muted truncate">{user.email}</p>
          <span className="inline-block mt-1 px-1.5 py-0.5 bg-panel border border-border rounded-btn text-[10px] text-accent font-semibold">
            {roleLabel}
          </span>
        </div>
      </div>

      {/* Theme Quick Switcher */}
      <div className="p-2.5 space-y-1.5">
        <span className="text-[10px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5 px-1">
          <Palette className="w-3 h-3 text-accent" />
          <span>Design-Theme</span>
        </span>
        <ThemeQuickPicker activeTheme={activeTheme} themes={allThemes} onChange={handleChangeTheme} />
      </div>

      {/* Menu Items */}
      <div className="py-1">
        <button
          onClick={() => {
            triggerHaptic(10);
            setShowProfileMenu(false);
            setActiveTab('user_settings');
          }}
          className={`w-full px-3.5 py-2.5 text-left flex items-center gap-2.5 hover:bg-panel-elevated transition-colors ${
            activeTab === 'user_settings' ? 'text-accent font-semibold' : 'text-main'
          }`}
        >
          <Settings className="w-4 h-4 text-accent" />
          <span>Kontoeinstellungen</span>
        </button>

        {!isSharingDisabled() && (
        <button
          onClick={() => {
            triggerHaptic(10);
            setShowProfileMenu(false);
            setActiveTab('groups');
          }}
          className={`w-full px-3.5 py-2.5 text-left flex items-center gap-2.5 hover:bg-panel-elevated transition-colors ${
            activeTab === 'groups' ? 'text-accent font-semibold' : 'text-main'
          }`}
        >
          <Users className="w-4 h-4 text-accent" />
          <span>Gruppen</span>
        </button>
        )}

        <button
          onClick={handleOpenHelp}
          className={`w-full px-3.5 py-2.5 text-left flex items-center gap-2.5 hover:bg-panel-elevated transition-colors ${
            activeTab === 'help' ? 'text-accent font-semibold' : 'text-main'
          }`}
        >
          <HelpCircle className="w-4 h-4 text-accent" />
          <span>Hilfe & Anleitung</span>
        </button>

        {isServerAdmin && (
          <button
            onClick={() => {
              triggerHaptic(10);
              setShowProfileMenu(false);
              setActiveTab('admin_settings');
            }}
            className={`w-full px-3.5 py-2.5 text-left flex items-center gap-2.5 hover:bg-panel-elevated transition-colors ${
              activeTab === 'admin_settings'
                ? 'text-accent font-semibold'
                : 'text-main'
            }`}
          >
            <Shield className="w-4 h-4 text-accent" />
            <span>Administration</span>
          </button>
        )}
      </div>

      {/* Logout */}
      <div className="py-1">
        <button
          onClick={handleLogout}
          className="w-full px-3.5 py-2.5 text-left flex items-center gap-2.5 text-status-err hover:bg-status-err-bg transition-colors"
        >
          <LogOut className="w-4 h-4" />
          <span>Abmelden</span>
        </button>
      </div>
    </div>
  );
}

// Phones: the same as a sheet from the bottom, with the app install offer, "Über MindSift" and the version
export function MobileProfileSheet({
  user,
  roleLabel,
  activeTab,
  setActiveTab,
  activeTheme,
  allThemes,
  handleChangeTheme,
  isServerAdmin,
  handleOpenHelp,
  handleLogout,
  setShowMobileProfile,
  setShowAbout,
  pwa,
}: ProfileMenuProps & {
  setShowMobileProfile: (show: boolean) => void;
  setShowAbout: (show: boolean) => void;
  pwa: ReturnType<typeof usePwaInstall>;
}) {
  const { isStandaloneApp, setShowManualPwaGuide, setShowPwaInstallModal } = pwa;
  return (
    <div
      className="sm:hidden fixed inset-0 !m-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => setShowMobileProfile(false)}
    >
      <div
        className="w-full max-h-[85vh] overflow-y-auto bg-panel border-t border-border rounded-t-2xl shadow-panel p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] space-y-4 animate-in slide-in-from-bottom duration-200 divide-y divide-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* User Info Header */}
        <div className="flex items-center justify-between pb-2">
          <div className="flex items-center gap-3">
            <UserAvatar user={user} size="lg" className="border border-border/80 shadow-sm" />
            <div>
              <p className="font-bold text-sm text-main">{user.displayName}</p>
              <p className="text-xs text-muted">{user.email}</p>
              <span className="inline-block mt-1 px-1.5 py-0.5 bg-canvas border border-border rounded-btn text-[10px] text-accent font-semibold">
                {roleLabel}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowMobileProfile(false)}
            className="p-1 text-faint hover:text-main rounded-btn transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Theme Quick Switcher */}
        <div className="pt-3 space-y-2">
          <span className="text-[11px] font-semibold text-muted uppercase tracking-wider flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5 text-accent" />
            <span>Design-Theme</span>
          </span>
          <ThemeQuickPicker activeTheme={activeTheme} themes={allThemes} onChange={handleChangeTheme} touch />
        </div>

        {/* Menu Items */}
        <div className="pt-3 space-y-1">
          {!isStandaloneApp && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(10);
                setShowMobileProfile(false);
                setShowManualPwaGuide(false);
                setShowPwaInstallModal(true);
              }}
              className="w-full px-3 py-2.5 rounded-btn text-left flex items-center gap-3 bg-accent/10 border border-accent/30 text-accent font-semibold transition-colors text-xs cursor-pointer mb-1"
            >
              <Smartphone className="w-4 h-4 text-accent" />
              <span>Web-App auf Smartphone installieren</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setShowMobileProfile(false);
              setActiveTab('user_settings');
            }}
            className={`w-full px-3 py-2.5 rounded-btn text-left flex items-center gap-3 hover:bg-panel-elevated transition-colors text-xs cursor-pointer ${
              activeTab === 'user_settings' ? 'text-accent font-semibold bg-panel-elevated' : 'text-main'
            }`}
          >
            <Settings className="w-4 h-4 text-accent" />
            <span>Kontoeinstellungen</span>
          </button>

          {!isSharingDisabled() && (
          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setShowMobileProfile(false);
              setActiveTab('groups');
            }}
            className={`w-full px-3 py-2.5 rounded-btn text-left flex items-center gap-3 hover:bg-panel-elevated transition-colors text-xs cursor-pointer ${
              activeTab === 'groups' ? 'text-accent font-semibold bg-panel-elevated' : 'text-main'
            }`}
          >
            <Users className="w-4 h-4 text-accent" />
            <span>Gruppen</span>
          </button>
          )}

          <button
            type="button"
            onClick={() => {
              setShowMobileProfile(false);
              handleOpenHelp();
            }}
            className={`w-full px-3 py-2.5 rounded-btn text-left flex items-center gap-3 hover:bg-panel-elevated transition-colors text-xs cursor-pointer ${
              activeTab === 'help' ? 'text-accent font-semibold bg-panel-elevated' : 'text-main'
            }`}
          >
            <HelpCircle className="w-4 h-4 text-accent" />
            <span>Hilfe & Anleitung</span>
          </button>

          <button
            type="button"
            onClick={() => {
              triggerHaptic(10);
              setShowMobileProfile(false);
              setShowAbout(true);
            }}
            className="w-full px-3 py-2.5 rounded-btn text-left flex items-center gap-3 hover:bg-panel-elevated transition-colors text-xs cursor-pointer text-main"
          >
            <Brain className="w-4 h-4 text-accent" />
            <span>Über MindSift</span>
          </button>

          {isServerAdmin && (
            <button
              type="button"
              onClick={() => {
                triggerHaptic(10);
                setShowMobileProfile(false);
                setActiveTab('admin_settings');
              }}
              className={`w-full px-3 py-2.5 rounded-btn text-left flex items-center gap-3 hover:bg-panel-elevated transition-colors text-xs cursor-pointer ${
                activeTab === 'admin_settings' ? 'text-accent font-semibold bg-panel-elevated' : 'text-main'
              }`}
            >
              <Shield className="w-4 h-4 text-accent" />
              <span>Administration</span>
            </button>
          )}
        </div>

        {/* Logout */}
        <div className="pt-3">
          <button
            type="button"
            onClick={() => {
              setShowMobileProfile(false);
              handleLogout();
            }}
            className="w-full px-3 py-2.5 rounded-btn text-left flex items-center gap-3 text-status-err hover:bg-status-err-bg transition-colors text-xs font-medium cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>Abmelden</span>
          </button>
        </div>

        {/* Version & About Hint on Mobile */}
        <div className="pt-2 text-center text-[10px] text-faint font-mono">
          MindSift {APP_VERSION}
        </div>
      </div>
    </div>
  );
}
