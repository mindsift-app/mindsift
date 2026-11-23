// The realtime events in React: the handler is the latest one passed (it may read the component's current
// state) and listens while the component is mounted (lib/realtimeBus.ts).
import { useEffect } from 'react';
import type { WSMessage } from './types';
import { onRealtimeMessage } from './realtimeBus';
import { useLatestRef } from './useLatestRef';

export function useRealtimeEvents(handler: (msg: WSMessage) => void): void {
  const handlerRef = useLatestRef(handler);
  useEffect(() => onRealtimeMessage((msg) => handlerRef.current(msg)), [handlerRef]);
}

