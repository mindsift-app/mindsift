// The browser's side of a live drawing session (server: internal/drawlive, internal/api/drawlive.go).
// Drawing along sends and receives DRAW_* messages over the WebSocket; watching works on every channel
// (SSE and long polling register over REST). Merging is in lib/drawing/live.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, getSSEId, isWebSocketConnected, onRealtimeStatus, onWebSocketMessage, sendWebSocketMessage } from '../../../lib/api';
import { Applied, LiveMerge, WireElement, finalDrawing } from '../../../lib/drawing/live';
import { Drawing } from '../../../lib/drawing/model';
import type { LiveDrawingState } from '../../../lib/api/workspace';
import { noteClientId } from '../../../lib/docSync/noteClients';

export type LiveMode = 'draw' | 'watch';

export interface LivePerson {
  id: string; // connection
  userId: string;
  name: string;
}

export interface LiveCursor extends LivePerson {
  /** Where the pointer is (drawing coordinates); missing while it is outside or the finger is up */
  at?: [number, number];
  sel: string[];
  touch: boolean;
}

export type LiveStatus = 'connecting' | 'live' | 'offline' | 'idle';
export type LiveEndReason = 'done' | 'discard' | 'expired';
// busy and too_many: the server takes no further live drawing (from this person, or at all) right now
export type LiveError = 'forbidden' | 'locked' | 'limit' | 'busy' | 'too_many' | 'save' | null;

export interface LiveOptions {
  docId: string;
  blockId: string;
  mode: LiveMode;
  /** Block content when the editor opened (a session everyone left resumes only on the same base) */
  baseContent: string;
  initial: Drawing;
  getDoc: () => Drawing;
  /** Elements in a gesture of this browser (changes of others to them wait until it ends) */
  held: () => Set<string>;
  selected: () => string[];
  /** Puts changes of others into the editor */
  apply: (doc: Drawing, applied: Applied[]) => void;
  /** The host's "Fertig" went through: the final state to save */
  onSaved: (final: Drawing) => void;
  /** The host's "Verwerfen" went through */
  onDiscarded: () => void;
}

// A DRAW_* message's payload or a REST answer about the session; every field is checked where it is read
type DrawWire = Partial<LiveDrawingState> & {
  success?: boolean;
  from?: string;
  userId?: string;
  name?: string;
  gone?: boolean;
  x?: number;
  y?: number;
  sel?: string[];
  touch?: boolean;
  reason?: string;
  by?: string;
  code?: string;
};

const FLUSH_MS = 50; // changes go out at most this often
const POINTER_MS = 50; // pointers at most 20 times a second
const SAVE_TIMEOUT_MS = 6000;

