import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthStatus, DashboardStats, SharedList, Thought, User, WSMessage } from '../lib/types';
import { api, clearToken, connectWebSocket, disconnectWebSocket, getToken, lastLocalWriteAt } from '../lib/api';
import { clearOfflineData, outboxCount } from '../lib/offline';
import { flushClosedNotes } from '../lib/docSync/flushClosed';
import { finishOidcReturn, oidcReturnPending } from '../lib/oidc';
import { voiceConfigFromStatus } from '../lib/voice';
import i18n from '../i18n';
import { useLatestRef } from '../lib/useLatestRef';
import { setServerLinkPreviews } from '../lib/linkPreview';
import { setServerImageQuality } from '../lib/media';
import { OWN_ECHO_WINDOW_MS, createStatsScheduler, eventChangesDeck, eventChangesStats } from './realtimeCounters';
import { createDemoResetWatch } from './demoResetWatch';

type AccountLoad = [
  PromiseSettledResult<Awaited<ReturnType<typeof api.getMe>>>,
  PromiseSettledResult<Thought[]>,
  PromiseSettledResult<SharedList[]>,
];
// The account with its counters, the triage deck and the lists; deck and lists are refused while a required
// second factor is missing, the account itself still loads
const loadAccount = (): Promise<AccountLoad> => Promise.allSettled([api.getMe(), api.getTriageDeck(), api.getAllLists()]);

// The first server status, asked for in main.tsx while the texts of the start language load, so the first
// render does not wait for the texts and then for the server in turn; taken once by the boot check below.
// The voice input takes its setting from the same answer.
let earlyAuthStatus: Promise<AuthStatus> | null = null;
// With a stored session the account loads at the same time, instead of after the status. Not when the boot
// check has to come first: on the return from the OIDC provider (the ticket may bring a new session, and a 401
// of the stored one would sign that out) and with changes made offline still waiting (they reach the server
// before deck and lists are read).
let earlyAccount: Promise<AccountLoad> | null = null;
export function prefetchAuthStatus(): void {
  earlyAuthStatus = api.getAuthStatus();
  earlyAuthStatus.catch(() => {}); // a failure is handled where it is awaited
  voiceConfigFromStatus(earlyAuthStatus);
  earlyAccount = getToken() && !oidcReturnPending() && outboxCount() === 0 ? loadAccount() : null;
}

// When the next demo reset happens, in this browser's clock (null: no periodic reset). Counted from the
// seconds the server names, so a wrong clock on either side does not matter.
const demoDeadlineFrom = (demoMode: boolean | undefined, resetInSeconds: number | undefined): number | null =>
  demoMode && typeof resetInSeconds === 'number' ? Date.now() + resetInSeconds * 1000 : null;

