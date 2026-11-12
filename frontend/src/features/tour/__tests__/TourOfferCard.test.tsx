import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { api } from '../../../lib/api';
import type { User } from '../../../lib/types';
import { TourOfferCard } from '../TourOfferCard';
import { DEMO_TOUR_OFFERED_KEY, tourOfferPending } from '../tourOffer';
import { onTourStartRequest, requestTourStart } from '../tourEvents';

vi.mock('../../../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/api')>();
  return { ...actual, api: { ...actual.api, updateSettings: vi.fn() } };
});

const anna = (tourOffered?: boolean) =>
  ({ id: 'usr_anna', email: 'anna@example.com', displayName: 'Anna', role: 'member', tourOffered }) as User;

const card = () => screen.queryByRole('dialog', { name: 'Kurze Tour starten?' });

describe('tourOfferPending', () => {
  beforeEach(() => localStorage.clear());

  it('waits for the profile from /auth/me', () => {
    expect(tourOfferPending(anna(undefined), false)).toBe(false);
    expect(tourOfferPending(anna(undefined), true)).toBe(false);
  });

  it('follows the account outside the demo', () => {
    expect(tourOfferPending(anna(false), false)).toBe(true);
    expect(tourOfferPending(anna(true), false)).toBe(false);
    localStorage.setItem(DEMO_TOUR_OFFERED_KEY, '1');
    expect(tourOfferPending(anna(false), false)).toBe(true);
  });

  it('follows the browser in the demo, whatever the shared account says', () => {
    expect(tourOfferPending(anna(true), true)).toBe(true);
    localStorage.setItem(DEMO_TOUR_OFFERED_KEY, '1');
    expect(tourOfferPending(anna(false), true)).toBe(false);
  });
});

describe('TourOfferCard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(api.updateSettings).mockReset();
    vi.mocked(api.updateSettings).mockResolvedValue(anna(true));
  });

  it('shows only for an account that was not asked yet', () => {
    const { rerender } = render(<TourOfferCard user={anna(true)} demoMode={false} onUserUpdated={() => {}} />);
    expect(card()).toBeNull();
    rerender(<TourOfferCard user={anna(undefined)} demoMode={false} onUserUpdated={() => {}} />);
    expect(card()).toBeNull();
    rerender(<TourOfferCard user={anna(false)} demoMode={false} onUserUpdated={() => {}} />);
    expect(card()).not.toBeNull();
    expect(screen.getByText(/in der Hilfe starten/)).toBeTruthy();
  });

  it('waits while something else holds the screen', () => {
    const { rerender } = render(<TourOfferCard user={anna(false)} demoMode={false} suppressed onUserUpdated={() => {}} />);
    expect(card()).toBeNull();
    rerender(<TourOfferCard user={anna(false)} demoMode={false} onUserUpdated={() => {}} />);
    expect(card()).not.toBeNull();
  });

  it.each([['Nein danke'], ['Schließen']])('"%s" remembers the answer on the account', async (label) => {
    const onUserUpdated = vi.fn();
    render(<TourOfferCard user={anna(false)} demoMode={false} onUserUpdated={onUserUpdated} />);
    const started = vi.fn();
    const stop = onTourStartRequest(started);
    fireEvent.click(screen.getByRole('button', { name: label }));
    stop();
    expect(card()).toBeNull();
    expect(api.updateSettings).toHaveBeenCalledWith({ tourOffered: true });
    await waitFor(() => expect(onUserUpdated).toHaveBeenCalledWith(anna(true)));
    expect(started).not.toHaveBeenCalled();
    expect(localStorage.getItem(DEMO_TOUR_OFFERED_KEY)).toBeNull();
  });

  it('"Starten" starts the tour and remembers the answer once', () => {
    render(<TourOfferCard user={anna(false)} demoMode={false} onUserUpdated={() => {}} />);
    const started = vi.fn();
    const stop = onTourStartRequest(started);
    fireEvent.click(screen.getByRole('button', { name: 'Starten' }));
    stop();
    expect(started).toHaveBeenCalledTimes(1);
    expect(card()).toBeNull();
    expect(api.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('counts a tour started from the help page as an answer', () => {
    render(<TourOfferCard user={anna(false)} demoMode={false} onUserUpdated={() => {}} />);
    act(() => requestTourStart());
    expect(card()).toBeNull();
    expect(api.updateSettings).toHaveBeenCalledWith({ tourOffered: true });
  });

  it('remembers the answer in the browser in the demo, not on the shared account', () => {
    const { unmount } = render(<TourOfferCard user={anna(false)} demoMode onUserUpdated={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Nein danke' }));
    expect(card()).toBeNull();
    expect(localStorage.getItem(DEMO_TOUR_OFFERED_KEY)).toBe('1');
    expect(api.updateSettings).not.toHaveBeenCalled();
    unmount();
    // The next visit in this browser is not asked again
    render(<TourOfferCard user={anna(false)} demoMode onUserUpdated={() => {}} />);
    expect(card()).toBeNull();
  });
});
