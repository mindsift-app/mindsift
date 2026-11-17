import { useRef, useState } from 'react';
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
import { downloadThemeCss, resetThemeColor, setThemeColor, ThemeColorVar, themeNameFromFile } from '../../../lib/themeCss';
import { errorMessage } from '../../../lib/errorMessage';
import { useLatestRef } from '../../../lib/useLatestRef';

// Kontoeinstellungen → Darstellung & Themes: the device settings (corners, accent, borders, system theme,
// link previews, journal) and the own themes. Lives in the view, so a pending colour save survives
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

  // --- Own themes: one row each (name, colour tiles, export, delete), "+" adds one from the template ---
  const [themeMsg, setThemeMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [addingTheme, setAddingTheme] = useState(false);
  const themeFileRef = useRef<HTMLInputElement>(null);
  // The latest list, also between two renders (a colour picker fires many changes in a row)
  const themesRef = useLatestRef(customThemes);
  // Colour changes are saved once the picker rests; the timer reads the theme as it is by then
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const fail = (err: unknown, key: 'saveFailed' | 'deleteFailed') =>
    setThemeMsg({ type: 'err', text: errorMessage(err, i18n.t(`settings:appearance.custom.${key}`)) });

  const updateLocal = (theme: UserTheme) => {
    const next = themesRef.current.map((t) => (t.id === theme.id ? theme : t));
    themesRef.current = next;
    onCustomThemesChange(next);
  };

  // A new theme (from the template or an imported file) is saved and used right away
  const createTheme = async (name: string, css: string) => {
    setThemeMsg(null);
    try {
      const saved = await api.saveTheme({ name: name.trim(), css });
      const next = [...themesRef.current, saved];
      themesRef.current = next;
      onCustomThemesChange(next, customThemeId(saved));
      return true;
    } catch (err) {
      fail(err, 'saveFailed');
      return false;
    }
  };

  const handleCreateTheme = async (name: string) => {
    if (!name.trim()) {
      setAddingTheme(false);
      return;
    }
    if (await createTheme(name, themeTemplateCss)) setAddingTheme(false);
  };

  const handleThemeFile = async (file?: File) => {
    if (!file) return;
    const css = await file.text();
    const name = themeNameFromFile(file.name) || i18n.t('settings:appearance.custom.unnamed');
    if (await createTheme(name, css)) setThemeMsg({ type: 'ok', text: i18n.t('settings:appearanceExtra.themeImported', { name }) });
  };

  const handleRenameTheme = async (theme: UserTheme, name: string) => {
    const current = themesRef.current.find((t) => t.id === theme.id) ?? theme;
    if (!name.trim() || name.trim() === current.name) return;
    const renamed = { ...current, name: name.trim() };
    updateLocal(renamed);
    setThemeMsg(null);
    try {
      await api.saveTheme({ id: renamed.id, name: renamed.name, css: renamed.css });
    } catch (err) {
      updateLocal(current);
      fail(err, 'saveFailed');
    }
  };

  // Applies live (App re-injects the CSS of the active theme) and saves a moment later
  const changeThemeCss = (theme: UserTheme, change: (css: string) => string) => {
    const current = themesRef.current.find((t) => t.id === theme.id) ?? theme;
    updateLocal({ ...current, css: change(current.css) });
    const timers = saveTimers.current;
    clearTimeout(timers.get(theme.id));
    timers.set(
      theme.id,
      setTimeout(() => {
        timers.delete(theme.id);
        const latest = themesRef.current.find((t) => t.id === theme.id);
        if (latest) api.saveTheme({ id: latest.id, name: latest.name, css: latest.css }).catch((err) => fail(err, 'saveFailed'));
      }, 600)
    );
  };

  const handleThemeColor = (theme: UserTheme, name: ThemeColorVar, hex: string) =>
    changeThemeCss(theme, (css) => setThemeColor(css, name, hex));

  // A secondary colour follows the main ones again
  const handleResetThemeColor = (theme: UserTheme, name: ThemeColorVar) => changeThemeCss(theme, (css) => resetThemeColor(css, name));

  const handleExportTheme = (theme: UserTheme) => downloadThemeCss(theme.name, theme.css);

  // Unchanged file name theme-template.css
  const handleDownloadTemplate = () => downloadThemeCss('template', themeTemplateCss);

  const handleCopyTemplate = async () => {
    try {
      await navigator.clipboard.writeText(themeTemplateCss);
      setThemeMsg({ type: 'ok', text: i18n.t('settings:appearance.custom.copied') });
    } catch {
      setThemeMsg({ type: 'err', text: i18n.t('settings:appearance.custom.copyFailed') });
    }
  };

  // Asked before (ConfirmPopover in the row): a deleted theme cannot be brought back
  const handleDeleteTheme = async (t: UserTheme) => {
    clearTimeout(saveTimers.current.get(t.id));
    saveTimers.current.delete(t.id);
    try {
      await api.deleteTheme(t.id);
      const next = themesRef.current.filter((x) => x.id !== t.id);
      themesRef.current = next;
      // Deleting the active theme falls back to the default one
      onCustomThemesChange(next, activeTheme === customThemeId(t) ? 'dark' : undefined);
    } catch (err) {
      fail(err, 'deleteFailed');
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
    themeMsg,
    addingTheme,
    setAddingTheme,
    themeFileRef,
    handleCreateTheme,
    handleThemeFile,
    handleRenameTheme,
    handleThemeColor,
    handleResetThemeColor,
    handleExportTheme,
    handleDownloadTemplate,
    handleCopyTemplate,
    handleDeleteTheme,
  };
}
