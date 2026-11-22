import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { DOWNLOAD_NOTICE_EVENT, DownloadNotice } from '../DownloadNotice';

const send = (detail: unknown) =>
  act(() => {
    window.dispatchEvent(new CustomEvent(DOWNLOAD_NOTICE_EVENT, { detail }));
  });

// The desktop app's shell reports a saved or failed download of the page (desktop/download_linux.go)
describe('DownloadNotice', () => {
  it('shows a saved download and a failed one', () => {
    render(<DownloadNotice />);
    expect(screen.queryByText(/gespeichert/)).toBeNull();
    send({ saved: true, name: 'mindsift-backup-2026-11-22.zip' });
    expect(screen.getByRole('status').textContent).toContain('„mindsift-backup-2026-11-22.zip“ gespeichert');
    send({ saved: false, name: 'notiz.md' });
    expect(screen.getByRole('alert').textContent).toContain('„notiz.md“ konnte nicht gespeichert werden');
  });

  it('ignores events without a name', () => {
    render(<DownloadNotice />);
    send(null);
    send({ saved: true });
    expect(screen.queryByText(/gespeichert/)).toBeNull();
  });
});
