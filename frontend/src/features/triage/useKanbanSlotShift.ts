import React, { useLayoutEffect, useRef } from 'react';

const GLIDE = '200ms ease-out';
const CARD_GAP = 8; // mt-2 between the cards

// Opens the drop slot of a mouse drag on the Kanban board without changing the layout of a column: every
// column list keeps one slot element (data-kanban-slot, absolutely positioned, useTaskDrag renderDropSlot)
// that moves to the insert position, and the cards from there on glide down by the slot's height with a
// transform. A slot inserted between the cards made the browser restyle every card of the column (the
// sibling rules of Tailwind's space-y and divide classes), one growing in height laid the column out again
// in every frame; a transform only composites. Touch dragging sets neither slot nor hidden card.
export function useKanbanSlotShift(
  boardRef: React.RefObject<HTMLElement | null>,
  slot: { col: string; index: number } | null,
  // The dragged card, taken out of its column while the mouse drags it
  hiddenId: string | null,
  slotHeight: React.RefObject<number>
) {
  // Cards with a transform of the drag, and the card hidden at the last commit (where it lands, nothing glides)
  const shifted = useRef(new Set<HTMLElement>());
  const lastHidden = useRef<string | null>(null);
  const cleanup = useRef(0);

  useLayoutEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    const active = !!slot || !!hiddenId;
    if (!active && shifted.current.size === 0 && !lastHidden.current) return;
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const shift = slotHeight.current + CARD_GAP;
    // The column the dragged card is back in (dropped or the drag given up): its layout already has the card
    // where the slot was, so its cards and slot drop the shift at once instead of gliding
    const backIn = !hiddenId && lastHidden.current
      ? board.querySelector<HTMLElement>(`[data-kanban-task="${CSS.escape(lastHidden.current)}"]`)?.closest('[data-kanban-list]')
      : null;
    lastHidden.current = hiddenId;
    window.clearTimeout(cleanup.current);

    // While dragging every card keeps a transform, translateY(0) when not moved: switching between none and
    // a transform would make the browser lay the card out again (it becomes a containing block)
    const move = (el: HTMLElement, by: number, glide: boolean) => {
      const moved = !!el.style.transform && el.style.transform !== 'translateY(0px)';
      const transform = active || (glide && moved) ? `translateY(${by}px)` : '';
      if (el.style.transform === transform) return;
      el.style.transition = glide && !reduce ? `transform ${GLIDE}` : 'none';
      el.style.transform = transform;
      if (transform) shifted.current.add(el);
      else shifted.current.delete(el);
    };

    // All positions are read before anything is written: a write in between would make the next read lay
    // the board out again
    const columns = Array.from(board.querySelectorAll<HTMLElement>('[data-kanban-list]')).map((list) => {
      const colId = list.closest<HTMLElement>('[data-kanban-col]')?.dataset.kanbanCol;
      const here = slot && slot.col === colId ? slot.index : -1;
      const glide = list !== backIn;
      const cards = Array.from(list.querySelectorAll<HTMLElement>(':scope > [data-kanban-task]'))
        .filter((el) => el.offsetParent) // without the hidden one (display: none)
        .map((el) => ({ el, top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight }));
      // Only cards in the visible part of the list glide: each gliding card is a layer of its own, and
      // with dozens of them putting the frames together cost more than the gliding saved
      const viewTop = list.scrollTop - shift;
      const viewBottom = list.scrollTop + list.clientHeight;
      const last = cards[cards.length - 1];
      // The slot lies where the card at its index lies in the layout (shown shift lower), else below the last
      const slotTop =
        here < 0
          ? 0
          : here < cards.length
          ? cards[here].top
          : last
          ? last.bottom + CARD_GAP
          : parseFloat(getComputedStyle(list).paddingTop) || 0;
      return {
        here,
        glide,
        slotTop,
        slotEl: list.querySelector<HTMLElement>(':scope > [data-kanban-slot]'),
        cards: cards.map((c) => ({ el: c.el, glide: glide && c.bottom > viewTop && c.top < viewBottom })),
      };
    });

    columns.forEach(({ here, glide, slotTop, slotEl, cards }) => {
      cards.forEach((c, i) => move(c.el, here >= 0 && i >= here ? shift : 0, c.glide));
      if (!slotEl) return;
      const shown = slotEl.style.opacity === '1';
      if (here < 0) {
        if (!shown) return;
        slotEl.style.transition = glide && !reduce ? `opacity ${GLIDE}` : 'none';
        slotEl.style.opacity = '0';
        return;
      }
      // Moving within the column it glides along with the cards; showing up in a column it fades in in place
      slotEl.style.transition = reduce ? 'none' : shown ? `transform ${GLIDE}, opacity ${GLIDE}` : `opacity ${GLIDE}`;
      slotEl.style.height = `${slotHeight.current}px`;
      slotEl.style.transform = `translateY(${slotTop}px)`;
      slotEl.style.opacity = '1';
    });

    // After the drag the inline transitions go again (the cards' own hover transition comes back), and an
    // invisible slot moves back to the top, so it does not lengthen a column's scroll area
    if (!active) {
      cleanup.current = window.setTimeout(() => {
        board.querySelectorAll<HTMLElement>('[data-kanban-task]').forEach((el) => {
          el.style.transition = '';
          el.style.transform = '';
        });
        shifted.current.clear();
        board.querySelectorAll<HTMLElement>('[data-kanban-slot]').forEach((el) => {
          el.style.transition = 'none';
          el.style.transform = '';
        });
      }, 300);
    }
  }, [boardRef, slot, hiddenId, slotHeight]);
}
