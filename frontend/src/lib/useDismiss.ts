import { useEffect } from 'react';
import type { RefObject } from 'react';
import { useLatestRef } from './useLatestRef';

type Inside = RefObject<Element | null> | Element | null | undefined;

// ---------------------------------------------------------------------------------------------------------
// One stack for everything that closes on Escape or on a press beside it (Doku/ui-patterns.md, "Popovers and
// Menus: Place and Closing"): dialogs, sheets, popovers and menus. Whatever opened last lies on top, and
// only the top layer answers: Escape closes the top layer and nothing below it, and a press beside a popover
// closes that popover and does nothing else (the element under the finger or mouse gets no press and no
// click). Layers are listed in the order they became active.

interface Layer {
  /** Whether Escape closes this layer now; a layer that says no is passed over */
  escape: () => boolean;
  close: () => void;
  /** Popovers: whether a press target lies inside; dialogs leave it out (their backdrop handles presses) */
  contains?: (target: Node) => boolean;
  /** The press that closes the popover still reaches its target */
  passThrough?: boolean;
}

const layers: Layer[] = [];

/** Puts a layer on top of the stack; the returned function takes it off again. */
export function pushLayer(layer: Layer): () => void {
  layers.push(layer);
  return () => {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  };
}

const topLayer = (): Layer | undefined => layers[layers.length - 1];

// Escape: after the handlers of the page (a field or list inside that takes Escape prevents its default and
// keeps everything open), before the other window listeners (registered later, in effects), which see the
// default prevented once a layer has closed
function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
  for (let i = layers.length - 1; i >= 0; i--) {
    if (!layers[i].escape()) continue;
    e.preventDefault();
    layers[i].close();
    return;
  }
}

// A press beside the top popover closes it at once (mouse, pen or finger; a finger that starts to scroll the
// page closes it too, the page still scrolls). Unless the layer passes presses through, every event of that
// press is stopped before the page sees it: pointer, touch and mouse events and the click (the mousedown and
// the click also lose their default: no focus, no link, no checkbox).
// A swallowed press is down (until pointer up or cancel)
let pressDown = false;
// The press has ended: its compatibility mouse events (after a tap) and the click still follow, for a moment
let swallowUntil = 0;
const SWALLOW_AFTER_UP_MS = 500;
// Last pointer down or up: a mouse event within a second of it belongs to that press
let lastPointerAt = 0;

// Closes the top popover when the press lies outside it; true when the press is to be swallowed
function pressOutside(e: Event): boolean {
  const top = topLayer();
  if (!top?.contains || top.contains(e.target as Node)) return false;
  top.close();
  return !top.passThrough;
}

const stop = (e: Event, preventDefault = false) => {
  e.stopPropagation();
  if (preventDefault && e.cancelable) e.preventDefault();
};

const afterUp = () => Date.now() < swallowUntil;

function onPointerDown(e: PointerEvent) {
  lastPointerAt = Date.now();
  swallowUntil = 0;
  pressDown = pressOutside(e);
  if (pressDown) stop(e);
}

function onPointerEnd(e: PointerEvent) {
  lastPointerAt = Date.now();
  if (!pressDown) return;
  pressDown = false;
  swallowUntil = Date.now() + SWALLOW_AFTER_UP_MS;
  stop(e);
}

function onMouseDown(e: MouseEvent) {
  if (pressDown || afterUp()) return stop(e, true);
  // A mouse event without pointer events before it (older browsers, tests): it is the press itself
  if (Date.now() - lastPointerAt > 1000 && pressOutside(e)) {
    swallowUntil = Date.now() + SWALLOW_AFTER_UP_MS;
    stop(e, true);
  }
}

// touchstart comes while the finger is down; mouseup, touchend and the click after the pointer is up
function onSwallowed(e: Event) {
  if (e.type === 'touchstart' ? pressDown : afterUp()) stop(e, e.type === 'click');
  if (e.type === 'click') swallowUntil = 0;
}

if (typeof window !== 'undefined') {
  // Registered when the module loads, so these run before any listener a component adds later
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerEnd, true);
  window.addEventListener('pointercancel', onPointerEnd, true);
  window.addEventListener('mousedown', onMouseDown, true);
  for (const type of ['mouseup', 'click', 'touchstart', 'touchend']) {
    window.addEventListener(type, onSwallowed, { capture: true, passive: type.startsWith('touch') });
  }
}

/** For tests: forgets all layers and any press in progress. */
export function resetLayersForTests() {
  layers.length = 0;
  pressDown = false;
  swallowUntil = 0;
  lastPointerAt = 0;
}

// ---------------------------------------------------------------------------------------------------------

export interface DismissOptions {
  /** Listens only while true (an open menu) */
  active?: boolean;
  /**
   * Escape closes it while it is the top layer (default). false: Escape passes it over (to the layer below);
   * 'unhandled' is the same as true: an Escape that something inside took (default prevented) never closes.
   */
  escape?: boolean | 'unhandled';
  /**
   * The press beside it still reaches its target (the expanded rail, suggestions under a field), instead of
   * only closing it.
   */
  passThrough?: boolean;
  /** No longer used: every press closes at pointer down, and the rest of that press is swallowed */
  event?: 'pointerdown' | 'mousedown';
}

/**
 * Closes a popover or menu on a press outside of `inside` (its box, and e.g. the button it opens from) and on
 * Escape, as the top layer of the stack above (Doku/ui-patterns.md). `onClose` may change from render to
 * render.
 */
export function useDismiss(inside: Inside | Inside[], onClose: () => void, { active = true, escape = true, passThrough = false }: DismissOptions = {}) {
  const insideRef = useLatestRef(inside);
  const closeRef = useLatestRef(onClose);
  const escapeRef = useLatestRef(escape !== false);
  useEffect(() => {
    if (!active) return;
    return pushLayer({
      escape: () => escapeRef.current,
      close: () => closeRef.current(),
      contains: (target) =>
        ([] as Inside[]).concat(insideRef.current).some((i) => {
          const el = i && 'current' in i ? i.current : i;
          return !!el && el.contains(target);
        }),
      passThrough,
    });
  }, [active, passThrough, insideRef, closeRef, escapeRef]);
}

/**
 * A dialog, sheet or window that closes on Escape: Escape reaches it only while it is the top layer (a menu,
 * popover or second dialog opened from it closes first), and only when nothing inside took it (default
 * prevented). `when` is asked at the key press (e.g. a phone-only sheet on a wide window passes it on).
 */
export function useCloseOnEscape(onClose: () => void, { active = true, when }: { active?: boolean; when?: () => boolean } = {}) {
  const closeRef = useLatestRef(onClose);
  const whenRef = useLatestRef(when);
  useEffect(() => {
    if (!active) return;
    return pushLayer({ escape: () => whenRef.current?.() ?? true, close: () => closeRef.current() });
  }, [active, closeRef, whenRef]);
}
