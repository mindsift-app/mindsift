import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthStatus, DashboardStats, SharedList, Thought, User } from '../lib/types';
import { api, clearToken, connectWebSocket, disconnectWebSocket, getToken } from '../lib/api';
import { clearOfflineData, outboxCount } from '../lib/offline';
import { flushClosedNotes } from '../lib/docSync/flushClosed';
import i18n from '../i18n';

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
  // Demo mode: when the next reset happens (local clock), and a counter that remounts all views after it
  const [demoDeadline, setDemoDeadline] = useState<number | null>(null);
  const [dataEpoch, setDataEpoch] = useState(0);
  const [demoNotice, setDemoNotice] = useState<string | null>(null);
  const lastDemoResetRef = useRef(0);
  const handleDemoResetRef = useRef<() => void>(() => {});
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

  const refreshAll = useCallback(async () => {
    try {
      const [meRes, deckRes, listsRes] = await Promise.all([
        api.getMe(),
        api.getTriageDeck(),
        api.getAllLists(),
      ]);
      setUser(meRes.user);
      setStats(meRes.stats);
      setDeck(Array.isArray(deckRes) ? deckRes : []);
      setLists(Array.isArray(listsRes) ? listsRes : []);
    } catch {
      // If token expired or invalid, api.ts dispatches mindsift:unauthorized
    }
  }, []);

  const checkBootAndAuth = async () => {
    setBootLoading(true);
    try {
      const st = await api.getAuthStatus();
      setAuthStatus(st);

      if (st.needsSetup) {
        clearToken();
        setUser(null);
        return;
      }

      if (getToken()) {
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

  useEffect(() => {
    checkBootAndAuth();

    const onUnauthorized = async () => {
      setUser(null);
      onSignedOut();
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

    window.addEventListener('mindsift:unauthorized', onUnauthorized);
    window.addEventListener('online', onOnline);
    return () => {
      window.clearInterval(retry);
      window.removeEventListener('mindsift:unauthorized', onUnauthorized);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  // WebSocket Connection Management
  useEffect(() => {
    if (user && getToken()) {
      connectWebSocket();
    } else {
      disconnectWebSocket();
    }
  }, [user?.id]);

  useEffect(() => {
    setDemoDeadline(
      authStatus.demoMode && typeof authStatus.demoResetInSeconds === 'number'
        ? Date.now() + authStatus.demoResetInSeconds * 1000
        : null
    );
  }, [authStatus.demoMode, authStatus.demoResetInSeconds]);

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
  handleDemoResetRef.current = handleDemoReset;

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
  }, []);

  // Refresh stats on task/doc/list real-time events (counters in the navigation). Task events also
  // reload the triage deck: a note sorted on another device must leave this deck too.
  useEffect(() => {
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
    const handleWs = (e: any) => {
      const msg = e.detail;
      if (!msg) return;
      if (msg.event === 'DEMO_RESET') {
        handleDemoResetRef.current();
        return;
      }
      if (
        typeof msg.event === 'string' &&
        ['TASK_', 'DOC_', 'SPACE_', 'ITEM_', 'LIST_'].some((prefix) => msg.event.startsWith(prefix))
      ) {
        api.getMe().then((res) => {
          setStats(res.stats);
        }).catch(() => {});
        if (msg.event.startsWith('TASK_')) reloadDeck();
      }
    };
    window.addEventListener('mindsift:ws', handleWs);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearTimeout(deckTimer);
      window.removeEventListener('mindsift:ws', handleWs);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshAll]);

  return {
    bootLoading,
    authStatus,
    setAuthStatus,
    user,
    setUser,
    stats,
    setStats,
    deck,
    setDeck,
    lists,
    setLists,
    refreshAll,
    demoDeadline,
    dataEpoch,
    demoNotice,
    setDemoNotice,
    handleDemoCountdownElapsed,
  };
}
