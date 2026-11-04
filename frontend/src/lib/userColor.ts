// One fixed color per person, derived from the user id, so the same person looks the same everywhere
// (initials, avatar rings, lock markers in notes) and on every device without storing anything.
// The hues are mixed with the theme variables, so they stay readable in light and dark themes.

const PALETTE = [
  '#e5484d', // red
  '#f76b15', // orange
  '#d69e00', // amber
  '#7cb342', // lime
  '#30a46c', // green
  '#12a594', // teal
  '#00a2c7', // cyan
  '#0090ff', // blue
  '#3e63dd', // indigo
  '#8e4ec6', // violet
  '#d6409f', // pink
  '#a07553', // brown
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (Math.imul(h, 31) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Base hue of a person; key is the user id (falls back to name or email where no id is known)
export function userColor(key?: string): string {
  return PALETTE[hash(key || 'user') % PALETTE.length];
}

// Ready-made CSS colors on top of the theme: text, filled background, soft border, ring and a faint tint
export function userColorStyles(key?: string) {
  const c = userColor(key);
  return {
    base: c,
    text: `color-mix(in srgb, ${c} 75%, var(--text-main))`,
    fill: `color-mix(in srgb, ${c} 22%, var(--bg-panel))`,
    border: `color-mix(in srgb, ${c} 40%, var(--bg-panel))`,
    ring: `color-mix(in srgb, ${c} 85%, var(--bg-panel))`,
    tint: `color-mix(in srgb, ${c} 9%, transparent)`,
  };
}
