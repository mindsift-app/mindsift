import { api } from '../../lib/api';
import type { User } from '../../lib/types';

// Whether the app still has to ask about the guided tour (TourOfferCard). An account is asked once, on
// any device: the server keeps the answer (tourOffered, storage/tour.go). The demo's accounts are shared
// by every visitor, so there each browser remembers it instead.
export const DEMO_TOUR_OFFERED_KEY = 'mindsift:tour-offered';

export function tourOfferPending(user: Pick<User, 'tourOffered'>, demoMode: boolean): boolean {
  // Only /auth/me says it, so the question waits until the app has loaded its data
  if (user.tourOffered === undefined) return false;
  if (demoMode) {
    try {
      return localStorage.getItem(DEMO_TOUR_OFFERED_KEY) !== '1';
    } catch {
      return false; // a browser that cannot remember it would be asked on every visit
    }
  }
  return user.tourOffered === false;
}

// Remembers the answer, whichever it was. Returns the updated profile (not in the demo).
export async function rememberTourOffered(demoMode: boolean): Promise<User | null> {
  if (demoMode) {
    try {
      localStorage.setItem(DEMO_TOUR_OFFERED_KEY, '1');
    } catch {
      // only for this visit then
    }
    return null;
  }
  return api.updateSettings({ tourOffered: true });
}
