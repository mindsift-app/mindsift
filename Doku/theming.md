# 🎨 Single-File CSS Theming Engine & Design System

MindSift implements a radically simple, modular theming system. Instead of scattering color and geometry values across dozens of Tailwind classes throughout hundreds of components, the platform's entire appearance is controlled via **a single CSS file per theme**.

---

## 💡 1. Philosophy: 1 File = 1 Complete Theme

Every theme resides in the [`frontend/src/themes/`](../frontend/src/themes/) directory and defines all visual properties using standardized CSS variables.

### Separation of Structure and Design
- **React components** define exclusively semantic classes (such as `.panel-surface`, `.input-field`, `.btn-primary`, `text-main`, `bg-canvas`).
- **The active theme CSS file** determines the specific colors, contrasts, border widths, and corner radii assigned to these classes.

---

## 🧱 2. The 6 Standardized Variable Blocks

Each theme file is structured into six strictly defined sections:

```css
:root[data-theme="your-theme"] {
  /* ==========================================================================
     1. ACCENT COLOR (Focus, Primary Actions, Highlights)
     ========================================================================== */
  --accent: #2563eb;                    /* Primary buttons & active tabs */
  --accent-hover: #3b82f6;              /* Hover state */
  --accent-dim: rgba(37, 99, 235, 0.15);/* Transparent background for badges */
  --accent-contrast: #ffffff;           /* Text color on accent surfaces */

  /* ==========================================================================
     2. SURFACES & BACKGROUNDS
     ========================================================================== */
  --bg-canvas: #0e1013;                 /* Base background of the entire page */
  --bg-panel: #16181d;                  /* Panels, cards, modals & sidebars */
  --bg-panel-elevated: #1f2229;         /* Elevated elements & hover panels */
  --bg-input: #121418;                  /* Background of text input fields */
  --bg-code: #0b0c0f;                   /* Code blocks & keyboard badges */
                                        /* Optional: --text-code, plain text in code blocks (default --text-main) */
  --bg-overlay: rgba(0, 0, 0, 0.75);    /* Modal backdrop overlay */

  /* ==========================================================================
     3. TEXT & CONTRAST
     ========================================================================== */
  --text-main: #f4f4f5;                 /* Main text, headings, labels */
  --text-muted: #a1a1aa;                /* Secondary text, descriptions */
  --text-faint: #71717a;                /* Subtlest text, keyboard hints */
  --text-on-accent: #ffffff;            /* Readable text on --accent */

  /* ==========================================================================
     4. BORDERS, DIVIDERS & SHADOWS
     ========================================================================== */
  --border-color: rgba(255, 255, 255, 0.08); /* Default divider lines */
  --border-strong: rgba(255, 255, 255, 0.18);/* Focused borders, tabs */
  --shadow-panel: 0 4px 20px -2px rgba(0, 0, 0, 0.45); /* Box shadows */

  /* ==========================================================================
     5. STATUS & SIGNAL COLORS
     ========================================================================== */
  --status-ok: #22c55e;                 /* Done, Online, Active (Green) */
  --status-err: #ef4444;                /* Error, Delete, Urgent (Red) */
  --status-warn: #eab308;               /* Important, Warning, Locked (Yellow) */
  --status-info: #3b82f6;               /* Hints, Information (Blue) */

  /* ==========================================================================
     6. CORNER RADII / GEOMETRY
     ========================================================================== */
  --radius-card: 0px;                   /* Corner radius of panels & cards */
  --radius-btn: 2px;                    /* Corner radius of buttons */
  --radius-input: 2px;                  /* Corner radius of input fields */
  --radius-checkbox: 2px;               /* Checkboxes */
  --radius-pill: 9999px;                /* Pills & status badges */
}
```

---

## 🎭 3. Available Default Themes

| Theme ID | File | Style & Character | Default Geometry |
| :--- | :--- | :--- | :--- |
| `dark` | [`theme-dark.css`](../frontend/src/themes/theme-dark.css) | Default; colours of mindsift.app, dark | Rounded (`14px` cards, `8px` buttons) |
| `light` | [`theme-light.css`](../frontend/src/themes/theme-light.css) | Colours of mindsift.app, light, with dark code blocks (`--text-code`) | Rounded (`14px` cards, `8px` buttons) |
| `terracotta` | [`theme-terracotta.css`](../frontend/src/themes/theme-terracotta.css) | Warm cream paper, ink, terracotta accent, custom code colors in earth tones | Soft (`12px`) |
| `terracotta-night` | [`theme-terracotta-night.css`](../frontend/src/themes/theme-terracotta-night.css) | Espresso brown, cream text, glowing terracotta accent | Soft (`12px`) |
| `fjord` / `fjord-night` | [`theme-fjord.css`](../frontend/src/themes/theme-fjord.css), [`theme-fjord-night.css`](../frontend/src/themes/theme-fjord-night.css) | Cool paper and glacier blue / night blue | Soft (`12px`) |
| `polarized-light` | [`theme-polarized-light.css`](../frontend/src/themes/theme-polarized-light.css) | Light counterpart to Polarized: mint white, petrol | Square (`0px`) |
| `suri-light` | [`theme-suri-light.css`](../frontend/src/themes/theme-suri-light.css) | Light counterpart to Suri: lavender, plum | Soft (`10px`) |

