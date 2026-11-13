import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Document, DocumentBlock } from '../../lib/types';
import { fitFieldHeight, refitOnWidthChange } from '../../lib/fieldHeight';
import { useKeyboardInset } from '../../lib/useKeyboardInset';
import i18n from '../../i18n';
import type { CursorAnchor } from './useDocumentSync';

// Height of the outline bar that sits on the keyboard (MobileOutlineBar), with a little air
export const KEYBOARD_BAR_SPACE = 64;

// The element that scrolls el (the note, or the journal with its days)
function scrollParent(el: Element | null): HTMLElement | null {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if ((overflowY === 'auto' || overflowY === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

// Where the note sits on screen: the title field (its height, its name in the header once scrolled away, the
// cursor in it when a new note opens), the note's place in focus mode, room above the on-screen keyboard and
// the bullet with the cursor kept in place when changes of others arrive
export function useEditorLayout({
  doc,
  title,
  blocks,
  loading,
  showsLoading,
  embedded,
  autoFocusTitle,
  focusMode,
  focusBarPinned,
  zoomedBlockId,
  scrollRef,
  cursorAnchorRef,
}: {
  doc: Document | null;
  title: string;
  blocks: DocumentBlock[];
  loading: boolean;
  showsLoading: boolean;
  embedded: boolean;
  autoFocusTitle?: boolean;
  focusMode: boolean;
  focusBarPinned: boolean;
  zoomedBlockId: string | null;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  cursorAnchorRef: React.MutableRefObject<CursorAnchor | null>;
}) {
  const titleInputRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  // The title grows with its text like the bullets: measured when it appears, when its text changes and when
  // its width does (lib/fieldHeight), not on every render, where each measurement forced a layout of the page
  const stopTitleRefitRef = useRef<(() => void) | null>(null);
  const setTitleField = useCallback((el: HTMLTextAreaElement | null) => {
    titleInputRef.current = el;
    stopTitleRefitRef.current?.();
    stopTitleRefitRef.current = null;
    if (!el) return;
    fitFieldHeight(el);
    stopTitleRefitRef.current = refitOnWidthChange(el);
  }, []);
  useLayoutEffect(() => {
    const el = titleInputRef.current;
    if (el instanceof HTMLTextAreaElement) fitFieldHeight(el);
  }, [title]);

  // Focus mode keeps the note at the height it has in the workspace, so the text does not move when it
  // starts; the room below lets the end of the note scroll up into the upper third
  const workspaceTopRef = useRef(0);
  const [focusTopGap, setFocusTopGap] = useState(0);
  useLayoutEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    if (!focusMode) {
      workspaceTopRef.current = root.getBoundingClientRect().top;
      return;
    }
    // The fixed pane starts at the top edge; offsetTop ignores its zoom-in animation (a transform).
    // Unpinned, the header slides in over the note: at least its height (45 px) plus 16 px stay free
    const top = root.offsetTop;
    setFocusTopGap(Math.max(focusBarPinned ? 0 : 41, workspaceTopRef.current - top));
  }, [focusMode, focusBarPinned, scrollRef]);
  // After a page load the note is still loading when that runs (no pane yet), and the bars above it may
  // appear later: measured once the pane is there and again whenever it changes (otherwise focus mode would
  // start too high)
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || focusMode || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      workspaceTopRef.current = root.getBoundingClientRect().top;
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, [focusMode, showsLoading, scrollRef]);

  // Sideways the note moves to the middle in focus mode and gets wider (and back): it glides from where it
  // was instead of jumping. Only the position glides (transform, on the compositor); the width changes at
  // once, so the lines rewrap once instead of on every frame
  const contentRef = useRef<HTMLDivElement | null>(null);
  const contentBoxRef = useRef<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const { left, width } = el.getBoundingClientRect();
    const from = contentBoxRef.current;
    contentBoxRef.current = { left, width };
    if (
      !from ||
      (Math.abs(from.left - left) < 1 && Math.abs(from.width - width) < 1) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    el.animate([{ transform: `translateX(${from.left - left}px)` }, { transform: 'none' }], {
      duration: 300,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
    });
  }, [focusMode]);

  // Keeps the bullet being typed in above the keyboard (and the outline bar on it): the browser only
  // scrolls it into the visible part if the note can scroll that far, hence also the room at the end
  const { inset: keyboardInset, keyboardOpen, visibleHeight } = useKeyboardInset();
  useEffect(() => {
    // Without visualViewport the keyboard is unknown (counts as open): nothing to measure against
    if (!keyboardOpen || embedded || !window.visualViewport) return;
    const root = scrollRef.current;
    if (!root) return;
    const reveal = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || !root.contains(el) || el.tagName !== 'TEXTAREA') return;
      const vv = window.visualViewport;
      const visibleBottom = (vv ? vv.offsetTop : 0) + visibleHeight - KEYBOARD_BAR_SPACE;
      const over = el.getBoundingClientRect().bottom + 12 - visibleBottom;
      if (over > 0) root.scrollBy({ top: over });
    };
    reveal();
    root.addEventListener('focusin', reveal);
    root.addEventListener('input', reveal);
    return () => {
      root.removeEventListener('focusin', reveal);
      root.removeEventListener('input', reveal);
    };
  }, [keyboardOpen, visibleHeight, embedded, scrollRef]);
  // The header repeats the title only once the big title has scrolled out of view
  // The note's name in the sticky header once the title has scrolled away. Switched on the element itself:
  // as state of the editor it rendered every bullet of the note again on the first scroll step
  const titleIndicatorRef = useRef<HTMLDivElement>(null);

  // The bullet with the cursor stays where it is on screen when changes of others arrive above it. New
  // text of a bullet above reaches its field only in a later render (and only then it wraps onto another
  // line), so for a moment every change of the list's size is evened out too, before it is painted
  const keepCursorInPlace = useCallback(() => {
    const anchor = cursorAnchorRef.current;
    if (!anchor) return;
    const el = document.querySelector(`[data-outline-block="${anchor.blockId}"]`);
    // Time is up, or the cursor went elsewhere: the user moves on, nothing to hold any more
    if (!el || performance.now() > anchor.until || document.activeElement?.closest('[data-outline-block]') !== el) {
      cursorAnchorRef.current = null;
      anchor.observer?.disconnect();
      return;
    }
    const shift = el.getBoundingClientRect().top - anchor.top;
    if (Math.abs(shift) >= 1) scrollParent(el)?.scrollBy({ top: shift, behavior: 'instant' });
    if (!anchor.observer && el.parentElement && typeof ResizeObserver !== 'undefined') {
      anchor.observer = new ResizeObserver(keepCursorInPlace);
      anchor.observer.observe(el.parentElement);
    }
  }, [cursorAnchorRef]);
  useLayoutEffect(keepCursorInPlace, [blocks, keepCursorInPlace]);
  useEffect(() => () => cursorAnchorRef.current?.observer?.disconnect(), [cursorAnchorRef]);

  useEffect(() => {
    const root = scrollRef.current;
    const el = titleInputRef.current;
    const show = (shown: boolean) => {
      const indicator = titleIndicatorRef.current;
      if (!indicator) return;
      indicator.dataset.shown = String(shown);
      indicator.setAttribute('aria-hidden', String(!shown));
    };
    if (embedded || !root || !el || typeof IntersectionObserver === 'undefined') {
      show(false);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => show(!entry.isIntersecting),
      // the sticky header covers the top of the scroll area
      { root, rootMargin: '-56px 0px 0px 0px' }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [zoomedBlockId, doc?.id, embedded, scrollRef]);

  useEffect(() => {
    if (!loading && (autoFocusTitle || (doc?.title === i18n.t('workspace:editor.newNote') && (!doc?.blocks || doc?.blocks.length <= 1)))) {
      const focusTitle = () => {
        if (titleInputRef.current) {
          titleInputRef.current.focus();
          titleInputRef.current.select();
        }
      };
      focusTitle();
      const t1 = setTimeout(focusTitle, 50);
      const t2 = setTimeout(focusTitle, 150);
      return () => {
        clearTimeout(t1);
        clearTimeout(t2);
      };
    }
    // Only when the note opens: a later change of its title or bullets must not pull the cursor into the title
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, autoFocusTitle, doc?.id]);

  return {
    setTitleField,
    titleIndicatorRef,
    contentRef,
    focusTopGap,
    keyboardInset,
    keyboardOpen,
  };
}
