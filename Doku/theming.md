# 🎨 Single-File CSS Theming Engine & Design-System

MindSift implementiert ein radikal einfaches, modulares Theming-System. Anstatt Farb- und Geometriewerte in Dutzenden Tailwind-Klassen über hunderte Komponenten zu verstreuen, wird das komplette Erscheinungsbild der Plattform über **eine einzige CSS-Datei pro Theme** gesteuert.

---

## 💡 1. Philosophie: 1 Datei = 1 komplettes Theme

Jedes Theme liegt im Verzeichnis [`frontend/src/themes/`](../frontend/src/themes/) und definiert alle visuellen Eigenschaften über standardisierte CSS-Variablen. 

### Trennung von Struktur und Design
- **React-Komponenten** definieren ausschließlich semantische Klassen (wie `.panel-surface`, `.input-field`, `.btn-primary`, `text-main`, `bg-canvas`).
- **Die aktive Theme-CSS-Datei** bestimmt, welche konkreten Farben, Kontraste, Rahmenbreiten und Ecken-Rundungen diesen Klassen zugewiesen werden.

---

## 🧱 2. Die 6 standardisierten Variablen-Blöcke

Jede Theme-Datei gliedert sich in sechs exakt definierte Bereiche:

```css
:root[data-theme="dein-theme"] {
  /* ==========================================================================
     1. AKZENTFARBE (Fokus, Primäraktionen, Highlights)
     ========================================================================== */
  --accent: #2563eb;                    /* Primäre Schaltflächen & aktive Tabs */
  --accent-hover: #3b82f6;              /* Hover-Zustand */
  --accent-dim: rgba(37, 99, 235, 0.15);/* Transparenter Hintergrund für Badges */
  --accent-contrast: #ffffff;           /* Textfarbe auf Akzentflächen */

  /* ==========================================================================
     2. OBERFLÄCHEN & HINTERGRÜNDE
     ========================================================================== */
  --bg-canvas: #0e1013;                 /* Grundhintergrund der gesamten Seite */
  --bg-panel: #16181d;                  /* Panels, Karten, Modals & Seitenleisten */
  --bg-panel-elevated: #1f2229;         /* Hervorgehobene Elemente & Hover-Panels */
  --bg-input: #121418;                  /* Hintergrund von Textfeldern */
  --bg-code: #0b0c0f;                   /* Codeblöcke & Tastatur-Badges */
  --bg-overlay: rgba(0, 0, 0, 0.75);    /* Modal-Hintergrund Backdrop */

  /* ==========================================================================
     3. TEXT & KONTRASTE
     ========================================================================== */
  --text-main: #f4f4f5;                 /* Haupttext, Überschriften, Labels */
  --text-muted: #a1a1aa;                /* Sekundärtext, Beschreibungen */
  --text-faint: #71717a;                /* Dezentester Text, Tastaturhinweise */
  --text-on-accent: #ffffff;            /* Lesbarer Text auf --accent */

  /* ==========================================================================
     4. RAHMEN, LINIEN & SCHATTEN
     ========================================================================== */
  --border-color: rgba(255, 255, 255, 0.08); /* Standard-Trennlinien */
  --border-strong: rgba(255, 255, 255, 0.18);/* Fokussierte Rahmen, Tabs */
  --shadow-panel: 0 4px 20px -2px rgba(0, 0, 0, 0.45); /* Box-Shadows */

  /* ==========================================================================
     5. STATUS- & SIGNALFARBEN
     ========================================================================== */
  --status-ok: #22c55e;                 /* Erledigt, Online, Aktiv (Grün) */
  --status-err: #ef4444;                /* Fehler, Löschen, Dringend (Rot) */
  --status-warn: #eab308;               /* Wichtig, Warnung, Gesperrt (Gelb) */
  --status-info: #3b82f6;               /* Hinweise, Information (Blau) */

  /* ==========================================================================
     6. RUNDUNGEN / GEOMETRIE
     ========================================================================== */
  --radius-card: 0px;                   /* Eckenrundung von Panels & Karten */
  --radius-btn: 2px;                    /* Eckenrundung von Schaltflächen */
  --radius-input: 2px;                  /* Eckenrundung von Eingabefeldern */
  --radius-checkbox: 2px;               /* Checkboxen */
  --radius-pill: 9999px;                /* Pillen & Status-Badges */
}
```

---

## 🎭 3. Verfügbare Standard-Themes

| Theme-ID | Datei | Stil & Charakter | Standard-Geometrie |
| :--- | :--- | :--- | :--- |
| `dark` | [`theme-dark.css`](../frontend/src/themes/theme-dark.css) | Standard Dark Slate / Monochrom | Streng eckig (`0px` Cards, `2px` Buttons) |
| `light` | [`theme-light.css`](../frontend/src/themes/theme-light.css) | Daylight Clean White / Minimalistisch | Modern dezent (`4px` Cards, `4px` Buttons) |
| `terracotta` | [`theme-terracotta.css`](../frontend/src/themes/theme-terracotta.css) | Warmes Cremepapier, Tinte, Terrakotta-Akzent, eigene Code-Farben in Erdtönen | Weich (`12px`) |
| `terracotta-night` | [`theme-terracotta-night.css`](../frontend/src/themes/theme-terracotta-night.css) | Espresso-Braun, Creme-Schrift, glühender Terrakotta-Akzent | Weich (`12px`) |
| `fjord` / `fjord-night` | [`theme-fjord.css`](../frontend/src/themes/theme-fjord.css), [`theme-fjord-night.css`](../frontend/src/themes/theme-fjord-night.css) | Kühles Papier und Gletscherblau / Nachtblau | Weich (`12px`) |
| `polarized-light` | [`theme-polarized-light.css`](../frontend/src/themes/theme-polarized-light.css) | Helles Gegenstück zu Polarized: Mintweiß, Petrol | Eckig (`0px`) |
| `suri-light` | [`theme-suri-light.css`](../frontend/src/themes/theme-suri-light.css) | Helles Gegenstück zu Suri: Lavendel, Pflaume | Weich (`10px`) |

