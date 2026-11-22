import { describe, it, expect, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { setCapabilities } from '../../lib/capabilities';
import { DESKTOP_CAPABILITIES } from '../../test/desktop';
import { LivePill } from '../LivePill';

describe('LivePill', () => {
  afterEach(() => setCapabilities(undefined));

  it('shows the connection on a server', () => {
    setCapabilities(undefined);
    expect(render(<LivePill />).container.firstChild).not.toBeNull();
  });

  it('is hidden in the desktop app’s local instance, where nobody else reaches it', () => {
    setCapabilities(DESKTOP_CAPABILITIES);
    expect(render(<LivePill />).container.firstChild).toBeNull();
  });
});
