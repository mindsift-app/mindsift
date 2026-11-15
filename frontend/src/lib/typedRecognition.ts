import { useSyncExternalStore } from 'react';

// "Datum und Menge beim Tippen erkennen" (Kontoeinstellungen → Sprache): whether due dates (lib/naturalDate.ts,
// components/NaturalDateHint.tsx, the hold-to-dictate capture) and quantities of list items
// (features/lists/QuantityHint.tsx) are read from what the person types or dictates. A setting of the account
// (typedRecognition, PATCH /auth/settings), so it holds on every device; App.tsx passes it in. On until the
// account says otherwise.

let enabled = true;
const listeners = new Set<() => void>();

/** The account's choice; undefined (not loaded, an older server) counts as on. */
export function setTypedRecognition(next: boolean | undefined): void {
  const value = next !== false;
  if (value === enabled) return;
  enabled = value;
  listeners.forEach((l) => l());
}

export function typedRecognitionOn(): boolean {
  return enabled;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** typedRecognitionOn for components, rendering again when the choice changes. */
export function useTypedRecognition(): boolean {
  return useSyncExternalStore(subscribe, typedRecognitionOn, typedRecognitionOn);
}
