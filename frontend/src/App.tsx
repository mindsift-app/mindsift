import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Layers,
  CheckSquare,
  FileText,
  ShoppingCart,
  RotateCcw,
  Trash2,
  Plus,
  Users,
} from 'lucide-react';
import { CenterEntry, Thought, User, UserTheme } from './lib/types';
import {
  api,
  clearToken,
  triggerHaptic,
  disconnectWebSocket,
  isSharingDisabled,
} from './lib/api';
import {
  AVAILABLE_THEMES,
  customThemeOption,
  initThemeOnBoot,
  watchSystemScheme,
  isCustomThemeId,
  setActiveTheme as applyTheme,
  ThemeId,
} from './lib/theme';
import { SetupAndAuthView } from './features/auth/SetupAndAuthView';
import { FinishSetupView } from './features/auth/FinishSetupView';
import { OAuthConsentView } from './features/auth/OAuthConsentView';
import { OfflineBanner } from './components/OfflineBanner';
import { DemoHint } from './components/DemoHint';
import { useConnectionState } from './lib/useConnectionState';
import { SharedImportToast } from './components/SharedImportToast';
import { EmailConfirmToast } from './components/EmailConfirmToast';
import { useMobileActions } from './context/MobileActionContext';
import { MobileHeaderMenu } from './components/MobileHeaderMenu';
import { AppFooter } from './components/AppFooter';
import { AboutModal } from './components/AboutModal';
import { ConfirmHost, askConfirm } from './components/askConfirm';
import { outboxCount } from './lib/offline';
import { unsentNoteCount } from './lib/docSync/persist';
import { flushClosedNotes } from './lib/docSync/flushClosed';
import { ErrorNoticeHost } from './components/ErrorNotice';
import { UpdateAvailableModal } from './components/UpdateAvailableModal';
import { useUpdateCheck } from './lib/useUpdateCheck';
import { consumePendingShares, formatSharedThought } from './lib/shareTarget';
import { readViewSession, writeViewSession } from './lib/viewSession';
import { reportNav, onNavStep } from './lib/navHistory';
import { setVoiceLanguage, setVoicePreference } from './lib/voice';
import { isPhoneWidth } from './lib/breakpoints';
import { APP_TABS, ActiveTab } from './app/appTabs';
import { ViewErrorBoundary } from './app/ViewErrorBoundary';
import { useScrollPositions } from './app/useScrollPositions';
import { MobileNav } from './app/MobileNav';
import { useCommandPaletteShortcuts } from './app/useCommandPaletteShortcuts';
import { usePwaInstall } from './app/usePwaInstall';
import { PwaInstallSheet } from './app/PwaInstallSheet';
import { MobileProfileSheet, ProfileDropdown } from './app/ProfileMenus';
import { useMobileCapture } from './app/useMobileCapture';
import { MobileCaptureSheet } from './app/MobileCaptureSheet';
import { MobileHeaderBar } from './app/AppHeader';
import { NavRail } from './app/NavRail';
import { QuickDumpWindow, useQuickDumpShortcut } from './app/QuickDumpWindow';
import { useSessionBootstrap } from './app/useSessionBootstrap';
import { useMainViews } from './app/useMainViews';
import { AppLoading } from './app/AppLoading';
import { rememberMentionNames } from './lib/mentions';
import { NotificationBell } from './components/NotificationBell';
import i18n, { applyLanguage, resolveLanguage } from './i18n';
import { useTranslation } from 'react-i18next';

// Server admins and user managers reach the administration
const canAdminister = (u: User) => u.role === 'admin' || u.role === 'manager';


// The item a link points to (?note=…, ?task=…, ?list=…)
function parseDeepLink(search: string) {
  const params = new URLSearchParams(search);
  return { note: params.get('note'), task: params.get('task'), list: params.get('list') };
}

