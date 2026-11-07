import type { CSSProperties } from 'react';

// Search and filter fields: password managers (1Password, LastPass, Bitwarden, Dashlane) and the browser's
// own autofill must not take them for login fields
export const NO_AUTOFILL = {
  autoComplete: 'off',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;

// Password fields that are not the user's own login (other people's accounts, the mail server, the
// password of a public link): shown as dots without type="password", so password managers neither offer
// the user's login nor save it there
export const MASKED = { WebkitTextSecurity: 'disc' } as CSSProperties;