export function useLiveDrawing(opts: LiveOptions | null) {
  const optsRef = useRef(opts);
  optsRef.current = opts;
  // Made once from the drawing as opened; later changes of opts do not start over
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const merge = useMemo(() => (opts ? new LiveMerge(opts.initial) : null), []);
  const [mode, setModeState] = useState<LiveMode | null>(opts?.mode ?? null);
  const modeRef = useRef(mode);
  const setMode = (m: LiveMode) => {
    modeRef.current = m;
    setModeState(m);
  };
  const [status, setStatusState] = useState<LiveStatus>('connecting');
  const statusRef = useRef<LiveStatus>('connecting');
  const setStatus = (s: LiveStatus) => {
    statusRef.current = s;
    setStatusState(s);
  };
  const [participants, setParticipants] = useState<LivePerson[]>([]);
  const [watchers, setWatchers] = useState<LivePerson[]>([]);
  const [host, setHost] = useState('');
  const [you, setYouState] = useState('');
  const youRef = useRef('');
  const [cursors, setCursors] = useState<Map<string, LiveCursor>>(new Map());
  const [ended, setEndedState] = useState<{ reason: LiveEndReason; by?: string } | null>(null);
  const endedRef = useRef(false);
  const [error, setError] = useState<LiveError>(null);
  const [saving, setSaving] = useState(false);
  const lastSeq = useRef(0);
  const flushTimer = useRef<number | null>(null);
  const pointerTimer = useRef<number | null>(null);
  const pointerLatest = useRef<{ at?: [number, number]; touch: boolean } | null>(null);
  const left = useRef(false);
  const lastResync = useRef(0);
  const saveTimer = useRef<number | null>(null);
  const retryTimer = useRef<number | null>(null);

  const setEnded = (e: { reason: LiveEndReason; by?: string }) => {
    endedRef.current = true;
    setEndedState(e);
    setCursors(new Map());
  };

  const where = () => ({ docId: optsRef.current!.docId, blockId: optsRef.current!.blockId });
  const send = (event: string, payload: Record<string, unknown> = {}) => {
    sendWebSocketMessage({ event, payload: { ...where(), ...payload } });
  };

  const join = () => {
    const o = optsRef.current;
    if (!o || !merge || endedRef.current) return;
    if (!isWebSocketConnected()) {
      setStatus('offline');
      return;
    }
    const doc = o.getDoc();
    send('DRAW_JOIN', { base: o.baseContent, els: merge.all(doc), grid: !!doc.grid });
  };

  const watch = () => {
    const o = optsRef.current;
    if (!o || endedRef.current) return;
    if (isWebSocketConnected()) {
      send('DRAW_WATCH');
      return;
    }
    const sseId = getSSEId();
    if (!sseId) return;
    api
      .watchDrawing(o.docId, o.blockId, sseId)
      .then((st) => takeState(st))
      .catch(() => setStatus('offline'));
  };

  // Behind (a message was dropped on the way): the whole state again
  const resync = () => {
    const o = optsRef.current;
    if (!o || Date.now() - lastResync.current < 1000) return;
    lastResync.current = Date.now();
    if (isWebSocketConnected()) send('DRAW_SYNC');
    else
      api
        .liveDrawing(o.docId, o.blockId)
        .then((st) => takeState(st))
        .catch(() => {});
  };

  const takePeople = (p: DrawWire) => {
    const parts: LivePerson[] = Array.isArray(p.participants) ? p.participants : [];
    setParticipants(parts);
    setWatchers(Array.isArray(p.watchers) ? p.watchers : []);
    setHost(typeof p.host === 'string' ? p.host : '');
    const drawing = new Set(parts.map((x) => x.id));
    setCursors((prev) => {
      let changed = false;
      const next = new Map(prev);
      next.forEach((_, id) => {
        if (!drawing.has(id)) {
          next.delete(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  };

  const takeState = (st: DrawWire) => {
    const o = optsRef.current;
    if (!o || !merge || !st) return;
    if (typeof st.you === 'string' && st.you) {
      youRef.current = st.you;
      setYouState(st.you);
    }
    takePeople(st);
    if (!st.active) {
      setStatus('idle');
      return;
    }
    // In after all (another drawing was closed meanwhile)
    setError((e) => (e === 'busy' || e === 'too_many' ? null : e));
    const r = merge.reconcile(o.getDoc(), { els: st.els || [], order: st.order, grid: st.grid }, o.held());
    o.apply(r.doc, r.applied);
    lastSeq.current = Number(st.seq) || 0;
    setStatus('live');
    if (modeRef.current === 'draw') schedule();
  };

  const flush = () => {
    flushTimer.current = null;
    const o = optsRef.current;
    if (!o || !merge || modeRef.current !== 'draw' || endedRef.current) return;
    // Not connected: nothing is lost, joining again sends the whole state
    if (statusRef.current !== 'live' || !isWebSocketConnected()) return;
    const out = merge.collect(o.getDoc());
    if (out.els.length || out.order || out.grid !== undefined) send('DRAW_OPS', { els: out.els, order: out.order, grid: out.grid });
  };

  const schedule = () => {
    if (flushTimer.current === null) flushTimer.current = window.setTimeout(flush, FLUSH_MS);
  };

  const sendPointer = () => {
    pointerTimer.current = null;
    const p = pointerLatest.current;
    const o = optsRef.current;
    if (!p || !o || modeRef.current !== 'draw' || statusRef.current !== 'live' || endedRef.current) return;
    pointerLatest.current = null;
    send('DRAW_PRESENCE', { x: p.at?.[0] ?? 0, y: p.at?.[1] ?? 0, gone: !p.at, touch: p.touch, sel: o.selected() });
    pointerTimer.current = window.setTimeout(sendPointer, POINTER_MS);
  };

  useEffect(() => {
    if (!opts || !merge) return;
    const offMsg = onWebSocketMessage((msg) => {
      const p = msg?.payload as DrawWire | undefined;
      const o = optsRef.current;
      if (!o || !p || p.docId !== o.docId || p.blockId !== o.blockId || !msg.event?.startsWith('DRAW_')) return;
      switch (msg.event) {
        case 'DRAW_STATE':
          takeState(p);
          break;
        case 'DRAW_OPS': {
          if (statusRef.current !== 'live' || endedRef.current || p.from === youRef.current) break;
          const seq = Number(p.seq) || 0;
          if (seq > lastSeq.current + 1) resync();
          lastSeq.current = Math.max(lastSeq.current, seq);
          const r = merge.receive(o.getDoc(), (p.els || []) as WireElement[], o.held());
          let doc = r.doc;
          if (Array.isArray(p.order)) doc = merge.receiveOrder(doc, p.order);
          if (typeof p.grid === 'boolean') doc = merge.receiveGrid(doc, p.grid);
          if (doc !== o.getDoc()) o.apply(doc, r.applied);
          break;
        }
        case 'DRAW_ACK': {
          const seq = Number(p.seq) || 0;
          if (seq > lastSeq.current + 1) resync();
          lastSeq.current = Math.max(lastSeq.current, seq);
          break;
        }
        case 'DRAW_PEOPLE': {
          const wasIdle = statusRef.current === 'idle';
          takePeople(p);
          if (modeRef.current !== 'watch') break;
          // Someone draws again after everyone had left: watch that (with its state)
          if (p.active && wasIdle) watch();
          else if (!p.active) setStatus('idle');
          break;
        }
        case 'DRAW_PRESENCE': {
          const from = p.from;
          if (!from || from === youRef.current) break;
          setCursors((prev) => {
            const next = new Map(prev);
            next.set(from, {
              id: from,
              userId: p.userId ?? '',
              name: p.name ?? '',
              at: p.gone ? undefined : [Number(p.x) || 0, Number(p.y) || 0],
              sel: Array.isArray(p.sel) ? p.sel : [],
              touch: !!p.touch,
            });
            return next;
          });
          break;
        }
        case 'DRAW_END': {
          if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
          setSaving(false);
          const mine = p.you && p.you === youRef.current;
          if (mine && p.reason === 'done') {
            endedRef.current = true;
            const doc = o.getDoc();
            o.onSaved(finalDrawing({ ...doc, ...(p.grid ? { grid: true } : { grid: undefined }) }, p.els || [], p.order));
          } else if (mine && p.reason === 'discard') {
            endedRef.current = true;
            o.onDiscarded();
          } else {
            setEnded({ reason: p.reason === 'done' || p.reason === 'discard' ? p.reason : 'expired', by: p.by });
          }
          break;
        }
        case 'DRAW_ERROR':
          switch (p.code) {
            case 'forbidden':
            case 'locked':
            case 'limit':
            case 'busy':
            case 'too_many':
              setError(p.code);
              break;
            case 'no_session':
              // The session is gone (server restarted, or someone saved meanwhile): join again
              if (modeRef.current === 'draw' && Date.now() - lastResync.current > 2000) {
                lastResync.current = Date.now();
                join();
              }
              break;
            case 'rate':
              // Not in yet: joining or watching came too fast (several at once), try again shortly
              if (statusRef.current === 'live') resync();
              else if (retryTimer.current === null)
                retryTimer.current = window.setTimeout(() => {
                  retryTimer.current = null;
                  if (left.current || endedRef.current) return;
                  if (modeRef.current === 'draw') join();
                  else watch();
                }, 2000);
              break;
          }
          break;
      }
    });
    // Connected (also again after a lost connection or a server restart): join with the whole state
    const offStatus = onRealtimeStatus((connected) => {
      if (endedRef.current || left.current) return;
      if (!connected) {
        setStatus('offline');
        return;
      }
      if (modeRef.current === 'draw') join();
      else watch();
    });
    return () => {
      offMsg();
      offStatus();
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
      if (pointerTimer.current !== null) window.clearTimeout(pointerTimer.current);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      if (!left.current && !endedRef.current) leaveNow();
    };
    // One session per editor: everything it needs is read through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leaveNow = () => {
    left.current = true;
    const o = optsRef.current;
    if (!o) return;
    if (isWebSocketConnected()) send('DRAW_LEAVE');
    else if (modeRef.current === 'watch' && getSSEId()) api.watchDrawing(o.docId, o.blockId, getSSEId()!, true).catch(() => {});
  };

  if (!opts) return null;

  const isHost = !!you && host === you;
  return {
    mode: mode!,
    status,
    participants,
    watchers,
    host,
    you,
    isHost,
    cursors,
    ended,
    error,
    saving,
    /** The drawing changed here */
    changed: schedule,
    /** A gesture ended: its result goes out, waiting changes of others come in */
    release: () => {
      const o = optsRef.current;
      if (!o || !merge || modeRef.current !== 'draw') return;
      const { out, incoming } = merge.release(o.getDoc());
      if (statusRef.current === 'live' && isWebSocketConnected() && (out.els.length || out.order || out.grid !== undefined)) {
        send('DRAW_OPS', { els: out.els, order: out.order, grid: out.grid });
      }
      if (incoming.applied.length) o.apply(incoming.doc, incoming.applied);
    },
    /** The pointer moved (drawing coordinates), left (null) or the finger lifted */
    pointer: (at: [number, number] | null, touch: boolean) => {
      pointerLatest.current = { at: at || undefined, touch };
      if (pointerTimer.current === null) sendPointer();
    },
    /** "Fertig" of the host: everything out, then the session ends and the final state comes back */
    done: () => {
      flush();
      if (flushTimer.current !== null) window.clearTimeout(flushTimer.current);
      flushTimer.current = null;
      setSaving(true);
      setError(null);
      send('DRAW_DONE', { clientId: noteClientId(optsRef.current!.docId) || '' });
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        setSaving(false);
        setError('save');
      }, SAVE_TIMEOUT_MS);
    },
    discard: () => send('DRAW_DISCARD'),
    leave: leaveNow,
    /** From watching to drawing along */
    drawAlong: () => {
      setMode('draw');
      setError(null);
      join();
    },
  };
}

export type LiveDrawing = NonNullable<ReturnType<typeof useLiveDrawing>>;
