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
import { OWN_ECHO_WINDOW_MS, createStatsScheduler, eventChangesDeck, eventChangesStats } from './realtimeCounters';

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
  // Demo mode: when the next reset happens (local clock), and a counter that remounts all views after it
  const [demoDeadline, setDemoDeadline] = useState<number | null>(null);
  const [dataEpoch, setDataEpoch] = useState(0);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const lastDemoResetRef = useRef(0);
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

  // A rejected account (token expired or invalid) changes nothing: api.ts dispatches mindsift:unauthorized
  const applyAccount = useCallback(([meRes, deckRes, listsRes]: AccountLoad) => {
    if (meRes.status === 'rejected') return;
    setUser(meRes.value.user);
    setSetupPending(Boolean(meRes.value.setupPending));
    setMfaSetupRequired(Boolean(meRes.value.mfaSetupRequired));
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

    window.addEventListener('mindsift:unauthorized', onUnauthorized);
    window.addEventListener('mindsift:mfa-setup-required', onMfaSetupRequired);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(retry);
      window.removeEventListener('mindsift:unauthorized', onUnauthorized);
      window.removeEventListener('mindsift:mfa-setup-required', onMfaSetupRequired);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDemoDeadline(
      authStatus.demoMode && typeof authStatus.demoResetInSeconds === 'number'
        ? Date.now() + authStatus.demoResetInSeconds * 1000
        : null
    );
  }, [authStatus.demoMode, authStatus.demoResetInSeconds]);

  // Link previews switched off for the whole server: no cards in notes, no switch in the settings
  useEffect(() => {
    setServerLinkPreviews(authStatus.linkPreviews !== false);
  }, [authStatus.linkPreviews]);

  // The demo database was reset: drop cached answers of the old data, remount the views (they load
  // fresh data), refresh counters and the countdown. Sessions stay valid (fixed demo account IDs).
  const handleDemoReset = useCallback(() => {
    if (Date.now() - lastDemoResetRef.current < 30000) return; // event and countdown may both report it
    lastDemoResetRef.current = Date.now();
    void clearOfflineData();
    setDataEpoch((n) => n + 1);
    refreshAll();
    api.getAuthStatus().then(setAuthStatus).catch(() => {});
    setDemoNotice(i18n.t('app:demoReset'));
    window.setTimeout(() => setDemoNotice(null), 4000);
  }, [refreshAll]);
  const handleDemoResetRef = useLatestRef(handleDemoReset);

  // Countdown reached zero but no DEMO_RESET arrived (e.g. long polling): ask the server shortly after
  const handleDemoCountdownElapsed = useCallback(() => {
    window.setTimeout(() => {
      api
        .getAuthStatus()
        .then((st) => {
          if ((st.demoResetInSeconds ?? 0) > 60) handleDemoResetRef.current();
          else setAuthStatus(st);
        })
        .catch(() => {});
    }, 5000);
  }, [handleDemoResetRef]);

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
      if (document.visibilityState === 'visible' && getToken()) refreshAll();
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
  }, [refreshAll, statsScheduler, handleDemoResetRef]);

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
