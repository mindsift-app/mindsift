// Width below which the app uses its phone layout; the same value as Tailwind's sm (the @theme block in index.css)
// and the media queries in index.css.
export const PHONE_MAX_WIDTH = 768;

export const isPhoneWidth = (): boolean => typeof window !== 'undefined' && window.innerWidth < PHONE_MAX_WIDTH;

// Tailwind's lg (the @theme block in index.css): the full desktop layout, e.g. the sidebar next to the note
export const LARGE_QUERY = '(min-width: 1024px)';

export const isLargeWidth = (): boolean => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(LARGE_QUERY).matches;
