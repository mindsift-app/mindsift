import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { EngineState } from '../../lib/docSync/engine';
import type { BlockLock } from './OutlinerBlock';
import type { DocHeaderStatus } from './DocumentEditor';

// Who else is in the note: the people present with their profile pictures, the bullets they are editing
// (locks) and the live status reported to the header
export function useDocPresence(
  engineState: EngineState | null,
  currentUserId: string | undefined,
  onHeaderStatusChange?: (status: DocHeaderStatus | null) => void
) {
  const { t } = useTranslation('workspace');
  const otherPeople = useMemo(
    () => (engineState?.presence || []).filter((p) => p.userId !== currentUserId),
    [engineState?.presence, currentUserId]
  );

  // Presence only carries names; profile pictures come from the user directory, loaded once
  // the first time someone else shows up (avatars can be data URLs, too big for every sync)
  const [avatarsById, setAvatarsById] = useState<Map<string, string>>(new Map());
  const avatarsRequestedRef = useRef(false);
  useEffect(() => {
    if (otherPeople.length === 0 || avatarsRequestedRef.current) return;
    avatarsRequestedRef.current = true;
    api.getUsersDirectory()
      .then((users) => {
        const m = new Map<string, string>();
        for (const u of users) if (u.avatarUrl) m.set(u.id, u.avatarUrl);
        setAvatarsById(m);
      })
      .catch(() => {});
  }, [otherPeople.length]);

  // Blocks other users are editing right now (blockId -> who, with color key and profile picture)
  const lockedBlocks = useMemo(() => {
    const m = new Map<string, BlockLock>();
    for (const l of engineState?.lockedByOthers || []) {
      m.set(l.blockId, {
        userId: l.userId,
        name: l.name || t('lock.someone'),
        avatarUrl: avatarsById.get(l.userId),
        // A live drawing holds the bullet: everyone drawing in it
        ...(l.live?.length ? { live: l.live.map((p) => ({ userId: p.userId, name: p.name || t('lock.someone'), avatarUrl: avatarsById.get(p.userId) })) } : {}),
      });
    }
    return m;
  }, [engineState?.lockedByOthers, avatarsById, t]);

  const showLive = Boolean(engineState && (engineState.shared || engineState.sessions > 1));
  const liveChannel = engineState?.channel || 'ws';
  useEffect(() => {
    onHeaderStatusChange?.({ showLive, channel: liveChannel, otherPeople, avatarsById });
  }, [showLive, liveChannel, otherPeople, avatarsById, onHeaderStatusChange]);

  useEffect(() => {
    return () => {
      onHeaderStatusChange?.(null);
    };
  }, [onHeaderStatusChange]);

  return { lockedBlocks };
}