export const App: React.FC = () => {
  const { t } = useTranslation('app');
  const [activeTheme, setActiveThemeState] = useState<ThemeId>(() => initThemeOnBoot());
  // Profile Dropdown State
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  // Sign-in state, counters, the triage deck and lists, the realtime connection and the demo reset
  const {
    bootLoading,
    authStatus,
    setAuthStatus,
    user,
    setUser,
    setupPending,
    setSetupPending,
    mfaSetupRequired,
    setMfaSetupRequired,
    stats,
    setStats,
    deck,
    setDeck,
    lists,
    refreshAll,
    refreshStats,
    demoDeadline,
    dataEpoch,
    demoNotice,
    setDemoNotice,
    handleDemoCountdownElapsed,
  } = useSessionBootstrap(() => setShowProfileMenu(false));
  // The views come as a chunk of their own, loaded once someone is signed in (app/mainViews.ts)
  const { views, failed: viewsFailed, retry: retryViews } = useMainViews(Boolean(user));
  // Just shared from another app: these Quick Dump entries can still be sent on as task / list item
  const [sharedImportIds, setSharedImportIds] = useState<string[] | null>(null);
  const closeSharedImport = useCallback(() => setSharedImportIds(null), []);
  // Link from the password reset mail (?resetToken=…); removed from the address bar right away
  const [resetToken, setResetToken] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('resetToken');
    } catch {
      return null;
    }
  });
  useEffect(() => {
    if (resetToken) window.history.replaceState(null, '', window.location.pathname);
  }, [resetToken]);
  // Mentions of oneself show one's own name (the directory leaves oneself out)
  useEffect(() => {
    if (user) rememberMentionNames([user]);
  }, [user]);
  const [customThemes, setCustomThemes] = useState<UserTheme[]>([]);
  const allThemes = useMemo(() => [...AVAILABLE_THEMES, ...customThemes.map(customThemeOption)], [customThemes]);
  // The open tab survives a reload of this browser tab (lib/viewSession); a new tab starts at the triage
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const tab = readViewSession<{ tab: ActiveTab }>('app').tab;
    return tab && APP_TABS.includes(tab) ? tab : 'triage';
  });
  useEffect(() => writeViewSession('app', { tab: activeTab }), [activeTab]);
  // Browser back/forward steps through the app's pages (lib/navHistory.ts)
  useEffect(() => reportNav({ tab: activeTab }), [activeTab]);
  useEffect(
    () =>
      onNavStep((place) => {
        if ((APP_TABS as readonly string[]).includes(place.tab)) setActiveTab(place.tab as ActiveTab);
      }),
    []
  );
  // Whisper or the browser for voice input: the account's choice (lib/voice.ts)
  useEffect(() => setVoicePreference(user?.voiceInput), [user?.voiceInput]);
  // Language spoken into the microphone: app language, automatic or a fixed one (lib/voice.ts)
  useEffect(() => setVoiceLanguage(user?.voiceLanguage), [user?.voiceLanguage]);
  // Language: the account's choice, else the browser's, else the server's default (i18n/index.ts)
  useEffect(
    () => {
      void applyLanguage(resolveLanguage(user?.language, authStatus.defaultLanguage));
    },
    [user?.language, authStatus.defaultLanguage]
  );
  useEffect(() => {
    if (user && !canAdminister(user) && activeTab === 'admin_settings') setActiveTab('triage');
  }, [user, activeTab]);
  const [previousTab, setPreviousTab] = useState<ActiveTab>('triage');
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [openDocNonce, setOpenDocNonce] = useState(0);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [captureFocusCount, setCaptureFocusCount] = useState(0);
  // Desktop: the Quick Dump window (app/QuickDumpWindow.tsx)
  const [showQuickDump, setShowQuickDump] = useState(false);
  const closeQuickDump = useCallback(() => setShowQuickDump(false), []);
  const [refreshRevision, setRefreshRevision] = useState(0);

  const connection = useConnectionState();

  // Desktop: the window does not scroll; this area under the header does (phones keep the window scroll)
  const scrollAreaRef = useScrollPositions(activeTab, user?.id);
  const [showAbout, setShowAbout] = useState(false);
  const [showTriageTrash, setShowTriageTrash] = useState(false);
  const { update: availableUpdate, dismiss: dismissUpdate } = useUpdateCheck();
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Mobile Navigation & Quick-Action State
  const [showMobileProfile, setShowMobileProfile] = useState(false);

  const { isMenuOpen, setIsMenuOpen, closeMenu, setGroups, primaryAction, setPrimaryAction } = useMobileActions();
  const primaryActionRef = useRef(primaryAction);
  primaryActionRef.current = primaryAction;

  // App icon shortcuts (manifest "shortcuts", long-press on the icon): open the tab and its input right away.
  // ?shortcut=quickdump|task|list; the old links (?mode=capture, ?tab=triage) still lead to the Quick Dump.
  const [pendingShortcut, setPendingShortcut] = useState<ActiveTab | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const target = params.get('shortcut') || (params.get('mode') === 'capture' || params.get('tab') === 'triage' ? 'quickdump' : '');
    return ({ quickdump: 'triage', task: 'tasks', list: 'lists' } as Record<string, ActiveTab>)[target] || null;
  });
  useEffect(() => {
    if (!pendingShortcut || !user?.id) return;
    if (activeTab !== pendingShortcut) {
      setActiveTab(pendingShortcut);
      return;
    }
    const target = pendingShortcut;
    setPendingShortcut(null);
    const url = new URL(window.location.href);
    ['shortcut', 'mode', 'tab'].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    // The view registers its "+" action once it is mounted, so wait a moment (no cleanup: resetting
    // pendingShortcut above re-runs this effect and must not cancel the timer)
    window.setTimeout(() => {
      if (target === 'triage') handleTriggerAddButton();
      else if (isPhoneWidth() || target === 'lists') primaryActionRef.current?.();
    }, 400);
    // handleTriggerAddButton is declared further down; it reads the screen width, a ref and stable functions
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShortcut, user?.id, activeTab]);

  useEffect(() => {
    closeMenu();
    if (activeTab === 'triage') {
      setPrimaryAction(openMobileTriageCapture);
      setGroups([
        {
          id: 'triage-actions',
          title: t('menu.quickActions'),
          items: [
            {
              id: 'new-thought',
              label: t('menu.newThought'),
              icon: <Plus className="w-4 h-4" />,
              variant: 'accent',
              onClick: () => openMobileTriageCapture(),
            },
            {
              id: 'refresh-deck',
              label: t('menu.refreshInbox'),
              icon: <RotateCcw className="w-4 h-4" />,
              badge: stats.inboxCount,
              onClick: () => refreshAll(),
            },
            {
              id: 'triage-trash',
              label: t('common:trash'),
              icon: <Trash2 className="w-4 h-4" />,
              badge: stats.discardedCount,
              onClick: () => setShowTriageTrash(true),
            },
          ],
        },
        {
          id: 'triage-nav',
          title: t('menu.switchArea'),
          items: [
            {
              id: 'goto-workspace',
              label: t('menu.gotoWorkspace'),
              icon: <FileText className="w-4 h-4" />,
              badge: stats.docsCount,
              onClick: () => setActiveTab('workspace'),
            },
            {
              id: 'goto-tasks',
              label: t('menu.gotoTasks'),
              icon: <CheckSquare className="w-4 h-4" />,
              badge: stats.tasksOpenCount,
              onClick: () => setActiveTab('tasks'),
            },
            {
              id: 'goto-lists',
              label: t('menu.gotoLists'),
              icon: <ShoppingCart className="w-4 h-4" />,
              badge: stats.listsCount,
              onClick: () => setActiveTab('lists'),
            },
            ...(isSharingDisabled()
              ? []
              : [
                  {
                    id: 'goto-groups',
                    label: t('profile.groups'),
                    icon: <Users className="w-4 h-4" />,
                    onClick: () => setActiveTab('groups'),
                  },
                ]),
          ],
        },
      ]);
    } else if (
      activeTab === 'groups' ||
      activeTab === 'user_settings' ||
      activeTab === 'admin_settings' ||
      activeTab === 'help'
    ) {
      setGroups([
        {
          id: 'subview-nav',
          title: t('menu.navigation'),
          items: [
            {
              id: 'back-triage',
              label: t('menu.backToTriage'),
              icon: <Layers className="w-4 h-4" />,
              variant: 'accent',
              onClick: () => setActiveTab('triage'),
            },
            {
              id: 'goto-workspace',
              label: t('menu.toWorkspace'),
              icon: <FileText className="w-4 h-4" />,
              onClick: () => setActiveTab('workspace'),
            },
            {
              id: 'goto-tasks',
              label: t('menu.toTasks'),
              icon: <CheckSquare className="w-4 h-4" />,
              onClick: () => setActiveTab('tasks'),
            },
            {
              id: 'goto-lists',
              label: t('menu.toLists'),
              icon: <ShoppingCart className="w-4 h-4" />,
              onClick: () => setActiveTab('lists'),
            },
          ],
        },
      ]);
    }
    // openMobileTriageCapture is declared further down and stays the same function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, stats.inboxCount, stats.tasksOpenCount, stats.docsCount, stats.listsCount, stats.discardedCount, t, closeMenu, setGroups, setPrimaryAction, refreshAll]);

  // Mobile Web-App (PWA) installation: offered once per session on phones, and from the header and profile
  const pwa = usePwaInstall(user?.id);

  const handleOpenHelp = () => {
    triggerHaptic(10);
    setPreviousTab((prev) => (activeTab === 'help' ? prev : activeTab));
    setActiveTab('help');
    setShowProfileMenu(false);
  };

  const activateTheme = (themeId: ThemeId, themes: UserTheme[]) => {
    const css = themes.find((t) => 'custom:' + t.id === themeId)?.css;
    applyTheme(themeId, css);
    setActiveThemeState(isCustomThemeId(themeId) && css === undefined ? 'dark' : themeId);
  };

  // "Wie System": the theme follows the system's light/dark switch while the app is open
  useEffect(() => watchSystemScheme(setActiveThemeState), []);

  const handleChangeTheme = (themeId: ThemeId) => {
    triggerHaptic(10);
    activateTheme(themeId, customThemes);
  };

  // Custom themes live on the server; after login refresh them and the active one (it may have
  // been edited or deleted on another device)
  const handleCustomThemesChange = (themes: UserTheme[], activate?: ThemeId) => {
    setCustomThemes(themes);
    const next = activate ?? activeTheme;
    if (activate || isCustomThemeId(next)) activateTheme(next, themes);
  };
  useEffect(() => {
    if (!user?.id) return;
    api
      .getThemes()
      .then((themes) => handleCustomThemesChange(themes))
      .catch(() => {});
    // Once per sign-in
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Web Share Target: import shared thoughts from external apps
  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const hasPendingShare = params.get('shared') === 'pending';

    const processShares = async () => {
      try {
        const shares = await consumePendingShares();
        if (shares.length === 0) return;

        let importedCount = 0;
        const ids: string[] = [];
        for (const share of shares) {
          const content = formatSharedThought(share);
          if (content) {
            const created = await api.captureThought(content, 'normal', 'manual', '', { target: 'inbox' });
            importedCount++;
            if (created?.id && !created.id.startsWith('th_offline_')) ids.push(created.id);
          }
        }

        if (importedCount > 0) {
          triggerHaptic(15);
          if (ids.length === importedCount) {
            setSharedImportIds(ids);
          } else {
            // Offline: kept for later, nothing to convert yet
            setDemoNotice(i18n.t('app:sharedQueued'));
            setTimeout(() => setDemoNotice(null), 4000);
          }
          refreshAll();
        }
      } catch (err) {
        console.error('Importing shared data failed:', err);
      } finally {
        if (hasPendingShare) {
          const url = new URL(window.location.href);
          url.searchParams.delete('shared');
          window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
        }
      }
    };

    processShares();
  }, [user, refreshAll, setDemoNotice]);

  // Close profile dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleAuthenticated = async (loggedInUser: User) => {
    setUser(loggedInUser);
    setAuthStatus((prev) => ({ ...prev, needsSetup: false }));
    setActiveTab('triage');
    await refreshAll();
  };

  const handleCaptured = (
    thought: Thought,
    target: 'inbox' | 'task' | 'list_item' | 'document' = 'inbox'
  ) => {
    if (target === 'inbox' && thought.status === 'inbox') {
      setDeck((prev) => {
        if (prev.some((t) => t.id === thought.id)) return prev;
        return [thought, ...prev];
      });
      setStats((prev) => ({ ...prev, inboxCount: prev.inboxCount + 1 }));
    } else if (target === 'document' && thought.convertedRefId) {
      setSelectedDocId(thought.convertedRefId);
      setActiveTab('workspace');
    }
    setRefreshRevision((r) => r + 1);
    refreshAll();
  };

  // Phones: the Quick Dump sheet with voice input (the + without an action of the open view)
  const capture = useMobileCapture(handleCaptured);
  const { openMobileTriageCapture } = capture;

  const handleOpenDocument = (docId: string, blockId?: string) => {
    setSelectedDocId(docId);
    // Counts up, so the same note opens again after another one was picked in the sidebar
    setOpenDocNonce((n) => n + 1);
    setSelectedBlockId(blockId || null);
    setActiveTab('workspace');
  };

  const handleOpenTask = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    setActiveTab('tasks');
  }, []);

  const handleOpenList = (listId: string) => {
    setSelectedListId(listId);
    setActiveTab('lists');
  };

  // An entry of the notification center: its task, note (at the bullet) or list
  const handleOpenCenterEntry = (entry: CenterEntry) => {
    if (!entry.targetId) return;
    if (entry.targetType === 'task') handleOpenTask(entry.targetId);
    else if (entry.targetType === 'note') handleOpenDocument(entry.targetId, entry.blockId || undefined);
    else if (entry.targetType === 'list') handleOpenList(entry.targetId);
    else if (entry.targetType === 'tasklist') setActiveTab('tasks');
    else if (entry.targetType === 'folder') setActiveTab('workspace');
  };

  // Links from the MCP server (?note=…, ?task=…, ?list=…): open the item once signed in, then drop the
  // parameter from the address bar. The installed app takes such links over (manifest: handle_links); an
  // open app window is brought to the front and gets the link through the launch queue, without a reload
  const [deepLink, setDeepLink] = useState(() => parseDeepLink(window.location.search));
  useEffect(() => {
    const queue = (window as { launchQueue?: { setConsumer: (fn: (p: { targetURL?: string }) => void) => void } }).launchQueue;
    queue?.setConsumer((launch) => {
      if (launch.targetURL) setDeepLink(parseDeepLink(new URL(launch.targetURL).search));
    });
  }, []);
  useEffect(() => {
    if (!user?.id || !(deepLink.note || deepLink.task || deepLink.list)) return;
    if (deepLink.note) {
      setSelectedDocId(deepLink.note);
      setOpenDocNonce((n) => n + 1);
      setSelectedBlockId(null);
      setActiveTab('workspace');
    } else if (deepLink.task) {
      setSelectedTaskId(deepLink.task);
      setActiveTab('tasks');
    } else if (deepLink.list) {
      setSelectedListId(deepLink.list);
      setActiveTab('lists');
    }
    deepLink.note = deepLink.task = deepLink.list = null;
    const url = new URL(window.location.href);
    ['note', 'task', 'list'].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }, [user?.id, deepLink]);

  useCommandPaletteShortcuts(setShowCommandPalette);

  // Desktop: opens the Quick Dump window and puts the cursor into it
  const openQuickDump = useCallback(() => {
    setShowQuickDump(true);
    setCaptureFocusCount((c) => c + 1);
  }, []);
  useQuickDumpShortcut(openQuickDump);

  const handleTriggerAddButton = () => {
    triggerHaptic(20);
    if (isPhoneWidth()) {
      openMobileTriageCapture();
    } else {
      openQuickDump();
    }
  };

  const handleLogout = async () => {
    triggerHaptic(20);
    // Unsent changes live only in this browser and are deleted with the session: send what can be sent,
    // and ask before dropping the rest
    if (navigator.onLine && outboxCount() + unsentNoteCount() > 0) {
      await api.flushOfflineQueue();
      await flushClosedNotes();
    }
    const unsent = outboxCount() + unsentNoteCount();
    if (unsent > 0) {
      const ok = await askConfirm({
        message: t('logoutUnsent', { count: unsent }),
        confirmLabel: t('profile.logout'),
        danger: true,
      });
      if (!ok) return;
    }
    disconnectWebSocket();
    try {
      await api.logout();
    } catch {
      clearToken();
    }
    setUser(null);
    setShowProfileMenu(false);
    setActiveTab('triage');
    try {
      const st = await api.getAuthStatus();
      setAuthStatus(st);
    } catch {
      // ignore
    }
  };

  if (bootLoading) {
    return <AppLoading />;
  }

  // Show Setup Wizard or Login Screen if needsSetup or not logged in
  if (authStatus.needsSetup || !user || resetToken) {
    return (
      <>
      <EmailConfirmToast />
      <SetupAndAuthView
        authStatus={authStatus}
        onAuthenticated={handleAuthenticated}
        resetToken={resetToken}
        onResetDone={() => {
          // The new password ended every session, this one included
          setResetToken(null);
          clearToken();
          setUser(null);
        }}
        onResetCancel={() => setResetToken(null)}
      />
      </>
    );
  }

  // The first admin came from ADMIN_USER / ADMIN_PASSWORD: the wizard's instance settings come first
  if (setupPending && user.role === 'admin') {
    return (
      <FinishSetupView
        user={user}
        authStatus={authStatus}
        onDone={() => {
          setSetupPending(false);
          api.getAuthStatus().then(setAuthStatus).catch(() => {});
          void refreshAll();
        }}
        onLogout={handleLogout}
      />
    );
  }

  // The administration requires a second factor this account has not set up yet: nothing else answers until then
  if (mfaSetupRequired) {
    if (!views) return <AppLoading onRetry={viewsFailed ? retryViews : undefined} />;
    return (
      <views.MfaSetupRequiredView
        user={user}
        authStatus={authStatus}
        onDone={() => {
          setMfaSetupRequired(false);
          void refreshAll();
        }}
        onLogout={handleLogout}
      />
    );
  }

  // Consent of the OAuth flow (claude.ai, ChatGPT connect over MCP) instead of the app; after logging in
  // the address is still /oauth/authorize, so the consent follows the login
  if (window.location.pathname === '/oauth/authorize') {
    return <OAuthConsentView user={user} instanceName={authStatus.instanceName || 'MindSift'} onLogout={handleLogout} />;
  }

  if (!views) {
    return <AppLoading onRetry={viewsFailed ? retryViews : undefined} />;
  }

  // Server admins and user managers reach the administration (managers only its people sections)
  const isServerAdmin = canAdminister(user);
  const roleLabel = t(`common:role.${user.role}`);

  const activeTabLabelMap: Record<ActiveTab, string> = {
    triage: t('common:nav.triage'),
    tasks: t('common:nav.tasks'),
    workspace: t('common:nav.workspace'),
    lists: t('common:nav.lists'),
    groups: t('profile.groups'),
    user_settings: t('tabs.settings'),
    admin_settings: t('profile.admin'),
    help: t('tabs.help'),
  };

  return (
    <div
      className={`bg-canvas text-main flex flex-col font-sans selection:bg-accent/30 sm:h-[100dvh] sm:overflow-hidden sm:pl-[var(--app-rail-w)] ${
        activeTab === 'workspace' ? 'h-[100dvh] overflow-hidden' : 'min-h-[100dvh]'
      }`}
    >
      {/* Top Header Bar: floating on phones; desktop has the navigation rail instead */}
      <header className="sticky top-0 z-30 bg-canvas/85 backdrop-blur-md sm:hidden">
        {/* Mobile Header: Floating Bar with Logo Action Dropdown Left & Profile Avatar Right */}
        <MobileHeaderBar
          isMenuOpen={isMenuOpen}
          setIsMenuOpen={setIsMenuOpen}
          authStatus={authStatus}
          demoDeadline={demoDeadline}
          handleDemoCountdownElapsed={handleDemoCountdownElapsed}
          pwa={pwa}
          setShowCommandPalette={setShowCommandPalette}
          setShowMobileProfile={setShowMobileProfile}
          activeTab={activeTab}
          user={user}
          connection={connection}
          bell={<NotificationBell variant="phone" onOpen={handleOpenCenterEntry} />}
        />
      </header>

      {/* Desktop: navigation rail on the left (fixed; the page keeps its width when it is expanded) */}
      <NavRail
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        stats={stats}
        authStatus={authStatus}
        demoDeadline={demoDeadline}
        handleDemoCountdownElapsed={handleDemoCountdownElapsed}
        onQuickDump={() => {
          triggerHaptic(20);
          openQuickDump();
        }}
        onSearch={() => setShowCommandPalette(true)}
        handleOpenHelp={handleOpenHelp}
        user={user}
        connection={connection}
        dropdownRef={dropdownRef}
        showProfileMenu={showProfileMenu}
        setShowProfileMenu={setShowProfileMenu}
        renderBell={(expanded) => <NotificationBell variant="desktop" expanded={expanded} onOpen={handleOpenCenterEntry} />}
        profileMenu={
          <ProfileDropdown
            user={user}
            roleLabel={roleLabel}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            activeTheme={activeTheme}
            allThemes={allThemes}
            handleChangeTheme={handleChangeTheme}
            isServerAdmin={isServerAdmin}
            handleOpenHelp={handleOpenHelp}
            handleLogout={handleLogout}
            setShowProfileMenu={setShowProfileMenu}
          />
        }
      />
      <QuickDumpWindow
        open={showQuickDump}
        onClose={closeQuickDump}
        lists={lists}
        focusTrigger={captureFocusCount}
        onCaptured={(thought, target) => {
          // A new note opens in the workspace: the window makes way for it
          if (target === 'document') setShowQuickDump(false);
          handleCaptured(thought, target);
        }}
      />
      {authStatus.demoMode && <DemoHint minutes={authStatus.demoResetMinutes} />}

      <MobileHeaderMenu activeTabLabel={activeTabLabelMap[activeTab]} />
      <OfflineBanner />
      <EmailConfirmToast onConfirmed={() => api.getMe().then((me) => setUser(me.user)).catch(() => {})} />
      {sharedImportIds && (
        <SharedImportToast
          thoughtIds={sharedImportIds}
          lists={lists}
          onClose={closeSharedImport}
          onConverted={(message) => {
            setSharedImportIds(null);
            setDemoNotice(message);
            setTimeout(() => setDemoNotice(null), 3000);
            refreshAll();
          }}
        />
      )}
      {demoNotice && (
        <div
          role="status"
          className="fixed left-1/2 -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] sm:bottom-4 z-[60] px-3 py-1.5 rounded-full border border-accent/40 bg-panel-elevated text-main text-[11px] font-medium shadow-panel"
        >
          ✨ {demoNotice}
        </div>
      )}

      {/* Main Container */}
      {/* Desktop: the window never scrolls, only this area beside the navigation rail (room for the scrollbar
          kept on both sides, so the content stays centred and nothing shifts between pages). The
          workspace fills it exactly and scrolls only inside the note. Phones scroll the window as before. */}
      <div
        ref={scrollAreaRef}
        data-app-scroll
        className={`flex-1 flex flex-col min-h-0 sm:[scrollbar-gutter:stable_both-edges] ${
          activeTab === 'workspace' ? 'sm:overflow-hidden' : 'sm:overflow-y-auto'
        }`}
      >
      <main
        className={`flex-1 w-full px-3 sm:px-6 pt-3 sm:pt-2.5 pb-24 ${
          activeTab === 'workspace'
            ? 'min-h-0 flex flex-col sm:pb-0'
            : activeTab === 'triage'
            ? 'sm:min-h-0 sm:flex sm:flex-col sm:pb-6'
            : 'sm:pb-6'
        }`}
      >
        <ViewErrorBoundary onReset={() => setActiveTab('triage')}>
          <section
            key={dataEpoch}
            className={
              activeTab === 'workspace'
                ? 'flex-1 min-h-0 flex flex-col'
                : activeTab === 'triage'
                ? 'sm:flex-1 sm:min-h-0 sm:flex sm:flex-col' // the queue fills the rest of the height (TriageDeck)
                : undefined
            }
          >
            {activeTab === 'triage' && (
              <views.TriageDeck
                deck={deck}
                lists={lists}
                onDeckChange={refreshAll}
                onOpenDocument={handleOpenDocument}
                onFocusCapture={handleTriggerAddButton}
                discardedCount={stats.discardedCount}
                onOpenTrash={() => setShowTriageTrash(true)}
              />
            )}

            {activeTab === 'tasks' && (
              <views.TasksView
                currentUser={user}
                onRefreshStats={refreshStats}
                onOpenDocument={handleOpenDocument}
                refreshTrigger={refreshRevision}
                initialSelectedTaskId={selectedTaskId}
                onInitialTaskShown={() => setSelectedTaskId(null)}
                openTasksCount={stats.tasksOpenCount}
              />
            )}

            {activeTab === 'workspace' && (
              <views.WorkspaceView
                currentUser={user}
                initialDocId={selectedDocId}
                initialBlockId={selectedBlockId}
                openDocNonce={openDocNonce}
                demoMode={!!authStatus.demoMode}
                onStatsChange={refreshStats}
                onOpenTask={handleOpenTask}
                onOpenSearch={() => setShowCommandPalette(true)}
              />
            )}

            {activeTab === 'help' && (
              <views.HelpView onBack={() => setActiveTab(previousTab || 'triage')} />
            )}

            {activeTab === 'lists' && (
              <views.SharedListsView
                onRefreshGlobal={refreshAll}
                currentUser={user}
                initialListId={selectedListId}
                onInitialListShown={() => setSelectedListId(null)}
              />
            )}

            {activeTab === 'groups' && (
              <views.GroupsView
                currentUser={user}
                onBack={() => setActiveTab(previousTab || 'triage')}
              />
            )}

            {activeTab === 'user_settings' && (
              <views.UserSettingsView
                currentUser={user}
                activeTheme={activeTheme}
                themes={allThemes}
                customThemes={customThemes}
                onThemeChange={handleChangeTheme}
                onCustomThemesChange={handleCustomThemesChange}
                onUserUpdated={(u) => {
                  setUser(u);
                  refreshAll();
                }}
                onBack={() => setActiveTab('triage')}
              />
            )}

            {activeTab === 'admin_settings' && isServerAdmin && (
              <views.AdminSettingsView
                currentUser={user}
                onBack={() => setActiveTab('triage')}
              />
            )}
          </section>
        </ViewErrorBoundary>
      </main>
      </div>

      <AppFooter
        legal={authStatus.legal}
        onOpenAbout={() => setShowAbout(true)}
      />

      {/* MOBILE BOTTOM NAVIGATION BAR (5 equal columns -> + FAB is dead-center) */}
      <MobileNav
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        stats={stats}
        primaryAction={primaryAction}
        openMobileTriageCapture={openMobileTriageCapture}
        handleCaptured={handleCaptured}
      />

      {/* MOBILE QUICK-ADD BOTTOM SHEET / MODAL (DESIGN-ALIGNED WITH TASKS VIEW) */}
      <MobileCaptureSheet capture={capture} />

      {/* MOBILE USER PROFILE SHEET */}
      {showMobileProfile && (
        <MobileProfileSheet
          user={user}
          roleLabel={roleLabel}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          activeTheme={activeTheme}
          allThemes={allThemes}
          handleChangeTheme={handleChangeTheme}
          isServerAdmin={isServerAdmin}
          handleOpenHelp={handleOpenHelp}
          handleLogout={handleLogout}
          setShowMobileProfile={setShowMobileProfile}
          setShowAbout={setShowAbout}
          pwa={pwa}
        />
      )}

      {/* IMMEDIATE MOBILE WEB-APP INSTALLATION OFFER SHEET */}
      <PwaInstallSheet pwa={pwa} instanceName={authStatus.instanceName} />

      {/* Global Command Palette (Cmd+K / Ctrl+K / '/') */}
      <views.CommandPalette
        isOpen={showCommandPalette}
        onClose={() => setShowCommandPalette(false)}
        onOpenDocument={handleOpenDocument}
        onOpenTask={handleOpenTask}
        onOpenList={handleOpenList}
        lists={lists}
      />

      {/* Guided tour, started from the help page or the offer after the first sign-in (features/tour) */}
      <views.GuidedTour activeTab={activeTab} setActiveTab={setActiveTab} />
      {/* Once after the first sign-in, after the install offer on phones: take the tour? */}
      <views.TourOfferCard
        user={user}
        demoMode={!!authStatus.demoMode}
        suppressed={pwa.showPwaInstallModal && !pwa.isStandaloneApp}
        onUserUpdated={setUser}
      />

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
      {showTriageTrash && <views.TriageTrash onClose={() => setShowTriageTrash(false)} onChanged={refreshAll} />}
      {availableUpdate && <UpdateAvailableModal update={availableUpdate} onLater={dismissUpdate} />}
      <ConfirmHost />
      <views.SecondFactorHost />
      <ErrorNoticeHost />
    </div>
  );
};

export default App;
