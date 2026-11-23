import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
// Components read their texts through i18next: German, added right away (the app loads it as a chunk)
import { addTexts } from '../i18n';
import de from '../locales/de';
import { actAsServer } from './desktop';
import { resetLayersForTests } from '../lib/useDismiss';

addTexts('de', de);

// jsdom has no layout engine, so scrolling is a no-op here
Element.prototype.scrollIntoView = () => {};
// nor media playback (it would only log "not implemented")
HTMLMediaElement.prototype.pause = () => {};
HTMLMediaElement.prototype.load = () => {};
HTMLMediaElement.prototype.play = () => Promise.resolve();
// jsdom's Blob cannot be read with arrayBuffer() (recordings are, see lib/webmDuration.ts)
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(this);
    });
  };
}

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
  // No popover, dialog or swallowed press is left over for the next test (lib/useDismiss.ts)
  resetLayersForTests();
  // Every test starts on a server with everything on (lib/capabilities.ts)
  actAsServer();
});
