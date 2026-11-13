import React, { useRef, useState } from 'react';
import i18n from '../../../i18n';
import { UserTheme } from '../../../lib/types';
import { api } from '../../../lib/api';
import {
  ButtonBorders,
  CornerStyle,
  customThemeId,
  getAccentColor,
  getButtonBorders,
  getCornerStyle,
  getFollowSystem,
  ThemeId,
} from '../../../lib/theme';
import { useLinkPreviewsEnabled } from '../../../lib/linkPreview';
import { isJournalEnabled } from '../../../lib/journal';
import themeTemplateCss from '../../../themes/theme-template.css?raw';
import { errorMessage } from '../../../lib/errorMessage';

// Kontoeinstellungen → Darstellung & Themes: the device settings (corners, accent, borders, system theme,
// link previews, journal) and the editor for own themes. Lives in the view, so an unsaved theme survives
// switching sections.
export function useAppearanceSettings(
  activeTheme: ThemeId,
  customThemes: UserTheme[],
  onCustomThemesChange: (themes: UserTheme[], activate?: ThemeId) => void
) {
  const linkPreviewsOn = useLinkPreviewsEnabled();
  const [journalOn, setJournalOn] = useState(isJournalEnabled);
  const [corners, setCorners] = useState<CornerStyle>(getCornerStyle);
  const [followSystem, setFollowSystemState] = useState(getFollowSystem);
  const [buttonBorders, setButtonBordersState] = useState<ButtonBorders>(getButtonBorders);
  const [accent, setAccent] = useState<string | null>(getAccentColor);

  // --- Custom Theme Editor State ---
  const [themeEditId, setThemeEditId] = useState<string | null>(null); // null = new theme
  const [themeName, setThemeName] = useState('');
  const [themeCss, setThemeCss] = useState('');
  const [themeMsg, setThemeMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [savingTheme, setSavingTheme] = useState(false);
  const [deletingThemeId, setDeletingThemeId] = useState<string | null>(null);
  const themeFileRef = useRef<HTMLInputElement>(null);

  const resetThemeEditor = () => {
    setThemeEditId(null);
    setThemeName('');
    setThemeCss('');
  };

  const handleThemeFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    setThemeCss(text);
    if (!themeName.trim()) setThemeName(file.name.replace(/\.css$/i, '').replace(/^theme-/, ''));
    setThemeMsg(null);
  };

  const handleDownloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([themeTemplateCss], { type: 'text/css' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'theme-template.css';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCopyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(themeTemplateCss);
      setThemeMsg({ type: 'ok', text: i18n.t('settings:appearance.custom.copied') });
    } catch {
      setThemeMsg({ type: 'err', text: i18n.t('settings:appearance.custom.copyFailed') });
    }
  };

  // Saving activates the theme right away (injected live, no reload)
  const handleSaveTheme = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTheme(true);
    setThemeMsg(null);
    try {
      const saved = await api.saveTheme({ id: themeEditId || undefined, name: themeName.trim(), css: themeCss });
      const next = themeEditId
        ? customThemes.map((t) => (t.id === saved.id ? saved : t))
        : [...customThemes, saved];
      onCustomThemesChange(next, customThemeId(saved));
      setThemeMsg({ type: 'ok', text: i18n.t('settings:appearanceExtra.themeSaved', { name: saved.name }) });
      resetThemeEditor();
    } catch (err) {
      setThemeMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:appearance.custom.saveFailed')) });
    } finally {
      setSavingTheme(false);
    }
  };

  const handleEditTheme = (t: UserTheme) => {
    setThemeEditId(t.id);
    setThemeName(t.name);
    setThemeCss(t.css);
    setThemeMsg(null);
  };

  const handleDeleteTheme = async (t: UserTheme) => {
    try {
      await api.deleteTheme(t.id);
      setDeletingThemeId(null);
      if (themeEditId === t.id) resetThemeEditor();
      // Deleting the active theme falls back to the default one
      onCustomThemesChange(
        customThemes.filter((x) => x.id !== t.id),
        activeTheme === customThemeId(t) ? 'dark' : undefined
      );
    } catch (err) {
      setThemeMsg({ type: 'err', text: errorMessage(err, i18n.t('settings:appearance.custom.deleteFailed')) });
    }
  };

  return {
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
  };
}
