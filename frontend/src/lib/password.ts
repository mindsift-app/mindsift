// Same rule as the server (auth.ValidatePassword): at least 8 characters, not only spaces.
// Only for setting a password; logging in with an older, shorter one keeps working.
export const MIN_PASSWORD_LENGTH = 8;

export const passwordProblem = (password: string): string | null =>
  !password.trim() || Array.from(password).length < MIN_PASSWORD_LENGTH
    ? `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein`
    : null;
