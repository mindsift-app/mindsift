import React from 'react';
import { Copy, Download, Pencil, Trash2, Upload } from 'lucide-react';
import { UserTheme } from '../../../lib/types';
import {
  AVAILABLE_THEMES,
  ButtonBorders,
  CornerStyle,
  customThemeId,
  resolveTheme,
  setAccentColor,
  setButtonBorders,
  setCornerStyle,
  setFollowSystem,
  THEME_FAMILIES,
  ThemeId,
  ThemeOption,
} from '../../../lib/theme';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { setLinkPreviewsEnabled } from '../../../lib/linkPreview';
import { setJournalEnabled } from '../../../lib/journal';
import themeTemplateCss from '../../../themes/theme-template.css?raw';
import { useAppearanceSettings } from './useAppearanceSettings';

// Kontoeinstellungen → Darstellung & Themes (state in useAppearanceSettings)
export function AppearanceSection({
  appearance,
  activeTheme,
  themes,
  customThemes,
  onThemeChange,
}: {
  appearance: ReturnType<typeof useAppearanceSettings>;
  activeTheme: ThemeId;
  themes: ThemeOption[];
  customThemes: UserTheme[];
  onThemeChange: (themeId: ThemeId) => void;
}) {
  const {
    linkPreviewsOn,
    journalOn,
    setJournalOn,
    corners,
    setCorners,
    followSystem,
    setFollowSystemState,
    buttonBorders,
    setButtonBordersState,
    accent,
    setAccent,
    themeEditId,
    themeName,
    setThemeName,
    themeCss,
    setThemeCss,
    themeMsg,
    savingTheme,
    deletingThemeId,
    setDeletingThemeId,
    themeFileRef,
    resetThemeEditor,
    handleThemeFile,
    handleDownloadTemplate,
    handleCopyTemplate,
    handleSaveTheme,
    handleEditTheme,
    handleDeleteTheme,
  } = appearance;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">
          Darstellung & Single-File CSS Themes
        </h2>
        <p className="text-muted mt-0.5">
          Jedes Theme ist eine einzige, eigenständige CSS-Datei, in der alle Farben,
          Oberflächen, Kontraste und Ecken-Rundungen in 6 festen Gruppen gebündelt sind.
        </p>
      </div>

      <div className="p-3.5 rounded-card border border-border bg-canvas flex items-center justify-between gap-4">
        <div className="text-xs">
          <p className="font-semibold text-main">Link-Vorschauen anzeigen</p>
          <p className="text-[11px] text-faint">
            Karte mit Titel, Beschreibung und kleinem Bild über Punkten mit einer Web-Adresse. Die Seite wird
            dafür vom MindSift-Server abgerufen, nicht von deinem Browser. Gilt für dieses Gerät; einzelne
            Vorschauen lassen sich mit ✕ ausblenden.
          </p>
        </div>
        <ToggleSwitch checked={linkPreviewsOn} onChange={setLinkPreviewsEnabled} title="Link-Vorschauen anzeigen" />
      </div>

      <div className="p-3.5 rounded-card border border-border bg-canvas flex items-center justify-between gap-4">
        <div className="text-xs">
          <p className="font-semibold text-main">Journal anzeigen</p>
          <p className="text-[11px] text-faint">
            Eine Notiz pro Tag, untereinander mit Kalender – ganz oben in der Notizen-Seitenleiste. Ausschalten
            blendet es nur aus, die Tage bleiben als Notizen erhalten. Gilt für dieses Gerät.
          </p>
        </div>
        <ToggleSwitch
          checked={journalOn}
          onChange={(v) => {
            setJournalEnabled(v);
            setJournalOn(v);
          }}
          title="Journal anzeigen"
        />
      </div>

      {/* Colour families: left light, right dark */}
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_minmax(0,9rem)_minmax(0,9rem)] sm:grid-cols-[1fr_12rem_12rem] items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
          <span>Theme</span>
          <span className="text-center">Hell</span>
          <span className="text-center">Dunkel</span>
        </div>
        {THEME_FAMILIES.map((f) => (
          <div
            key={f.id}
            className="grid grid-cols-[1fr_minmax(0,9rem)_minmax(0,9rem)] sm:grid-cols-[1fr_12rem_12rem] items-center gap-2 p-2 rounded-card bg-canvas"
          >
            <div className="min-w-0 px-1">
              <p className="font-semibold text-main text-sm truncate">{f.name}</p>
              <p className="text-[11px] text-muted truncate">{f.subtitle}</p>
            </div>
            {[f.light, f.dark].map((id) => {
              const t = AVAILABLE_THEMES.find((x) => x.id === id)!;
              const selected = activeTheme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onThemeChange(resolveTheme(id))}
                  aria-pressed={selected}
                  title={t.name}
                  className={`h-14 rounded-card p-2 flex flex-col justify-between text-left transition-all cursor-pointer ${
                    selected ? 'ring-2 ring-accent' : 'hover:scale-[1.02]'
                  }`}
                  style={{ backgroundColor: t.previewBg, border: '1px solid rgba(127,127,127,0.25)' }}
                >
                  <span className="flex items-center gap-1">
                    <span className="w-6 h-2.5 rounded-full" style={{ backgroundColor: t.previewPanel }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.previewAccent }} />
                  </span>
                  <span className="text-[11px] font-semibold truncate" style={{ color: t.previewText }}>
                    {selected ? '✓ Aktiv' : t.mode === 'light' ? 'Hell' : 'Dunkel'}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Corners for every theme (per device) */}
      <div className="p-3.5 rounded-card border border-border bg-canvas flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs">
          <p className="font-semibold text-main">Ecken</p>
          <p className="text-[11px] text-faint">Abgerundet oder eckig – unabhängig vom Theme. Gilt für dieses Gerät.</p>
        </div>
        <div className="flex items-center bg-panel-elevated rounded-btn p-0.5 text-xs" role="radiogroup" aria-label="Ecken">
          {(
            [
              ['theme', 'Wie Theme'],
              ['round', 'Rund'],
              ['square', 'Eckig'],
            ] as [CornerStyle, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={corners === value}
              onClick={() => {
                setCornerStyle(value);
                setCorners(value);
              }}
              className={`h-9 sm:h-7 px-3 rounded-btn transition-colors cursor-pointer ${
                corners === value ? 'bg-panel text-main font-semibold shadow-sm' : 'text-muted hover:text-main'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Light/dark: fixed, or following the system inside the family */}
      <div className="p-3.5 rounded-card border border-border bg-canvas flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs">
          <p className="font-semibold text-main">Hell oder dunkel</p>
          <p className="text-[11px] text-faint">„Wie System“ wechselt innerhalb der Farbfamilie mit dem Hell-/Dunkelmodus des Geräts.</p>
        </div>
        <div className="flex items-center bg-panel-elevated rounded-btn p-0.5 text-xs" role="radiogroup" aria-label="Hell oder dunkel">
          {(
            [
              [false, 'Selbst wählen'],
              [true, 'Wie System'],
            ] as [boolean, string][]
          ).map(([value, label]) => (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={followSystem === value}
              onClick={() => {
                setFollowSystem(value);
                setFollowSystemState(value);
                if (value) onThemeChange(resolveTheme(activeTheme));
              }}
              className={`h-9 sm:h-7 px-3 rounded-btn transition-colors cursor-pointer ${
                followSystem === value ? 'bg-panel text-main font-semibold shadow-sm' : 'text-muted hover:text-main'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Frames around buttons */}
      <div className="p-3.5 rounded-card border border-border bg-canvas flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs">
          <p className="font-semibold text-main">Rahmen an Knöpfen</p>
          <p className="text-[11px] text-faint">Ohne Rahmen sind Knöpfe nur leicht hinterlegt. Gilt für dieses Gerät.</p>
        </div>
        <div className="flex items-center bg-panel-elevated rounded-btn p-0.5 text-xs" role="radiogroup" aria-label="Rahmen an Knöpfen">
          {(
            [
              ['on', 'Mit Rahmen'],
              ['off', 'Ohne Rahmen'],
            ] as [ButtonBorders, string][]
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={buttonBorders === value}
              onClick={() => {
                setButtonBorders(value);
                setButtonBordersState(value);
              }}
              className={`h-9 sm:h-7 px-3 rounded-btn transition-colors cursor-pointer ${
                buttonBorders === value ? 'bg-panel text-main font-semibold shadow-sm' : 'text-muted hover:text-main'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Own accent colour on top of the theme */}
      <div className="p-3.5 rounded-card border border-border bg-canvas space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <div>
            <p className="font-semibold text-main">Akzentfarbe</p>
            <p className="text-[11px] text-faint">Ersetzt die Akzentfarbe des Themes (Knöpfe, Links, Markierungen). Gilt für dieses Gerät.</p>
          </div>
          {accent && (
            <button
              type="button"
              onClick={() => {
                setAccentColor(null);
                setAccent(null);
              }}
              className="btn-action h-9 sm:h-7 px-2.5 text-xs"
            >
              Wie Theme
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {['#2563eb', '#0f766e', '#16a34a', '#ca8a04', '#c2410c', '#dc2626', '#db2777', '#8e44c9', '#475569'].map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setAccentColor(c);
                setAccent(c);
              }}
              title={c}
              aria-label={`Akzentfarbe ${c}`}
              className={`w-9 h-9 sm:w-7 sm:h-7 rounded-full transition-transform hover:scale-110 cursor-pointer ${
                accent === c ? 'ring-2 ring-offset-2 ring-offset-canvas ring-main' : ''
              }`}
              style={{ backgroundColor: c }}
            />
          ))}
          <label className="flex items-center gap-1.5 text-[11px] text-muted cursor-pointer">
            <input
              type="color"
              value={accent || '#2563eb'}
              onChange={(e) => {
                setAccentColor(e.target.value);
                setAccent(e.target.value);
              }}
              className="w-9 h-9 sm:w-7 sm:h-7 rounded-full border border-border bg-transparent p-0 cursor-pointer"
              aria-label="Eigene Akzentfarbe wählen"
            />
            Eigene
          </label>
        </div>
      </div>

      {themes.some((t) => t.isCustom) && <p className="font-semibold text-main text-sm pt-1">Eigene Themes</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {themes.filter((t) => t.isCustom).map((t) => {
          const isSelected = activeTheme === t.id;
          const custom = customThemes.find((c) => customThemeId(c) === t.id);
          return (
            <div key={t.id} className="flex flex-col">
            <button
              type="button"
              onClick={() => onThemeChange(t.id)}
              className={`flex-1 p-4 text-left border transition-all flex flex-col justify-between gap-3 ${
                isSelected
                  ? 'bg-canvas border-accent shadow-sm'
                  : 'bg-canvas border-border hover:border-strong'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-sm text-main flex items-center gap-2">
                    <span>{t.name}</span>
                    {isSelected && <span className="badge-accent">Aktiv</span>}
                  </p>
                  <p className="text-xs text-muted mt-0.5">{t.subtitle}</p>
                </div>
              </div>

              {/* Mini Color & Geometry Swatch */}
              <div className="flex items-center justify-between pt-2 border-t border-border">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-5 h-5 border border-strong inline-block"
                    style={{
                      backgroundColor: t.previewBg,
                      borderRadius: t.isRounded ? '6px' : '0px' }}
                    title="Canvas-Hintergrund"
                  />
                  <span
                    className="w-5 h-5 border border-strong inline-block"
                    style={{
                      backgroundColor: t.previewPanel,
                      borderRadius: t.isRounded ? '6px' : '0px' }}
                    title="Panel-Oberfläche"
                  />
                  <span
                    className="w-5 h-5 border border-strong inline-block"
                    style={{
                      backgroundColor: t.previewAccent,
                      borderRadius: t.isRounded ? '6px' : '0px' }}
                    title="Akzentfarbe"
                  />
                  <span
                    className="w-5 h-5 border border-strong inline-block"
                    style={{
                      backgroundColor: t.previewText,
                      borderRadius: t.isRounded ? '6px' : '0px' }}
                    title="Textfarbe"
                  />
                </div>

                <code className="text-[10px] font-mono text-faint">{t.file}</code>
              </div>
            </button>
            {custom && (
              <div className="flex items-center justify-end gap-1.5 px-2 py-1.5 border border-t-0 border-border bg-canvas">
                {deletingThemeId === custom.id ? (
                  <>
                    <span className="flex-1 text-[11px] text-muted">Theme wirklich löschen?</span>
                    <button onClick={() => handleDeleteTheme(custom)} className="btn-primary h-7 px-2.5 text-[11px]">
                      Löschen
                    </button>
                    <button onClick={() => setDeletingThemeId(null)} className="btn-action h-7 px-2 text-[11px]">
                      Abbrechen
                    </button>
                  </>
                ) : (
                  <>
                    <button onClick={() => handleEditTheme(custom)} className="btn-icon" title="Theme bearbeiten">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeletingThemeId(custom.id)}
                      className="btn-icon btn-icon-danger"
                      title="Theme löschen"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            )}
            </div>
          );
        })}
      </div>

      {/* Custom theme: upload or paste CSS, based on the template */}
      <form onSubmit={handleSaveTheme} className="p-4 bg-canvas border border-border space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-main">
            {themeEditId ? 'Eigenes Theme bearbeiten' : 'Eigenes Theme hinzufügen'}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={handleDownloadTemplate} className="btn-action h-7 px-2 text-[11px] flex items-center gap-1">
              <Download className="w-3 h-3" />
              <span>Vorlage herunterladen</span>
            </button>
            <button type="button" onClick={handleCopyTemplate} className="btn-action h-7 px-2 text-[11px] flex items-center gap-1">
              <Copy className="w-3 h-3" />
              <span>Vorlage kopieren</span>
            </button>
            <button
              type="button"
              onClick={() => setThemeCss(themeTemplateCss)}
              className="btn-action h-7 px-2 text-[11px]"
            >
              Vorlage einfügen
            </button>
          </div>
        </div>

        <p className="text-muted text-[11px] leading-relaxed">
          Ein Theme ist CSS mit 6 Blöcken: <strong>1. Akzentfarbe</strong>, <strong>2. Oberflächen</strong>,{' '}
          <strong>3. Textfarben</strong>, <strong>4. Rahmen &amp; Schatten</strong>, <strong>5. Statusfarben</strong> und{' '}
          <strong>6. Rundungen</strong>. Am einfachsten startest du mit der Vorlage und änderst die Werte. Gespeicherte
          Themes liegen auf dem Server und stehen dir auf allen Geräten zur Verfügung.
        </p>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={themeName}
            onChange={(e) => setThemeName(e.target.value)}
            placeholder="Name, z. B. Wald"
            maxLength={60}
            className="flex-1 min-w-0 h-8 px-2.5 input-field"
          />
          <button
            type="button"
            onClick={() => themeFileRef.current?.click()}
            className="btn-action h-8 px-3 text-xs flex items-center justify-center gap-1.5"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>CSS-Datei hochladen</span>
          </button>
          <input
            ref={themeFileRef}
            type="file"
            accept=".css,text/css"
            className="hidden"
            onChange={(e) => {
              handleThemeFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>

        <textarea
          value={themeCss}
          onChange={(e) => setThemeCss(e.target.value)}
          placeholder=":root[data-theme=&quot;mein-theme&quot;] { --accent-primary: #15803d; … }"
          rows={10}
          spellCheck={false}
          className="w-full px-2.5 py-2 input-field font-mono text-[11px] leading-relaxed resize-y"
        />

        {themeMsg && (
          <p className={`text-[11px] ${themeMsg.type === 'ok' ? 'text-status-ok' : 'text-status-err'}`}>
            {themeMsg.text}
          </p>
        )}

        <div className="flex justify-end gap-2">
          {themeEditId && (
            <button type="button" onClick={resetThemeEditor} className="btn-action h-8 px-3 text-xs">
              Abbrechen
            </button>
          )}
          <button
            type="submit"
            disabled={savingTheme || !themeName.trim() || !themeCss.trim()}
            className="btn-primary h-8 px-4 text-xs font-semibold disabled:opacity-50"
          >
            {savingTheme ? 'Speichere…' : 'Speichern & aktivieren'}
          </button>
        </div>
      </form>
    </div>
  );
}
