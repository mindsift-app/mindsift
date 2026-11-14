import { afterEach, describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AppearanceSection } from '../user/AppearanceSection';
import { useAppearanceSettings } from '../user/useAppearanceSettings';
import { AVAILABLE_THEMES } from '../../../lib/theme';
import { setServerLinkPreviews } from '../../../lib/linkPreview';

function Harness() {
  const appearance = useAppearanceSettings('dark', [], () => {});
  return (
    <AppearanceSection appearance={appearance} activeTheme="dark" themes={AVAILABLE_THEMES} customThemes={[]} onThemeChange={() => {}} />
  );
}

describe('switch for link previews on this device', () => {
  afterEach(() => setServerLinkPreviews(true));

  it('is offered while the server has link previews on', () => {
    render(<Harness />);
    expect(screen.getByRole('switch', { name: 'Link-Vorschauen anzeigen' })).toBeTruthy();
  });

  it('is gone when the administration switched them off for the server', () => {
    render(<Harness />);
    act(() => setServerLinkPreviews(false));
    expect(screen.queryByRole('switch', { name: 'Link-Vorschauen anzeigen' })).toBeNull();
    expect(document.querySelector('[data-device-link-previews]')).toBeNull();
  });
});
