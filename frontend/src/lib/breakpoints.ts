// Width below which the app uses its phone layout; the same value as Tailwind's sm (tailwind.config.js)
// and the media queries in index.css.
export const PHONE_MAX_WIDTH = 768;

export const isPhoneWidth = (): boolean => typeof window !== 'undefined' && window.innerWidth < PHONE_MAX_WIDTH;
