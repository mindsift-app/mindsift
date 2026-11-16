# 🎨 Single-File CSS Theming Engine & Design System

MindSift implements a radically simple, modular theming system. Instead of scattering color and geometry values across dozens of Tailwind classes throughout hundreds of components, the platform's entire appearance is controlled via **a single CSS file per theme**.

---

## 💡 1. Philosophy: 1 File = 1 Complete Theme

Every theme resides in the [`frontend/src/themes/`](../frontend/src/themes/) directory and defines all visual properties using standardized CSS variables.

### Separation of Structure and Design
- **React components** define exclusively semantic classes (such as `.panel-surface`, `.input-field`, `.btn-primary`, `text-main`, `bg-canvas`).
- **The active theme CSS file** determines the specific colors, contrasts, border widths, and corner radii assigned to these classes.

---

## 🧱 2. The Variable Blocks

Each theme file is structured into the same groups (the full, commented list is [`theme-template.css`](../frontend/src/themes/theme-template.css)). Components only use the Tailwind names on the right (section 4), never fixed colours.

| Variable | Tailwind class | Used for | In the custom theme editor |
| :--- | :--- | :--- | :--- |
| `--accent-primary` | `accent`, `brand` | Primary buttons, active tabs, focus, links | tile |
| `--accent-hover` | `accent-hover`, `status-info` | Hover of accent elements, info colour | set along with the accent |
| `--accent-dim`, `--accent-border` | `accent-dim`, `accent-border` | Tinted background and border of accent badges | derived from the accent |
| `--text-on-accent` | `on-accent` | Text on accent surfaces | set along with the accent |
| `--bg-app` | `canvas` | Page background | tile |
| `--bg-panel` | `panel`, `surface` | Cards, header, sidebar, dropdowns | tile |
| `--bg-panel-elevated` | `panel-elevated` | Highlighted elements, active rows | tile |
| `--bg-panel-hover` | `panel-hover` | Hover on surfaces | more colours |
| `--bg-input` | `input` | Text fields, selects | more colours |
| `--bg-code` | `code` | Code blocks, keyboard badges | more colours |
| `--bg-editor`, `--bg-sidebar` | `editor`, `sidebar` | Note editor and folder bar (default `--bg-app` / `--bg-panel`) | – |
| `--bg-overlay` | `overlay` | Backdrop behind dialogs | – |
| `--text-main` | `main` | Main text, headings | tile |
| `--text-muted` | `muted` | Secondary text, descriptions | tile |
| `--text-faint` | `faint` | Subtlest text: placeholders, hints, counts, done tasks, inactive buttons | more colours |
| `--text-code` | `code-fg` | Plain text in code blocks (default `--text-main`) | – |
| `--border-color`, `--border-subtle`, `--border-strong` | `border`, `border-subtle`, `border-strong` | Lines, dividers, hovered and focused borders | `--border-color` under more colours |
| `--shadow-panel` | `shadow-panel` | Shadows of panels and menus | – |
| `--scrollbar-thumb`, `--scrollbar-thumb-hover` | – | Scrollbars | – |
| `--color-success` / `--bg-success` / `--border-success` | `status-ok…` | Done, online, saved | – |
| `--color-danger` / `--bg-danger` / `--border-danger` | `status-err…` | Errors, delete, urgent | – |
| `--color-warning` / `--bg-warning` / `--border-warning` | `status-warn…` | Important, warnings, locked | – |
| `--color-info`, `--color-purple` | `tone-blue`, `tone-purple` | Extra Kanban column colours (defaults in `index.css`) | – |
| `--radius-card`, `--radius-btn`, `--radius-input`, `--radius-checkbox`, `--radius-pill` | `rounded-card` … | Corners | – |
| `--code-keyword` … `--code-variable` | – | Syntax highlighting (defaults in `index.css`) | – |

### Derived colours

The template does not give the secondary colours fixed values but derives them from the main ones with `color-mix()`, so a theme that only changes the six tiles stays consistent (`DERIVED_THEME_VARS` in [`themeCss.ts`](../frontend/src/lib/themeCss.ts)):

```css
--text-faint: color-mix(in srgb, var(--text-muted) 70%, var(--bg-app));
--bg-panel-hover: color-mix(in srgb, var(--bg-panel-elevated) 88%, var(--text-main));
--bg-input: var(--bg-app);
--bg-code: color-mix(in srgb, var(--bg-app) 70%, #000000);
--border-color: color-mix(in srgb, var(--text-main) 12%, transparent);
--border-subtle: color-mix(in srgb, var(--border-color) 55%, transparent);
--border-strong: color-mix(in srgb, var(--border-color) 82%, var(--text-main));
--scrollbar-thumb: color-mix(in srgb, var(--text-main) 16%, transparent);
--scrollbar-thumb-hover: color-mix(in srgb, var(--text-main) 30%, transparent);
```

Built-in themes set all of these themselves. For a custom theme, a variable it leaves out gets the derived value (a `:root` rule put before the theme's CSS) instead of the default theme's grey, and a value still equal to the fixed grey of the template before it derived them (`#71717a`, `rgba(255, 255, 255, 0.09)` …) is treated as derived too; the stored CSS takes this over with the next colour change.

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

In [`frontend/src/index.css`](../frontend/src/index.css) (Tailwind CSS 4: the `@theme` blocks map the theme variables to Tailwind colours, corners and shadows), semantic utility classes are defined that automatically adapt to the selected theme:

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

- Under the heading **Custom themes**, each theme is one flat row: a round button to use it, the name (editable in place, saved on Enter or leaving the field), colour tiles for `--bg-app`, `--bg-panel`, `--bg-panel-elevated`, `--text-main`, `--text-muted` and `--accent-primary` (the browser's colour picker, as for the device accent colour), a fold-out **More colours** with labelled tiles for `--text-faint`, `--bg-panel-hover`, `--bg-input`, `--border-color` and `--bg-code`, **Export** and **Delete** (asks with `ConfirmPopover`, cannot be undone). A tile of a derived colour shows the colour it currently gives; picking one fixes it to that value.
- A colour change rewrites only that variable's value in the CSS ([`themeCss.ts`](../frontend/src/lib/themeCss.ts); comments and everything else stay as they are, a missing variable is added to the first rule). A new accent also sets `--accent-hover` and `--text-on-accent` when the theme has plain hex values for them. The change applies live while the theme is active and is saved about 0.6 s after the picker rests. A device accent colour still takes precedence over the theme's.
- The dashed **+** below the list asks for a name and creates a theme from `theme-template.css`, which it activates right away.
- **Export** downloads the stored CSS unchanged as `theme-<name>.css`; **Import CSS** reads such a file back (name from the file name without `theme-` and `.css`), so themes can be shared. The template stays downloadable and can be copied.
- Custom themes also appear in the profile dropdown.

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
