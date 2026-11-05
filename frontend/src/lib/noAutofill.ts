// Search and filter fields: password managers (1Password, LastPass, Bitwarden, Dashlane) and the browser's
// own autofill must not take them for login fields
export const NO_AUTOFILL = {
  autoComplete: 'off',
  'data-1p-ignore': 'true',
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
} as const;
