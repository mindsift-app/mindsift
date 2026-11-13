import React, { useEffect, useRef, useState } from 'react';
import { DocumentBlock } from '../../lib/types';
import { reportNav, onNavStep, restoringNavPlace } from '../../lib/navHistory';
import { NotePlace, readNotePlace, writeNotePlace } from '../../lib/notePlace';

// The first bullet reaching below the top edge of the note's scroll area and how far below that edge it
// starts (lib/notePlace.ts). The bullets are in order from top to bottom, so a binary search finds it.
function topBullet(root: HTMLElement): NotePlace['anchor'] {
  if (!root.isConnected) return undefined;
  const rows = root.querySelectorAll<HTMLElement>('[data-outline-block]');
  const top = root.getBoundingClientRect().top;
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid].getBoundingClientRect().bottom > top) hi = mid;
    else lo = mid + 1;
  }
  const row = rows[lo];
  return row?.dataset.outlineBlock ? { id: row.dataset.outlineBlock, offset: row.getBoundingClientRect().top - top } : undefined;
}

// Where the user is in a note: the zoomed bullet, zoom and scroll position remembered per note and restored
// when it opens again (lib/notePlace.ts), zooming as steps of the browser history (lib/navHistory.ts)
export function useNotePlace({
  docId,
  embedded,
  inJournal,
  inTagPage,
  initialFocusedBlockId,
  blocks,
  loading,
  scrollRef,
}: {
  docId: string;
  embedded: boolean;
  inJournal: boolean;
  inTagPage: boolean;
  initialFocusedBlockId?: string | null;
  blocks: DocumentBlock[];
  loading: boolean;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  // Where the user last was in this note (zoom, scroll), unless a link points to a bullet in it
  const [savedPlace] = useState(() =>
    !embedded && !initialFocusedBlockId ? readNotePlace(docId) : null
  );
  // Zoomed bullet; coming here by the browser's back/forward it is the zoom of that step, else the one
  // the note had when the user last left it
  const [zoomedBlockId, setZoomedBlockId] = useState<string | null>(() => {
    const place = restoringNavPlace();
    if (inJournal || inTagPage) return null;
    if (place?.docId === docId) return place.zoom ?? null;
    return savedPlace?.zoom ?? null;
  });

  useEffect(() => {
    if (!loading && zoomedBlockId && !blocks.some((b) => b.id === zoomedBlockId)) {
      // The zoom ends when its bullet is gone
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setZoomedBlockId(null);
    }
  }, [blocks, zoomedBlockId, loading]);

  // Remember zoom and scroll position (lib/notePlace.ts); the scroll position belongs to the zoom it was
  // taken in, so it is restored only when the note opens in that zoom again
  const zoomForPlaceRef = useRef(zoomedBlockId);
  useEffect(() => {
    if (embedded) return;
    if (zoomForPlaceRef.current !== zoomedBlockId) {
      zoomForPlaceRef.current = zoomedBlockId;
      writeNotePlace(docId, { zoom: zoomedBlockId, scroll: 0 });
    }
  }, [zoomedBlockId, docId, embedded]);
  useEffect(() => {
    const root = scrollRef.current;
    if (embedded || !root) return;
    let timer: number | null = null;
    const save = () => {
      timer = null;
      writeNotePlace(docId, { zoom: zoomForPlaceRef.current, scroll: root.scrollTop, anchor: topBullet(root) });
    };
    const onScroll = () => {
      if (timer === null) timer = window.setTimeout(save, 200);
    };
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (timer !== null) {
        window.clearTimeout(timer);
        save();
      }
    };
    // the note's scroll area exists only once it has loaded
  }, [docId, embedded, loading, scrollRef]);
  const scrollRestoredRef = useRef(false);
  useEffect(() => {
    if (loading || scrollRestoredRef.current) return;
    scrollRestoredRef.current = true;
    const root = scrollRef.current;
    const target = savedPlace && savedPlace.zoom === zoomedBlockId ? savedPlace.scroll : 0;
    if (!root || target <= 0) return;
    const anchor = savedPlace?.anchor;
    // Images and code blocks may still grow the note for a few frames, and bullets near the view are shown
    // (with their real height) only in the frames after the jump: held until the place stays put for 3 frames
    let frames = 0;
    let steady = 0;
    let raf = 0;
    const apply = () => {
      // Back to the bullet that was at the top; the offset only when it is gone
      const row = anchor && root.querySelector(`[data-outline-block="${CSS.escape(anchor.id)}"]`);
      const off = () => (row ? row.getBoundingClientRect().top - root.getBoundingClientRect().top - anchor.offset : target - root.scrollTop);
      steady = Math.abs(off()) > 1 ? 0 : steady + 1;
      if (row) root.scrollTop += off();
      else root.scrollTop = target;
      if (steady < 3 && ++frames < 30) raf = requestAnimationFrame(apply);
    };
    raf = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(raf);
    // only once, when the note's content is first there
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // Zooming in and out are steps of the browser history: back zooms out again (lib/navHistory.ts)
  useEffect(() => {
    if (!embedded) reportNav({ zoom: zoomedBlockId });
  }, [zoomedBlockId, embedded]);
  useEffect(
    () =>
      onNavStep((place) => {
        if (!embedded && place.docId === docId) setZoomedBlockId(place.zoom ?? null);
      }),
    [embedded, docId]
  );

  return { zoomedBlockId, setZoomedBlockId };
}
