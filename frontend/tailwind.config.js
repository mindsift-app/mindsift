import animate from 'tailwindcss-animate';
// Theme colours are CSS variables, so Tailwind cannot apply opacity modifiers (bg-accent/15) by itself.
// v() mixes the variable with transparent for a modifier; plain classes keep the bare variable, so only
// the tints depend on color-mix() support.
const v = (name) => ({ opacityValue }) =>
  opacityValue === undefined || opacityValue === '1' || String(opacityValue).startsWith('var(')
    ? `var(${name})`
    : `color-mix(in srgb, var(${name}) calc(${opacityValue} * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    // Phone layout below sm, desktop from sm (see AGENTS.md). sm is 768 px, not Tailwind's 640, so phones in
    // landscape and small tablets (iPad mini upright) get the touch layout too; keep PHONE_MAX_WIDTH in
    // src/lib/breakpoints.ts and the media queries in index.css in step.
    screens: {
      sm: '768px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        canvas: v('--bg-app'),
        editor: v('--bg-editor'),
        sidebar: v('--bg-sidebar'),
        panel: {
          DEFAULT: v('--bg-panel'),
          elevated: v('--bg-panel-elevated'),
          hover: v('--bg-panel-hover'),
        },
        surface: {
          DEFAULT: v('--bg-panel'),
          elevated: v('--bg-panel-elevated'),
          hover: v('--bg-panel-hover'),
          border: v('--border-color'),
        },
        input: v('--bg-input'),
        overlay: v('--bg-overlay'),
        code: v('--bg-code'),
        'code-fg': v('--text-code'),
        main: v('--text-main'),
        muted: v('--text-muted'),
        faint: v('--text-faint'),
        'on-accent': v('--text-on-accent'),
        accent: {
          DEFAULT: v('--accent-primary'),
          hover: v('--accent-hover'),
          dim: v('--accent-dim'),
          border: v('--accent-border'),
        },
        brand: {
          DEFAULT: v('--accent-primary'),
          hover: v('--accent-hover'),
          dark: v('--accent-primary'),
        },
        status: {
          ok: v('--color-success'),
          'ok-bg': v('--bg-success'),
          'ok-border': v('--border-success'),
          err: v('--color-danger'),
          'err-bg': v('--bg-danger'),
          'err-border': v('--border-danger'),
          warn: v('--color-warning'),
          'warn-bg': v('--bg-warning'),
          'warn-border': v('--border-warning'),
          info: v('--accent-hover'),
          danger: v('--color-danger'),
        },
        // Extra tones for Kanban columns; fallbacks in index.css, themes may set their own
        tone: {
          blue: v('--color-info'),
          purple: v('--color-purple'),
        },
        border: v('--border-color'),
        // Aliases for names used in components (e.g. avatar initials), mapped to theme colours
        primary: v('--accent-primary'),
        secondary: v('--text-muted'),
        info: v('--accent-hover'),
        success: v('--color-success'),
        warning: v('--color-warning'),
        danger: v('--color-danger'),
      },
      borderColor: {
        DEFAULT: 'var(--border-color)',
        border: 'var(--border-color)',
        subtle: 'var(--border-subtle)',
        strong: 'var(--border-strong)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
        btn: 'var(--radius-btn)',
        input: 'var(--radius-input)',
        checkbox: 'var(--radius-checkbox)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        panel: 'var(--shadow-panel)',
      },
      fontFamily: {
        sans: [
          'Inter Variable',
          'Inter',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  // animate-in / fade-in / slide-in-from-* / zoom-in-* used by menus, sheets and dialogs
  plugins: [animate],
};
