import { useTranslation } from 'react-i18next';
import { UserTheme } from '../../../lib/types';
import {
  AVAILABLE_THEMES,
  ButtonBorders,
  CornerStyle,
  resolveTheme,
  setAccentColor,
  setButtonBorders,
  setCornerStyle,
  setFollowSystem,
  THEME_FAMILIES,
  ThemeId,
} from '../../../lib/theme';
import { ToggleSwitch } from '../../../components/ToggleSwitch';
import { setLinkPreviewsEnabled, useServerLinkPreviews } from '../../../lib/linkPreview';
import { setJournalEnabled } from '../../../lib/journal';
import { useAppearanceSettings } from './useAppearanceSettings';
import { CustomThemesSection } from './CustomThemesSection';
import { SettingRow, SettingsCard } from '../../../components/SettingsCard';

// Kontoeinstellungen → Darstellung & Themes (state in useAppearanceSettings)
export function AppearanceSection({
  appearance,
  activeTheme,
  customThemes,
  onThemeChange,
}: {
  appearance: ReturnType<typeof useAppearanceSettings>;
  activeTheme: ThemeId;
  customThemes: UserTheme[];
  onThemeChange: (themeId: ThemeId) => void;
}) {
  const { t } = useTranslation('settings');
  const serverPreviews = useServerLinkPreviews();
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
  } = appearance;
  return (
    <div className="space-y-5">
      <div className="border-b border-border pb-3">
        <h2 className="text-sm font-bold text-main">
          {t('appearance.title')}
        </h2>
      </div>

      {/* Only while the server offers link previews at all (the administration can switch them off) */}
      {serverPreviews && (
        <SettingRow
          data-device-link-previews
          title={t('appearance.linkPreviews')}
          hint={t('appearance.linkPreviewsHint')}
        >
          <ToggleSwitch checked={linkPreviewsOn} onChange={setLinkPreviewsEnabled} title={t('appearance.linkPreviews')} />
        </SettingRow>
      )}

      <SettingRow
        title={t('appearance.journal')}
        hint={t('appearance.journalHint')}
      >
        <ToggleSwitch
          checked={journalOn}
          onChange={(v) => {
            setJournalEnabled(v);
            setJournalOn(v);
          }}
          title={t('appearance.journal')}
        />
      </SettingRow>

      {/* Colour families: left light, right dark */}
      <div className="space-y-2">
        <div className="grid grid-cols-[1fr_minmax(0,9rem)_minmax(0,9rem)] sm:grid-cols-[1fr_12rem_12rem] items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-faint">
          <span>{t('appearance.theme')}</span>
          <span className="text-center">{t('appearance.light')}</span>
          <span className="text-center">{t('appearance.dark')}</span>
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
              const th = AVAILABLE_THEMES.find((x) => x.id === id)!;
              const selected = activeTheme === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onThemeChange(resolveTheme(id))}
                  aria-pressed={selected}
                  title={th.name}
                  className={`h-14 rounded-card p-2 flex flex-col justify-between text-left transition-all cursor-pointer ${
                    selected ? 'ring-2 ring-accent' : 'hover:scale-[1.02]'
                  }`}
                  style={{ backgroundColor: th.previewBg, border: '1px solid rgba(127,127,127,0.25)' }}
                >
                  <span className="flex items-center gap-1">
                    <span className="w-6 h-2.5 rounded-full" style={{ backgroundColor: th.previewPanel }} />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: th.previewAccent }} />
                  </span>
                  <span className="text-[11px] font-semibold truncate" style={{ color: th.previewText }}>
                    {selected ? `✓ ${t('appearance.active')}` : th.mode === 'light' ? t('appearance.light') : t('appearance.dark')}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* Corners for every theme (per device) */}
      <SettingRow
        title={t('appearance.corners')}
        hint={t('appearance.cornersHint')}
      >
        <div className="flex items-center bg-panel-elevated rounded-btn p-0.5 text-xs" role="radiogroup" aria-label={t('appearance.corners')}>
          {(
            [
              ['theme', t('appearance.likeTheme')],
              ['round', t('appearance.round')],
              ['square', t('appearance.square')],
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
              className={`h-11 sm:h-7 px-3 rounded-btn transition-colors cursor-pointer ${
                corners === value ? 'bg-panel text-main font-semibold shadow-xs' : 'text-muted hover:text-main'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </SettingRow>

      {/* Light/dark: fixed, or following the system inside the family */}
      <SettingRow
        title={t('appearance.mode')}
        hint={t('appearance.modeHint')}
      >
        <div className="flex items-center bg-panel-elevated rounded-btn p-0.5 text-xs" role="radiogroup" aria-label={t('appearance.mode')}>
          {(
            [
              [false, t('appearance.modeManual')],
              [true, t('appearance.modeSystem')],
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
              className={`h-11 sm:h-7 px-3 rounded-btn transition-colors cursor-pointer ${
                followSystem === value ? 'bg-panel text-main font-semibold shadow-xs' : 'text-muted hover:text-main'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </SettingRow>

      {/* Frames around buttons */}
      <SettingRow
        title={t('appearance.borders')}
        hint={t('appearance.bordersHint')}
      >
        <div className="flex items-center bg-panel-elevated rounded-btn p-0.5 text-xs" role="radiogroup" aria-label={t('appearance.borders')}>
          {(
            [
              ['on', t('appearance.bordersOn')],
              ['off', t('appearance.bordersOff')],
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
              className={`h-11 sm:h-7 px-3 rounded-btn transition-colors cursor-pointer ${
                buttonBorders === value ? 'bg-panel text-main font-semibold shadow-xs' : 'text-muted hover:text-main'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </SettingRow>

      {/* Own accent colour on top of the theme */}
      <SettingsCard
        title={t('appearance.accent')}
        hint={t('appearance.accentHint')}
        action={
          accent && (
            <button
              type="button"
              onClick={() => {
                setAccentColor(null);
                setAccent(null);
              }}
              className="btn-action h-11 sm:h-7 px-2.5 text-xs"
            >
              {t('appearance.likeTheme')}
            </button>
          )
        }
      >
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
              aria-label={t('appearanceExtra.accentColor', { color: c })}
              className={`w-11 h-11 sm:w-7 sm:h-7 rounded-full transition-transform hover:scale-110 cursor-pointer ${
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
              className="w-11 h-11 sm:w-7 sm:h-7 rounded-full border border-border bg-transparent p-0 cursor-pointer"
              aria-label={t('appearance.accentPick')}
            />
            {t('settings:appearance.customAccent')}
          </label>
        </div>
      </SettingsCard>

      <CustomThemesSection appearance={appearance} activeTheme={activeTheme} customThemes={customThemes} onThemeChange={onThemeChange} />
    </div>
  );
}