The built-in themes are grouped into color families, each containing a light and dark variant (`THEME_FAMILIES` in [`theme.ts`](../frontend/src/lib/theme.ts)). Additionally, per device under Appearance, users can configure: Light/Dark "System default" (switches within the family), Corners (`data-corners="round|square"` overrides `--radius-*` values), Button borders (`data-button-borders="off"`), and a custom accent color (sets `--accent-*` directly on the root element). Code colors in `index.css` are fallback values only (`:where(...)`); the `--code-*` values of a theme always take precedence.
| `polarized` | [`theme-polarized.css`](../frontend/src/themes/theme-polarized.css) | Deep dark obsidian with electric green/teal | Strictly square (`0px` cards, `2px` buttons) |
| `suri` | [`theme-suri.css`](../frontend/src/themes/theme-suri.css) | Warm midnight plum with velvety orchid | Softly rounded (`10px` cards, `6px` buttons) |
| *Template* | [`theme-template.css`](../frontend/src/themes/theme-template.css) | Fully documented boilerplate template | Fully customizable |

---

## 🔌 4. Tailwind Bridge & Semantic Classes

In [`frontend/src/index.css`](../frontend/src/index.css) and `tailwind.config.js`, semantic utility classes are defined that automatically adapt to the selected theme:

- `.panel-surface`: Applies `--bg-panel`, `--border-color`, and `--radius-card`.
- `.input-field`: Applies `--bg-input`, `--border-color`, `--radius-input`, and `--text-main`.
- `.btn-primary`: Accent button with `--accent`, `--accent-hover`, `--text-on-accent`, and `--radius-btn`.
- `.btn-action`: Secondary action with subtle border and hover state.
- `.checkbox-square`: Checkbox with `--radius-checkbox`.
- `.capture-pill`: Special pill for the desktop quick-capture bar with `--radius-pill`.

### 🏷️ App Icon & Branding
The standard MindSift brand icon (`frontend/public/icon.svg`, PWA icons, and social preview images) uses the primary accent color `--accent: #2563eb` and `--text-on-accent: #ffffff` with characteristic slight corner roundings (`rounded-xl` or `rx=108`). For details on the asset matrix and icon formats, see [architecture.md](architecture.md#app-icons-pwa--social-preview-open-graph).

---

## 🛠️ 5. Creating a Custom Theme

### Without Rebuild: Theme Manager in Account Settings

Under **Account Settings → Appearance & Themes**, every user can create custom themes:

- Download the **template**, copy it, or paste it directly into the input field (`theme-template.css`).
- **Upload** CSS as a `.css` file or **paste** it, assign a name, "Save & activate".
- Custom themes appear as tiles in the gallery and in the profile dropdown, complete with **Edit** and **Delete** options.

Technical details:

- Stored per user in the `user_themes` table (API `GET/POST /themes`, `DELETE /themes/{id}`, max 200 KB), meaning they are saved in the data volume and accessible across all devices.
- A custom theme is activated as `custom:<id>`. [`theme.ts`](../frontend/src/lib/theme.ts) injects the CSS live as `<style id="mindsift-custom-theme">` at the end of `<head>` (thus overriding built-in themes) and applies the value from the selector `[data-theme="…"]` of the CSS to `<html data-theme>`. Without such a selector, the CSS applies to `:root`. Comments are ignored.
- Whether the Tailwind `dark` class is set depends on the luminance of `--bg-app`.
- The CSS of the active theme is additionally stored in `localStorage` so that it applies immediately on startup; after login, it is synchronized with the server. If deleted, the appearance falls back to "Dark".

### Built-in Theme (With Rebuild)

To permanently integrate a new theme (e.g., "Nordic Blue" or "Cyberpunk") into MindSift:
1. Copy `frontend/src/themes/theme-template.css` to `frontend/src/themes/theme-mytheme.css`.
2. Change the selector `:root[data-theme="template"]` to `:root[data-theme="mytheme"]`.
3. Adjust colors and corner radii as desired.
4. Import the CSS file in [`frontend/src/lib/theme.ts`](../frontend/src/lib/theme.ts) and add the theme to the `AVAILABLE_THEMES` array.
5. The new theme is immediately available in the account settings and profile dropdown!
