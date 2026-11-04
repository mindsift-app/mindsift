import { useEffect, useRef, useState } from 'react';
import { isPhoneWidth } from '../../lib/breakpoints';

// Desktop Kanban columns never get lower than this: room for the header and about three cards
export const KANBAN_MIN_COL_HEIGHT = 340;
const KANBAN_MIN_PHONE_COL_HEIGHT = 280;

interface KanbanLayoutOptions {
  isKanban: boolean;
  isKanbanWide: boolean;
  // Measured again when these change: number of board columns, open list, end of loading
  columnCount: number;
  listId: string;
  loading: boolean;
}

// Column heights and scrolling of the Kanban board in TasksView (desktop rows, phone snapping)
export function useKanbanLayout({ isKanban, isKanbanWide, columnCount, listId, loading }: KanbanLayoutOptions) {
  // Desktop Kanban: every column, in every row, is as high as the room from the board's top to the bottom of
  // the scroll area, so the first row fits completely on opening and each further row fills one screen;
  // more cards scroll inside the column. At least room for about three cards (the page scrolls below that).
  // The first row grows while the bar above the board scrolls away, so a row always fills the screen (with
  // one row too: the first scroll step hides the bar); the wheel moves row by row (below).
  const kanbanBoardRef = useRef<HTMLDivElement>(null);
  const [kanbanColHeight, setKanbanColHeight] = useState<number | null>(null);
  const [kanbanMultiRow, setKanbanMultiRow] = useState(false);
  const [kanbanPerRow, setKanbanPerRow] = useState(0);
  // Phones: one column per screen (between header and bottom bar) and the page snaps column by column;
  // kanbanPhoneTop is where a snapped column starts (below the header)
  const [kanbanPhoneSnap, setKanbanPhoneSnap] = useState(false);
  const [kanbanPhoneTop, setKanbanPhoneTop] = useState(0);
  // The first column is lower by the bar above the board, so it shows completely at the page top (its
  // snap point); a swipe then goes on to the second one
  const [kanbanPhoneFirstHeight, setKanbanPhoneFirstHeight] = useState(0);
  useEffect(() => {
    if (!isKanban) {
      setKanbanColHeight(null);
      setKanbanMultiRow(false);
      setKanbanPhoneSnap(false);
      return;
    }
    const fit = () => {
      const el = kanbanBoardRef.current;
      if (!el) {
        setKanbanColHeight(null);
        setKanbanMultiRow(false);
        setKanbanPhoneSnap(false);
        return;
      }
      if (isPhoneWidth()) {
        const headerBottom = document.querySelector('header')?.getBoundingClientRect().bottom ?? 0;
        const navTop = document.querySelector('[data-mobile-nav]')?.getBoundingClientRect().top ?? window.innerHeight;
        setKanbanColHeight(Math.max(KANBAN_MIN_PHONE_COL_HEIGHT, navTop - headerBottom - 24));
        setKanbanPhoneTop(Math.round(headerBottom + 12));
        const boardTop = el.getBoundingClientRect().top + window.scrollY;
        setKanbanPhoneFirstHeight(Math.max(KANBAN_MIN_PHONE_COL_HEIGHT, Math.round(navTop - boardTop - 12)));
        setKanbanMultiRow(false);
        setKanbanPhoneSnap(true);
        return;
      }
      setKanbanPhoneSnap(false);
      const area = el.closest<HTMLElement>('[data-app-scroll]');
      const areaTop = area ? area.getBoundingClientRect().top - area.scrollTop : -window.scrollY;
      const areaHeight = area ? area.clientHeight : window.innerHeight;
      const top = el.getBoundingClientRect().top - areaTop;
      setKanbanColHeight(Math.max(KANBAN_MIN_COL_HEIGHT, areaHeight - top - 16));
      // A row fills the whole area (--kb-full); the first one grows into the room the bar above the board
      // frees while scrolling (--kb-top - --kb-scroll, see the scroll effect). With one row as well, so the
      // first scroll step hides the bar there too. Set on the board's wrapper: the spacer below needs them.
      const vars = el.parentElement ?? el;
      vars.style.setProperty('--kb-full', `${Math.max(KANBAN_MIN_COL_HEIGHT, areaHeight - 24)}px`);
      vars.style.setProperty('--kb-top', `${Math.max(0, top - 12)}px`);
      setKanbanMultiRow(true);
      requestAnimationFrame(() => {
        const colTops = Array.from(el.querySelectorAll<HTMLElement>('[data-kanban-col]')).map((c) => c.offsetTop);
        setKanbanPerRow(colTops.filter((t) => t === Math.min(...colTops)).length);
      });
    };
    fit();
    // The board's width animates when it is stretched to full width or back: measure again at the end
    const board = kanbanBoardRef.current;
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target === board) fit();
    };
    window.addEventListener('resize', fit);
    board?.addEventListener('transitionend', onTransitionEnd);
    return () => {
      window.removeEventListener('resize', fit);
      board?.removeEventListener('transitionend', onTransitionEnd);
    };
  }, [isKanban, isKanbanWide, columnCount, listId, loading]);


  // Several rows: one wheel step moves to the next row (or back up to the previous row / the page top),
  // smoothly. The browser's own snapping goes back to the nearest point, so a wheel step shorter than a row
  // never got past the first one. A column whose cards can still scroll that way scrolls first; Ctrl +
  // wheel over the board scrolls freely (and does not zoom there); scrollbar and keys scroll freely.
  useEffect(() => {
    const board = kanbanBoardRef.current;
    const area = board?.closest<HTMLElement>('[data-app-scroll]');
    if (!kanbanMultiRow || !board || !area) return;
    let pending = 0; // trackpads send many small steps: move only once they add up
    let lockedUntil = 0;
    const snapPoints = () => {
      const areaTop = area.getBoundingClientRect().top - area.scrollTop;
      const rows = new Set<number>([0]);
      board.querySelectorAll<HTMLElement>('[data-kanban-col]').forEach((c) => {
        rows.add(Math.max(0, Math.round(c.getBoundingClientRect().top - areaTop - 12)));
      });
      return Array.from(rows).sort((a, b) => a - b);
    };
    const onWheel = (e: WheelEvent) => {
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      if (e.ctrlKey) {
        if (!board.contains(e.target as Node)) return; // zooming elsewhere stays as it is
        e.preventDefault();
        area.scrollBy({ top: dy });
        return;
      }
      if (dy === 0 || e.shiftKey) return;
      const list = (e.target as HTMLElement).closest<HTMLElement>('[data-kanban-list]');
      if (list && (dy > 0 ? list.scrollTop + list.clientHeight < list.scrollHeight - 1 : list.scrollTop > 0)) return;
      e.preventDefault();
      if (Date.now() < lockedUntil) return;
      pending += dy;
      if (Math.abs(pending) < 40) return;
      const down = pending > 0;
      pending = 0;
      const cur = area.scrollTop;
      const points = snapPoints();
      const next = down ? points.find((p) => p > cur + 2) : [...points].reverse().find((p) => p < cur - 2);
      if (next === undefined) {
        // Past the last row (e.g. a very low window): plain scrolling. Only the page's bottom margin left
        // below a snapped row is no reason to move again (a second step moved the columns by ~20 px)
        if (down && area.scrollHeight - area.clientHeight - cur < 48) return;
        area.scrollBy({ top: dy });
        return;
      }
      lockedUntil = Date.now() + 450;
      area.scrollTo({ top: next, behavior: 'smooth' });
    };
    // The first row grows while the bar above the board scrolls away. Every new value lays out the whole
    // board, so at most once per frame and not at all once the bar is gone (the row is full height then).
    // Scroll anchoring stays off here: it answered the growing row by moving the scroll position, which
    // fired the next scroll event, and the page juddered (worst in installed apps)
    const vars = board.parentElement ?? board;
    let frame = 0;
    let last = -1;
    const update = () => {
      frame = 0;
      const top = parseFloat(vars.style.getPropertyValue('--kb-top')) || 0;
      const value = Math.min(Math.round(area.scrollTop), Math.round(top));
      if (value === last) return;
      last = value;
      vars.style.setProperty('--kb-scroll', `${value}px`);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const anchorBefore = area.style.overflowAnchor;
    area.style.overflowAnchor = 'none';
    area.addEventListener('wheel', onWheel, { passive: false });
    area.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      area.style.overflowAnchor = anchorBefore;
      area.removeEventListener('wheel', onWheel);
      area.removeEventListener('scroll', onScroll);
    };
  }, [kanbanMultiRow]);

  return {
    kanbanBoardRef,
    kanbanColHeight,
    kanbanMultiRow,
    kanbanPerRow,
    kanbanPhoneSnap,
    kanbanPhoneTop,
    kanbanPhoneFirstHeight,
  };
}
