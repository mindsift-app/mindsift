import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Moon, Sun } from 'lucide-react';
import { AVAILABLE_THEMES, THEME_FAMILIES, showThemeOnPage, systemIsDark } from '../../lib/theme';

// The visitor's choice on public note pages, kept apart from their own MindSift theme
const STORAGE_KEY = 'mindsift_public_theme';

interface Choice {
  family: string;
  // '' follows the system
  mode: '' | 'light' | 'dark';
}

function loadChoice(): Choice {
  try {
    const c = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      family: THEME_FAMILIES.some((f) => f.id === c.family) ? c.family : THEME_FAMILIES[0].id,
      mode: c.mode === 'light' || c.mode === 'dark' ? c.mode : '',
    };
  } catch {
    return { family: THEME_FAMILIES[0].id, mode: '' };
  }
}

const accentOf = (familyId: string, dark: boolean) => {
  const f = THEME_FAMILIES.find((x) => x.id === familyId) || THEME_FAMILIES[0];
  return AVAILABLE_THEMES.find((t) => t.id === (dark ? f.dark : f.light))?.previewAccent;
};

/** Top right of a public note: a coloured dot that opens the theme families, and a day/night switch.
 *  Starts with the default theme in the system's light or dark. */
export const PublicThemePicker: React.FC = () => {
  const { t } = useTranslation('public');
  const [choice, setChoice] = useState<Choice>(loadChoice);
  const [systemDark, setSystemDark] = useState(systemIsDark);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const dark = choice.mode ? choice.mode === 'dark' : systemDark;

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    showThemeOnPage(choice.family, dark);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
    } catch {
      // private mode: the choice lasts for this page
    }
  }, [choice, dark]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const dot = (familyId: string) => (
    <span className="block w-4 h-4 rounded-full ring-2 ring-border" style={{ background: accentOf(familyId, dark) }} />
  );

  return (
    <div ref={ref} className="fixed top-3 right-3 z-30 flex items-center gap-1.5">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title={t('theme.pick')}
          aria-label={t('theme.pick')}
          className="btn-icon w-11 h-11 sm:w-8 sm:h-8 bg-panel/80 backdrop-blur-sm"
        >
          {dot(choice.family)}
        </button>
        {open && (
          <div className="absolute right-0 top-full mt-1.5 p-1 rounded-card bg-panel border border-border shadow-panel flex flex-col gap-0.5">
            {THEME_FAMILIES.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setChoice((c) => ({ ...c, family: f.id }));
                  setOpen(false);
                }}
                title={f.name}
                aria-label={f.name}
                aria-pressed={f.id === choice.family}
                className={`flex items-center justify-center w-11 h-11 sm:w-8 sm:h-8 rounded-btn hover:bg-panel-elevated ${
                  f.id === choice.family ? 'bg-panel-elevated' : ''
                }`}
              >
                {dot(f.id)}
              </button>
            ))}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setChoice((c) => ({ ...c, mode: dark ? 'light' : 'dark' }))}
        title={dark ? t('theme.light') : t('theme.dark')}
        aria-label={dark ? t('theme.light') : t('theme.dark')}
        className="btn-icon w-11 h-11 sm:w-8 sm:h-8 bg-panel/80 backdrop-blur-sm"
      >
        {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
    </div>
  );
};
