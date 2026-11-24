import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { Toast, toastLift, toastObstacleRef, toastStack, TOAST_LIFT_GAP } from '../Toast';

// A phone 390 px wide and 844 px high: the stack's bottom edge above the navigation, at 756
const STACK = { left: 120, right: 270, top: 712, bottom: 756 };

function box(left: number, top: number, right: number, bottom: number) {
  return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toastLift (notices move up over cards at the same spot)', () => {
  it('stays where it is without anything in the way', () => {
    expect(toastLift(STACK, [])).toBe(0);
  });

  it('moves up over a card at the same spot, with a gap', () => {
    // The tour card on a phone: full width, 160 px high, its bottom edge where the stack starts
    expect(toastLift(STACK, [{ left: 12, right: 378, top: 596, bottom: 756 }])).toBe(160 + TOAST_LIFT_GAP);
  });

  it('takes the highest of several at once', () => {
    const card = { left: 12, right: 378, top: 596, bottom: 756 };
    const hint = { left: 100, right: 290, top: 520, bottom: 756 };
    expect(toastLift(STACK, [card, hint])).toBe(236 + TOAST_LIFT_GAP);
    expect(toastLift(STACK, [hint, card])).toBe(236 + TOAST_LIFT_GAP);
  });

  it('ignores a card beside the stack, as at the right edge of a wide desktop', () => {
    const desktopStack = { left: 490, right: 790, top: 740, bottom: 776 };
    expect(toastLift(desktopStack, [{ left: 944, right: 1264, top: 640, bottom: 784 }])).toBe(0);
    // A narrow desktop window: the card reaches under the notice
    expect(toastLift(desktopStack, [{ left: 700, right: 1020, top: 640, bottom: 784 }])).toBe(136 + TOAST_LIFT_GAP);
  });

  it('ignores what lies completely above or below the stack', () => {
    expect(toastLift(STACK, [{ left: 0, right: 390, top: 100, bottom: 200 }])).toBe(0);
    expect(toastLift(STACK, [{ left: 0, right: 390, top: 780, bottom: 844 }])).toBe(0);
  });
});

describe('toastObstacleRef', () => {
  function Card() {
    return <div ref={toastObstacleRef} data-testid="card" />;
  }

  it('lifts the stack while the card is there and lowers it again when it goes', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.dataset.testid === 'card') return box(12, 596, 378, 756);
      if (this === toastStack()) {
        const lift = parseFloat(this.style.getPropertyValue('--toast-lift')) || 0;
        return box(120, 712 - lift, 270, 756 - lift);
      }
      return box(0, 0, 0, 0);
    });
    const { rerender } = render(
      <>
        <Toast text="Aufgabe gelöscht" />
        <Card />
      </>
    );
    expect(toastStack().style.getPropertyValue('--toast-lift')).toBe(`${160 + TOAST_LIFT_GAP}px`);
    // Measuring again with the stack already lifted keeps the same lift
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(toastStack().style.getPropertyValue('--toast-lift')).toBe(`${160 + TOAST_LIFT_GAP}px`);
    rerender(<Toast text="Aufgabe gelöscht" />);
    expect(toastStack().style.getPropertyValue('--toast-lift')).toBe('');
  });

  it('places the stack with the lift on phones and on the desktop', () => {
    expect(toastStack().className).toContain('bottom-[calc(5.5rem+env(safe-area-inset-bottom)+var(--toast-lift,0px))]');
    expect(toastStack().className).toContain('sm:bottom-[calc(1.5rem+var(--toast-lift,0px))]');
  });
});