Die eingebauten Themes sind in Farbfamilien mit je einer hellen und dunklen Variante gruppiert (`THEME_FAMILIES` in [`theme.ts`](../frontend/src/lib/theme.ts)). Pro Gerät lassen sich unter Darstellung zusätzlich einstellen: Hell/Dunkel „Wie System“ (wechselt innerhalb der Familie), Ecken (`data-corners="round|square"` überschreibt die `--radius-*`-Werte), Rahmen an Knöpfen (`data-button-borders="off"`) und eine eigene Akzentfarbe (setzt `--accent-*` direkt am Wurzelelement). Code-Farben in `index.css` sind nur Rückfallwerte (`:where(...)`), die `--code-*`-Werte eines Themes gewinnen immer.
| `polarized` | [`theme-polarized.css`](../frontend/src/themes/theme-polarized.css) | Tiefdunkles Obsidian mit elektrischem Grün/Türkis | Streng eckig (`0px` Cards, `2px` Buttons) |
| `suri` | [`theme-suri.css`](../frontend/src/themes/theme-suri.css) | Warmes Mitternachts-Pflaume mit samtiger Orchidee | Weich gerundet (`10px` Cards, `6px` Buttons) |
| *Template* | [`theme-template.css`](../frontend/src/themes/theme-template.css) | Vollständig dokumentierte Kopiervorlage | Frei anpassbar |

---

## 🔌 4. Tailwind-Bridge & Semantische Klassen

In [`frontend/src/index.css`](../frontend/src/index.css) und `tailwind.config.js` sind die semantischen Utility-Klassen definiert, die sich automatisch an das gewählte Theme anpassen:

- `.panel-surface`: Wendet `--bg-panel`, `--border-color` und `--radius-card` an.
- `.input-field`: Wendet `--bg-input`, `--border-color`, `--radius-input` und `--text-main` an.
- `.btn-primary`: Akzent-Schaltfläche mit `--accent`, `--accent-hover`, `--text-on-accent` und `--radius-btn`.
- `.btn-action`: Sekundär-Aktion mit dezentem Rahmen und Hover-Zustand.
- `.checkbox-square`: Kontrollkästchen mit `--radius-checkbox`.
- `.capture-pill`: Spezial-Pille für die Desktop-Schnelleingabeleiste mit `--radius-pill`.

### 🏷️ App-Icon & Branding
Das standardmäßige Marken-Icon von MindSift (`frontend/public/icon.svg`, PWA-Icons und Social-Preview-Bilder) folgt der primären Akzentfarbe `--accent: #2563eb` und `--text-on-accent: #ffffff` mit den typischen leichten Eckenrundungen (`rounded-xl` bzw. `rx=108`). Details zur Asset-Matrix und den Icon-Formaten siehe [architecture.md](architecture.md#app-icons-pwa--social-preview-open-graph).

---

## 🛠️ 5. Ein eigenes Theme erstellen

### Ohne Rebuild: Theme-Manager in den Kontoeinstellungen

Unter **Kontoeinstellungen → Darstellung & Themes** kann jeder Benutzer eigene Themes anlegen:

- **Vorlage** herunterladen, kopieren oder direkt ins Eingabefeld einfügen (`theme-template.css`).
- CSS als **`.css`-Datei hochladen** oder **einfügen**, Namen vergeben, „Speichern & aktivieren“.
- Eigene Themes erscheinen als Kacheln in der Galerie und im Profil-Dropdown, mit **Bearbeiten** und **Löschen**.

Technik:

- Gespeichert pro Benutzer in der Tabelle `user_themes` (API `GET/POST /themes`, `DELETE /themes/{id}`, max. 200 KB), also im Daten-Volume und auf allen Geräten verfügbar.
- Aktiv gesetzt wird ein eigenes Theme als `custom:<id>`. [`theme.ts`](../frontend/src/lib/theme.ts) setzt das CSS live als `<style id="mindsift-custom-theme">` ans Ende von `<head>` (gewinnt damit gegen die eingebauten Themes) und übernimmt den Wert aus dem Selektor `[data-theme="…"]` des CSS für `<html data-theme>`. Ohne solchen Selektor gilt das CSS für `:root`. Kommentare werden dabei ignoriert.
- Ob die Tailwind-Klasse `dark` gesetzt wird, entscheidet die Helligkeit von `--bg-app`.
- Das CSS des aktiven Themes liegt zusätzlich im `localStorage`, damit es beim Start sofort greift; nach dem Login wird es mit dem Server abgeglichen. Wird es gelöscht, fällt die Ansicht auf „Dark“ zurück.

### Eingebautes Theme (mit Rebuild)

Um ein neues Theme (z.B. „Nordic Blue" oder „Cyberpunk") fest in MindSift einzubauen:
1. Kopiere `frontend/src/themes/theme-template.css` nach `frontend/src/themes/theme-meintheme.css`.
2. Ändere den Selektor `:root[data-theme="template"]` in `:root[data-theme="meintheme"]`.
3. Passe Farben und Rundungen nach Belieben an.
4. Importiere die CSS-Datei in [`frontend/src/lib/theme.ts`](../frontend/src/lib/theme.ts) und trage das Theme im `AVAILABLE_THEMES`-Array ein.
5. Das neue Theme steht sofort in den Kontoeinstellungen und im Profil-Dropdown zur Verfügung!
