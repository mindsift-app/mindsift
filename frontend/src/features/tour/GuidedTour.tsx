import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Loader2, X } from 'lucide-react';
import type { ActiveTab } from '../../app/appTabs';
import { isPhoneWidth } from '../../lib/breakpoints';
import { TOUR_STEPS } from './tourSteps';
import { pickTarget, startTour, tourReducer, tourReturnTab, TourAction, TourState } from './tourEngine';
import { Box, CardPlacement, dockCard, placeCard, TOUR_MARGIN } from './tourLayout';
import { onTourStartRequest } from './tourEvents';
import { TourContent, TourTitle } from './TourContent';

// The guided tour: a card with a short text at the real controls, the rest of the page slightly dimmed and
// the controls cut out of the dimming. It switches pages as it goes and returns to where it was started.
// The page below cannot be clicked or typed into while it runs, so nothing is created or changed.
// Started only from the help page so far (TourStartCard → tourEvents); steps in tourSteps.ts.

interface GuidedTourProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
}

export function GuidedTour({ activeTab, setActiveTab }: GuidedTourProps) {
  const [state, setState] = useState<TourState | null>(null);
  const tabRef = useRef(activeTab);
  tabRef.current = activeTab;

  useEffect(() => onTourStartRequest(() => setState((s) => (s && !s.done ? s : startTour(tabRef.current)))), []);
  const dispatch = useCallback(
    (action: TourAction) => setState((s) => (s ? tourReducer(s, action, TOUR_STEPS.length) : s)),
    []
  );

  // Over: back to the page it started on, the start button focused again when that is the help page
  useEffect(() => {
    if (!state?.done) return;
    setState(null);
    setActiveTab(tourReturnTab(state));
    // The page comes back a moment later; no cleanup, as clearing the state above re-runs this effect
    const until = performance.now() + 1500;
    const focusStart = () => {
      const button = document.querySelector<HTMLElement>('[data-tour="tour-start"]');
      if (button) button.focus({ preventScroll: true });
      else if (performance.now() < until) requestAnimationFrame(focusStart);
    };
    requestAnimationFrame(focusStart);
  }, [state, setActiveTab]);

  if (!state || state.done) return null;
  return createPortal(
    <TourOverlay state={state} dispatch={dispatch} tabRef={tabRef} setActiveTab={setActiveTab} />,
    document.body
  );
}

// How long a step looks for its controls before it is skipped: longer after switching pages (the page and
// its data are still loading); and the time a newly opened page gets before the first look counts
const WAIT_SAME_PAGE_MS = 1500;
const WAIT_NEW_PAGE_MS = 3000;
const SETTLE_MS = 250;
// Room around a control inside its cut-out
const PAD = 6;
const CARD_WIDTH = 360;

interface Hole extends Box {
  radius: number;
}

interface View {
  phone: boolean;
  vw: number;
  vh: number;
  // The cut-outs; the first is the control the card points at (absent: card in the middle)
  holes: Hole[];
  primary: boolean;
  // data-tour name of that control
  target: string;
}

const query = (selector: string) => Array.from(document.querySelectorAll<HTMLElement>(selector));

