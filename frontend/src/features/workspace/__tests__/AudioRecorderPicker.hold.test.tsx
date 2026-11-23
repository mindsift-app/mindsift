import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../lib/voice', () => ({
  canRecord: () => true,
  VoiceRecorder: class {
    async start() {}
    cancel() {}
    level() {
      return 0;
    }
    recordedBytes() {
      return 0;
    }
  },
}));

import { AudioRecorderPicker } from '../AudioRecorderPicker';
import { leaveHeld, unloadHeld } from '../../../lib/leaveGuard';
import { reloadHeld } from '../../../lib/reloadHold';

describe('Sprachnotiz: laufende Aufnahme hält Wechsel, Neuladen und Update auf', () => {
  it('hält während der Aufnahme alle drei Sperren und gibt sie beim Schließen frei', async () => {
    const view = render(<AudioRecorderPicker docId="doc-1" onDone={() => {}} onCancel={() => {}} />);
    expect(reloadHeld()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Aufnahme starten' }));
    await waitFor(() => expect(reloadHeld()).toBe(true));
    // The automatic reload for a new version (lib/useUpdateCheck.ts) waits for it like for a dictation
    expect(leaveHeld()).toBe(true);
    expect(unloadHeld()).toBe(true);
    view.unmount();
    expect(reloadHeld()).toBe(false);
    expect(leaveHeld()).toBe(false);
    expect(unloadHeld()).toBe(false);
  });
});
