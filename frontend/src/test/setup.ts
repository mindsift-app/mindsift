import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom has no layout engine, so scrolling is a no-op here
Element.prototype.scrollIntoView = () => {};

if (typeof window !== 'undefined' && !window.PointerEvent) {
  class PolyfillPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 1;
      this.pointerType = params.pointerType ?? 'touch';
    }
  }
  (window as any).PointerEvent = PolyfillPointerEvent;
}

afterEach(() => {
  cleanup();
});
