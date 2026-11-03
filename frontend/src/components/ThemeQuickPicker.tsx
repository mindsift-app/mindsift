import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Monitor, Moon, Sun } from 'lucide-react';
import {
  AVAILABLE_THEMES,
  getFollowSystem,
  resolveTheme,
  setFollowSystem,
  THEME_FAMILIES,
  ThemeId,
  ThemeOption,
} from '../lib/theme';

interface ThemeQuickPickerProps {
  activeTheme: ThemeId;
  /** All themes including the user's own (shown as small chips) */
  themes: ThemeOption[];
  onChange: (id: ThemeId) => void;
  /** Bigger touch targets in the phone sheet */
  touch?: boolean;
}

// Compact switcher for the user menu: one dot per colour family plus light/dark; own themes below
export const ThemeQuickPicker: React.FC<ThemeQuickPickerProps> = ({ activeTheme, themes, onChange, touch = false }) => {
  const { t } = useTranslation();
  const active = AVAILABLE_THEMES.find((t) => t.id === activeTheme);
  const mode = active?.mode ?? 'dark';
  const customThemes = themes.filter((t) => t.isCustom);
  const dot = touch ? 'w-9 h-9' : 'w-7 h-7';
  // Kept in state: choosing "System" may not change the theme, but the selection must still show
  const [followSystem, setFollow] = useState(getFollowSystem);
  const pick = (id: ThemeId) => onChange(resolveTheme(id));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-1">
        <div className="flex w-full items-center justify-between" role="radiogroup" aria-label={t('theme.family')}>
          {THEME_FAMILIES.map((f) => {
            const preview = AVAILABLE_THEMES.find((t) => t.id === (mode === 'light' ? f.light : f.dark));
            const selected = active?.family === f.id;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => pick(mode === 'light' ? f.light : f.dark)}
                title={f.name}
                className={`${dot} rounded-full flex items-center justify-center transition-transform active:scale-95 cursor-pointer ${
                  selected ? 'ring-2 ring-accent ring-offset-2 ring-offset-panel' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: preview?.previewBg }}
              >
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: preview?.previewAccent }} />
              </button>
            );
          })}
        </div>
      </div>
      {/* Own row: three labelled segments, so it fits narrow menus */}
      <div className="grid grid-cols-3 rounded-full bg-panel-elevated p-0.5" role="radiogroup" aria-label={t('theme.mode')}>
          {(['light', 'dark', 'auto'] as const).map((m) => {
            const family = active?.family ? THEME_FAMILIES.find((f) => f.id === active.family) : undefined;
            const selected = m === 'auto' ? followSystem : !followSystem && !!active && mode === m;
            const disabled = !family;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => {
                  if (!family) return;
                  setFollowSystem(m === 'auto');
                  setFollow(m === 'auto');
                  onChange(m === 'auto' ? resolveTheme(family.dark) : family[m]);
                }}
                title={m === 'light' ? t('theme.light') : m === 'dark' ? t('theme.dark') : t('theme.system')}
                aria-label={m === 'light' ? t('theme.light') : m === 'dark' ? t('theme.dark') : t('theme.system')}
                className={`${touch ? 'h-9' : 'h-7'} rounded-full flex items-center justify-center gap-1 text-[11px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  selected ? 'bg-panel text-accent shadow-sm' : 'text-muted hover:text-main'
                }`}
              >
                {m === 'light' ? (
                  <Sun className="w-3.5 h-3.5" />
                ) : m === 'dark' ? (
                  <Moon className="w-3.5 h-3.5" />
                ) : (
                  <Monitor className="w-3.5 h-3.5" />
                )}
                <span>{m === 'light' ? t('theme.light') : m === 'dark' ? t('theme.dark') : 'System'}</span>
              </button>
            );
          })}
      </div>
      {customThemes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {customThemes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setFollowSystem(false);
                setFollow(false);
                onChange(t.id);
              }}
              className={`h-7 px-2 rounded-full text-[11px] flex items-center gap-1.5 border transition-colors cursor-pointer ${
                activeTheme === t.id ? 'border-accent text-main' : 'border-border text-muted hover:text-main'
              }`}
            >
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: t.previewAccent }} />
              <span className="truncate max-w-[8rem]">{t.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