// Rendered and not hidden (display:none gives no box; the folded queue on phones is visibility:hidden)
function isRendered(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function inViewport(r: DOMRect, vw: number, vh: number) {
  return r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;
}

// The control's box with some room, cut to the window, with corners that follow the control's own
function holeOf(el: HTMLElement, vw: number, vh: number): Hole {
  const r = el.getBoundingClientRect();
  const left = Math.max(2, r.left - PAD);
  const top = Math.max(2, r.top - PAD);
  const right = Math.min(vw - 2, r.right + PAD);
  const bottom = Math.min(vh - 2, r.bottom + PAD);
  const own = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
  // Without corners of its own: the theme's (square themes stay square)
  const theme = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--radius-card')) || 0;
  const height = Math.max(0, bottom - top);
  return { left, top, width: Math.max(0, right - left), height, radius: Math.min(own > 0 ? own + PAD : theme, height / 2) };
}

function TourOverlay({
  state,
  dispatch,
  tabRef,
  setActiveTab,
}: {
  state: TourState;
  dispatch: (action: TourAction) => void;
  tabRef: React.MutableRefObject<ActiveTab>;
  setActiveTab: (tab: ActiveTab) => void;
}) {
  const { t } = useTranslation('tour');
  const step = TOUR_STEPS[state.index];
  const total = TOUR_STEPS.length;
  const isLast = state.index === total - 1;
  const [view, setView] = useState<View | null>(null);
  const [searching, setSearching] = useState(false);
  const [cardSize, setCardSize] = useState<{ width: number; height: number } | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const titleId = useId();
  const maskId = `tour-mask-${titleId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // The app below takes no focus, clicks or screen reader attention while the tour runs
  useEffect(() => {
    const root = document.getElementById('root');
    const before = document.activeElement as HTMLElement | null;
    if (root) root.inert = true;
    return () => {
      if (root) root.inert = false;
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  // Each step: open its page, look for its controls, then follow them (scrolling, resizing, turning the
  // phone, content that arrives late) until the step changes
  useEffect(() => {
    const switched = Boolean(step.tab && step.tab !== tabRef.current);
    if (switched && step.tab) setActiveTab(step.tab);
    const started = performance.now();
    const wait = switched ? WAIT_NEW_PAGE_MS : WAIT_SAME_PAGE_MS;
    let found = false;
    let scrolled = false;
    let last = '';
    let raf = 0;
    setView(null);
    setSearching(false);

    const tick = () => {
      const now = performance.now();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const el = now - started >= SETTLE_MS ? pickTarget(step.targets, query, isRendered) : null;
      if (el && !scrolled) {
        scrolled = true;
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > vh) el.scrollIntoView({ block: r.height > vh * 0.6 ? 'start' : 'center', inline: 'nearest' });
      }
      const target = el && inViewport(el.getBoundingClientRect(), vw, vh) ? el : null;
      if (!found) {
        if (target || (step.centeredFallback && now - started > wait)) {
          found = true;
          setSearching(false);
          dispatch({ type: 'shown' });
        } else if (now - started > wait) {
          dispatch({ type: 'skip' });
          return;
        } else if (now - started > 400) {
          setSearching(true);
        }
      }
      if (found) {
        const holes: Hole[] = [];
        if (target) holes.push(holeOf(target, vw, vh));
        for (const selector of step.also ?? []) {
          const extra = query(selector).find((e) => isRendered(e) && inViewport(e.getBoundingClientRect(), vw, vh));
          if (extra && extra !== target) holes.push(holeOf(extra, vw, vh));
        }
        const next: View = {
          phone: isPhoneWidth(),
          vw,
          vh,
          holes,
          primary: Boolean(target),
          target: target?.dataset.tour ?? '',
        };
        const key = JSON.stringify(next);
        if (key !== last) {
          last = key;
          setView(next);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // One run per step; the page in tabRef is read when the step starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.index]);

  // The card's own size, for placing it (the card exists once a step has something to show)
  const hasView = view !== null;
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const measure = () =>
      setCardSize((prev) =>
        prev && prev.width === card.offsetWidth && prev.height === card.offsetHeight
          ? prev
          : { width: card.offsetWidth, height: card.offsetHeight }
      );
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(card);
    return () => ro.disconnect();
  }, [hasView]);

  const showing = view !== null && state.shown === state.index;

  // Keys: Esc ends, arrows step, Enter goes on, Tab stays inside the card. Caught before the app's own
  // shortcuts (triage: arrows sort cards, C, /, Ctrl+K …), which never see them while the tour runs.
  const latest = useRef({ showing, dispatch });
  latest.current = { showing, dispatch };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.type !== 'keydown') return;
      const { showing: ready, dispatch: send } = latest.current;
      const card = cardRef.current;
      const inCard = Boolean(card && e.target instanceof Node && card.contains(e.target));
      if (e.key === 'Escape') {
        e.preventDefault();
        send({ type: 'close' });
      } else if (e.key === 'ArrowRight' && ready) {
        e.preventDefault();
        send({ type: 'next' });
      } else if (e.key === 'ArrowLeft' && ready) {
        e.preventDefault();
        send({ type: 'back' });
      } else if (e.key === 'Enter' && !(inCard && e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        if (ready) send({ type: 'next' });
      } else if (e.key === 'Tab' && card) {
        const items = Array.from(card.querySelectorAll<HTMLElement>('button:not([disabled])'));
        if (items.length === 0) return;
        const i = items.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        const next = e.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : i === items.length - 1 ? 0 : i + 1;
        items[next].focus();
      } else if (!inCard) {
        // Anything else outside the card (the page below is inert anyway)
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('keyup', onKey, true);
    window.addEventListener('keypress', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('keypress', onKey, true);
    };
  }, []);

  const phone = view?.phone ?? isPhoneWidth();
  const vw = view?.vw ?? window.innerWidth;
  const vh = view?.vh ?? window.innerHeight;
  const width = phone ? vw - 2 * TOUR_MARGIN : Math.min(CARD_WIDTH, vw - 2 * TOUR_MARGIN);
  const primary = view?.primary ? view.holes[0] : null;
  let place: CardPlacement | null = null;
  if (view && cardSize) {
    place = phone
      ? dockCard(primary, view.holes, cardSize.height, vh)
      : placeCard(primary, { width, height: cardSize.height }, vw, vh);
  }
  const visible = showing && place !== null;
  // Focus on "next" when a step appears, so Enter goes on. Tried until it holds: right after the first
  // step's card appears the browser may still count it as hidden and refuse the focus.
  useEffect(() => {
    if (!visible) return;
    const until = performance.now() + 1000;
    let raf = 0;
    const focusNext = () => {
      const button = nextRef.current;
      if (button && getComputedStyle(button).visibility === 'visible') button.focus({ preventScroll: true });
      if (!cardRef.current?.contains(document.activeElement) && performance.now() < until) raf = requestAnimationFrame(focusNext);
    };
    raf = requestAnimationFrame(focusNext);
    return () => cancelAnimationFrame(raf);
  }, [visible, state.index]);

  return (
    <div
      className="fixed inset-0 z-[200]"
      style={{ touchAction: 'none' }}
      onPointerDown={(e) => {
        if (!cardRef.current?.contains(e.target as Node)) e.preventDefault();
      }}
    >
      <svg className="absolute inset-0 w-full h-full" aria-hidden>
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            {showing &&
              view.holes.map((h, i) => (
                <rect key={i} x={h.left} y={h.top} width={h.width} height={h.height} rx={h.radius} fill="black" />
              ))}
          </mask>
        </defs>
        <rect x="0" y="0" width="100%" height="100%" mask={`url(#${maskId})`} className="fill-overlay" opacity={0.75} />
      </svg>

      {showing &&
        view.holes.map((h, i) => (
          <div
            key={i}
            aria-hidden
            data-tour-ring={i === 0 && view.primary ? 'target' : 'also'}
            className={`absolute pointer-events-none border-2 ${i === 0 && view.primary ? 'border-accent' : 'border-accent/60 border-dashed'}`}
            style={{ left: h.left, top: h.top, width: h.width, height: h.height, borderRadius: h.radius }}
          />
        ))}

      {searching && !showing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none" aria-hidden>
          <Loader2 className="w-6 h-6 text-on-accent animate-spin" />
        </div>
      )}

      {view && (
        <div
          ref={cardRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-tour-card={step.id}
          className="absolute panel-elevated shadow-panel flex flex-col text-main transition-[left,top,opacity] duration-200 ease-out motion-reduce:transition-none"
          style={{
            width,
            maxHeight: vh - 2 * TOUR_MARGIN,
            left: place?.left ?? 0,
            top: place?.top ?? 0,
            opacity: visible ? 1 : 0,
            visibility: visible ? 'visible' : 'hidden',
            touchAction: 'pan-y',
          }}
        >
          {place && place.arrow !== null && <CardArrow side={place.side} offset={place.arrow} />}
          <div className="flex items-center justify-between gap-2 px-4 pt-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-[11px] font-semibold text-accent whitespace-nowrap">
                {t('progress', { current: state.index + 1, total })}
              </span>
              <span className="flex items-center gap-1" aria-hidden>
                {TOUR_STEPS.map((s, i) => (
                  <span
                    key={s.id}
                    className={`w-1.5 h-1.5 rounded-full ${i === state.index ? 'bg-accent' : i < state.index ? 'bg-accent/40' : 'bg-border'}`}
                  />
                ))}
              </span>
            </div>
            <button
              type="button"
              onClick={() => dispatch({ type: 'close' })}
              className="btn-icon h-11 w-11 sm:h-7 sm:w-7 -mr-2 sm:mr-0 shrink-0"
              title={`${t('close')} (Esc)`}
              aria-label={t('close')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="px-4 pb-1 pt-1 overflow-y-auto overscroll-contain min-h-0">
            <h2 id={titleId} className="text-sm font-bold text-main mb-2">
              <TourTitle step={step.id} />
            </h2>
            <div className="text-xs text-muted leading-relaxed space-y-2.5">
              <TourContent step={step.id} phone={phone} target={view.target} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 px-4 pb-3 pt-3">
            <span className="hidden sm:inline text-[10px] text-faint">{t('keysHint')}</span>
            <div className="flex items-center gap-2 ml-auto w-full sm:w-auto">
              <button
                type="button"
                onClick={() => dispatch({ type: 'back' })}
                disabled={state.index === 0}
                className="btn-action h-11 sm:h-8 px-3 text-xs flex-1 sm:flex-none disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                {t('back')}
              </button>
              <button
                ref={nextRef}
                type="button"
                onClick={() => dispatch({ type: 'next' })}
                className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold flex-1 sm:flex-none"
              >
                {isLast ? t('finish') : t('next')}
                {!isLast && <ArrowRight className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Little tip on the card's edge, pointing at the control (desktop, card beside the control)
function CardArrow({ side, offset }: { side: CardPlacement['side']; offset: number }) {
  const base = 'absolute w-3 h-3 rotate-45 bg-panel-elevated border-border';
  if (side === 'below') return <span aria-hidden className={`${base} -top-1.5 border-l border-t`} style={{ left: offset - 6 }} />;
  if (side === 'above') return <span aria-hidden className={`${base} -bottom-1.5 border-r border-b`} style={{ left: offset - 6 }} />;
  if (side === 'right') return <span aria-hidden className={`${base} -left-1.5 border-l border-b`} style={{ top: offset - 6 }} />;
  if (side === 'left') return <span aria-hidden className={`${base} -right-1.5 border-t border-r`} style={{ top: offset - 6 }} />;
  return null;
}
