import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Components read their texts through i18next (German, like the app's default)
import '../i18n';

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
  Object.assign(window, { PointerEvent: PolyfillPointerEvent });
}

afterEach(() => {
  cleanup();
});