// The session of the app: server status (setup, registration, demo), the signed-in user with counters,
// triage deck and lists, the boot check, offline changes retried when online, the realtime connection,
// counters kept current by realtime events and the demo reset with its countdown. onSignedOut runs when
// the server rejects the session.
export function useSessionBootstrap(onSignedOut: () => void) {
  const [bootLoading, setBootLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthStatus>({
    needsSetup: false,
    allowRegistration: false,
    instanceName: 'MindSift',
  });
  const [user, setUser] = useState<User | null>(null);
  // The admin came from ADMIN_USER and has not chosen the wizard's instance settings yet (FinishSetupView)
  const [setupPending, setSetupPending] = useState(false);
  // The administration requires a second factor this account has not set up yet (MfaSetupRequiredView)
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);
  // A reset by the administration asked for a new own password first (PasswordChangeRequiredView)
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  // Demo mode: when the next reset happens (local clock), and a counter that remounts all views after it
  const [demoDeadline, setDemoDeadline] = useState<number | null>(null);
  const [dataEpoch, setDataEpoch] = useState(0);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const lastDemoResetRef = useRef(0);
  const demoDeadlineRef = useRef<number | null>(null);
  const demoWatchRef = useRef<ReturnType<typeof createDemoResetWatch> | null>(null);
  const onSignedOutRef = useLatestRef(onSignedOut);
  const [stats, setStats] = useState<DashboardStats>({
    inboxCount: 0,
    tasksOpenCount: 0,
    tasksDoneCount: 0,
    docsCount: 0,
    docsTodosOpenCount: 0,
    listItemsOpenCount: 0,
    listsCount: 0,
    discardedCount: 0,
  });
  const [deck, setDeck] = useState<Thought[]>([]);
  const [lists, setLists] = useState<SharedList[]>([]);
  const demoModeRef = useLatestRef(Boolean(authStatus.demoMode));

  // A rejected account (token expired or invalid) changes nothing: api.ts dispatches mindsift:unauthorized
  const applyAccount = useCallback(([meRes, deckRes, listsRes]: AccountLoad) => {
    if (meRes.status === 'rejected') return;
    setUser(meRes.value.user);
    setSetupPending(Boolean(meRes.value.setupPending));
    setMfaSetupRequired(Boolean(meRes.value.mfaSetupRequired));
    setPasswordChangeRequired(Boolean(meRes.value.passwordChangeRequired));
    setStats(meRes.value.stats);
    if (deckRes.status === 'fulfilled') setDeck(Array.isArray(deckRes.value) ? deckRes.value : []);
    if (listsRes.status === 'fulfilled') setLists(Array.isArray(listsRes.value) ? listsRes.value : []);
  }, []);

  const refreshAll = useCallback(async () => {
    applyAccount(await loadAccount());
  }, [applyAccount]);

  // The counters in the navigation only. refreshStats is for this tab's own changes (shortly, an action and
  // its realtime echo make one request); other people's changes reload them in a slower shared rhythm
  // (realtimeCounters.ts)
  const [statsScheduler] = useState(() =>
    createStatsScheduler(() => {
      api.getStats().then(setStats).catch(() => {});
    })
  );
  const refreshStats = useCallback(() => statsScheduler.soon(), [statsScheduler]);
  // The ids in the deck, for the realtime events that concern it
  const deckIdsRef = useRef<ReadonlySet<string>>(new Set());
  useEffect(() => {
    deckIdsRef.current = new Set(deck.map((t) => t.id));
  }, [deck]);

  useEffect(() => {
    const checkBootAndAuth = async () => {
      setBootLoading(true);
      const early = earlyAuthStatus;
      const account = earlyAccount;
      earlyAuthStatus = null;
      earlyAccount = null;
      try {
        const statusLoad = early ?? api.getAuthStatus();
        if (!early) voiceConfigFromStatus(statusLoad);
        const st = await statusLoad;
        setAuthStatus(st);

        if (st.needsSetup) {
          clearToken();
          setUser(null);
          return;
        }

        // Back from the OIDC provider: the ticket gives the session (or confirms this one) before anything else
        await finishOidcReturn();

        if (getToken() && account) {
          // Loading since main.tsx; nothing was waiting in the outbox then
          void flushClosedNotes();
          applyAccount(await account);
        } else if (getToken()) {
          await api.flushOfflineQueue();
          void flushClosedNotes();
          await refreshAll();
        } else {
          setUser(null);
        }
      } catch {
        // Server temporarily unreachable
      } finally {
        setBootLoading(false);
      }
    };
    checkBootAndAuth();

    const onUnauthorized = async () => {
      setUser(null);
      onSignedOutRef.current();
      try {
        const st = await api.getAuthStatus();
        setAuthStatus(st);
      } catch {
        // ignore
      }
    };

    const onOnline = async () => {
      if (getToken()) {
        void flushClosedNotes();
        const synced = await api.flushOfflineQueue();
        if (synced > 0) refreshAll();
      }
    };

    // Changes still waiting (server was unreachable although the device was online) are retried
    const retry = window.setInterval(() => {
      if (navigator.onLine && outboxCount() > 0) onOnline();
    }, 30000);

    // The administration switched the requirement on while this session was open
    const onMfaSetupRequired = () => setMfaSetupRequired(true);
    const onPasswordChangeRequired = () => setPasswordChangeRequired(true);

    window.addEventListener('mindsift:unauthorized', onUnauthorized);
    window.addEventListener('mindsift:mfa-setup-required', onMfaSetupRequired);
    window.addEventListener('mindsift:password-change-required', onPasswordChangeRequired);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(retry);
      window.removeEventListener('mindsift:unauthorized', onUnauthorized);
      window.removeEventListener('mindsift:mfa-setup-required', onMfaSetupRequired);
      window.removeEventListener('mindsift:password-change-required', onPasswordChangeRequired);
      window.removeEventListener('online', onOnline);
    };
  }, [refreshAll, applyAccount, onSignedOutRef]);

  // WebSocket Connection Management
  useEffect(() => {
    if (user?.id && getToken()) {
      connectWebSocket();
    } else {
      disconnectWebSocket();
    }
  }, [user?.id]);

  useEffect(() => {
    // The deadline counts from when the status arrived (Date.now() is not for render)
    const deadline = demoDeadlineFrom(authStatus.demoMode, authStatus.demoResetInSeconds);
    demoDeadlineRef.current = deadline;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDemoDeadline(deadline);
  }, [authStatus.demoMode, authStatus.demoResetInSeconds]);

  // Link previews switched off for the whole server: no cards in notes, no switch in the settings
  useEffect(() => {
    setServerLinkPreviews(authStatus.linkPreviews !== false);
  }, [authStatus.linkPreviews]);

  // How strongly new pictures are compressed before upload (the administration's choice)
  useEffect(() => {
    setServerImageQuality(authStatus.imageQuality);
  }, [authStatus.imageQuality]);

  // The demo database was reset: drop cached answers of the old data, remount the views (they load
  // fresh data), refresh counters and the countdown (unless the reset was noticed through the new deadline,
  // see below). Sessions stay valid (fixed demo account IDs).
  const handleDemoReset = useCallback((nextDeadlineKnown = false) => {
    if (Date.now() - lastDemoResetRef.current < 30000) return; // event and countdown may both report it
    lastDemoResetRef.current = Date.now();
    void clearOfflineData();
    setDataEpoch((n) => n + 1);
    refreshAll();
    if (!nextDeadlineKnown) demoWatchRef.current?.refresh();
    setDemoNotice(i18n.t('app:demoReset'));
    window.setTimeout(() => setDemoNotice(null), 4000);
  }, [refreshAll]);
  const handleDemoResetRef = useLatestRef(handleDemoReset);

  // The next demo reset as the server names it. The deadline is set here as well, not only through the
  // effect above: an answer with the same number of seconds as before would not restart the countdown.
  // If the old deadline had passed and the server names a new one, the reset happened, whether or not
  // DEMO_RESET arrived (handleDemoReset ignores a second report).
  useEffect(() => {
    const watch = createDemoResetWatch(
      () => api.getAuthStatus(),
      (st) => {
        const before = demoDeadlineRef.current;
        const deadline = demoDeadlineFrom(st.demoMode, st.demoResetInSeconds);
        demoDeadlineRef.current = deadline;
        setAuthStatus(st);
        setDemoDeadline(deadline);
        const now = Date.now();
        if (before !== null && before <= now && deadline !== null && deadline > now) handleDemoResetRef.current(true);
      }
    );
    demoWatchRef.current = watch;
    return () => {
      watch.cancel();
      demoWatchRef.current = null;
    };
  }, [handleDemoResetRef]);

  // Countdown reached zero: ask the server (with growing pauses) until it names the next reset, also when
  // DEMO_RESET does not arrive (long polling, connection just dropped)
  const handleDemoCountdownElapsed = useCallback(() => demoWatchRef.current?.elapsed(), []);

  // Counters and deck follow realtime events, but only as far as an event can change them: the deck for
  // events about inbox thoughts (a thought sorted on another device leaves this deck too), the counters
  // at once for the echo of this tab's own change and in the shared rhythm for everyone else's. A hidden
  // tab skips them, it loads everything when it becomes visible again; so does a reconnect.
  useEffect(() => {
    const scheduler = statsScheduler;
    let deckTimer: number | undefined;
    const reloadDeck = () => {
      window.clearTimeout(deckTimer);
      deckTimer = window.setTimeout(() => {
        api.getTriageDeck().then((res) => setDeck(Array.isArray(res) ? res : [])).catch(() => {});
      }, 300);
    };
    // Events missed while the tab slept (desktop in the background, connection dropped)
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (getToken()) refreshAll();
      // Timers sleep in a hidden tab and DEMO_RESET may have been missed: ask for the next reset anew
      if (demoModeRef.current) demoWatchRef.current?.refresh();
    };
    const handleWs = (e: CustomEvent<WSMessage | undefined>) => {
      const msg = e.detail;
      if (!msg) return;
      if (msg.event === 'DEMO_RESET') {
        handleDemoResetRef.current();
        return;
      }
      if (document.visibilityState === 'hidden') return;
      if (eventChangesStats(msg.event)) {
        if (Date.now() - lastLocalWriteAt() < OWN_ECHO_WINDOW_MS) scheduler.soon();
        else scheduler.shared();
      }
      if (eventChangesDeck(msg, deckIdsRef.current)) reloadDeck();
    };
    // Back after the connection dropped: events of the gap are lost, load counters and deck once
    let connectionLost = false;
    const onStatus = (e: WindowEventMap['mindsift:ws:status']) => {
      if (!e.detail) return;
      if (!e.detail.connected) {
        connectionLost = true;
      } else if (connectionLost) {
        connectionLost = false;
        if (getToken()) {
          scheduler.soon();
          reloadDeck();
        }
        if (demoModeRef.current) demoWatchRef.current?.refresh();
      }
    };
    window.addEventListener('mindsift:ws', handleWs);
    window.addEventListener('mindsift:ws:status', onStatus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      scheduler.cancel();
      window.clearTimeout(deckTimer);
      window.removeEventListener('mindsift:ws', handleWs);
      window.removeEventListener('mindsift:ws:status', onStatus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshAll, statsScheduler, handleDemoResetRef, demoModeRef]);

  return {
    bootLoading,
    authStatus,
    setAuthStatus,
    user,
    setUser,
    setupPending,
    setSetupPending,
    mfaSetupRequired,
    setMfaSetupRequired,
    passwordChangeRequired,
    setPasswordChangeRequired,
    stats,
    setStats,
    deck,
    setDeck,
    lists,
    setLists,
    refreshAll,
    refreshStats,
    demoDeadline,
    dataEpoch,
    demoNotice,
    setDemoNotice,
    handleDemoCountdownElapsed,
  };
}
