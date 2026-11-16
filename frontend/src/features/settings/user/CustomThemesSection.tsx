import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Download, FileDown, Plus, Trash, Upload } from 'lucide-react';
import { UserTheme } from '../../../lib/types';
import { customThemeId, ThemeId } from '../../../lib/theme';
import { readThemeVar, THEME_COLOR_VARS, toHexColor } from '../../../lib/themeCss';
import { ConfirmPopover } from '../../../components/ConfirmPopover';
import { useAppearanceSettings } from './useAppearanceSettings';

type Appearance = ReturnType<typeof useAppearanceSettings>;

// Where a confirmation opens: at the pointer, or below the button when it was triggered by keyboard
function anchorOf(e: React.MouseEvent<HTMLElement>) {
  if (e.clientX || e.clientY) return { x: e.clientX, y: e.clientY };
  const r = e.currentTarget.getBoundingClientRect();
  return { x: r.left, y: r.bottom };
}

// Kontoeinstellungen → Darstellung & Themes → Eigene Themes: one flat row per theme (use, name, colour
// tiles, export, delete), below it the "+" for a new theme from the template, import and the template
export function CustomThemesSection({
  appearance,
  activeTheme,
  customThemes,
  onThemeChange,
}: {
  appearance: Appearance;
  activeTheme: ThemeId;
  customThemes: UserTheme[];
  onThemeChange: (themeId: ThemeId) => void;
}) {
  const { t } = useTranslation('settings');
  const {
    themeMsg,
    addingTheme,
    setAddingTheme,
    themeFileRef,
    handleCreateTheme,
    handleThemeFile,
    handleDownloadTemplate,
    handleCopyTemplate,
    handleDeleteTheme,
  } = appearance;
  const [confirm, setConfirm] = useState<{ theme: UserTheme; x: number; y: number } | null>(null);

  return (
    <div className="space-y-2" data-custom-themes>
      <p className="font-semibold text-main text-sm pt-1">{t('appearance.customThemes')}</p>

      {customThemes.map((theme) => (
        <CustomThemeRow
          key={theme.id}
          theme={theme}
          active={activeTheme === customThemeId(theme)}
          appearance={appearance}
          onUse={() => onThemeChange(customThemeId(theme))}
          onAskDelete={(e) => setConfirm({ theme, ...anchorOf(e) })}
        />
      ))}

      {addingTheme ? (
        <NewThemeRow onCreate={handleCreateTheme} onCancel={() => setAddingTheme(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setAddingTheme(true)}
          aria-label={t('appearance.custom.newTheme')}
          title={t('appearance.custom.newTheme')}
          className="w-full h-11 sm:h-10 flex items-center justify-center rounded-card border-2 border-dashed border-border text-faint hover:text-muted hover:border-strong transition-colors cursor-pointer"
        >
          <Plus className="w-5 h-5" />
        </button>
      )}

      <div className="flex flex-wrap items-center gap-1.5 pt-1">
        <button
          type="button"
          onClick={() => themeFileRef.current?.click()}
          className="btn-action h-11 sm:h-7 px-2.5 text-[11px] flex items-center gap-1"
        >
          <Upload className="w-3 h-3" />
          <span>{t('appearance.custom.import')}</span>
        </button>
        <input
          ref={themeFileRef}
          type="file"
          accept=".css,text/css"
          className="hidden"
          data-theme-import
          onChange={(e) => {
            handleThemeFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <button type="button" onClick={handleDownloadTemplate} className="btn-action h-11 sm:h-7 px-2.5 text-[11px] flex items-center gap-1">
          <Download className="w-3 h-3" />
          <span>{t('appearance.custom.downloadTemplate')}</span>
        </button>
        <button type="button" onClick={handleCopyTemplate} className="btn-action h-11 sm:h-7 px-2.5 text-[11px] flex items-center gap-1">
          <Copy className="w-3 h-3" />
          <span>{t('appearance.custom.copyTemplate')}</span>
        </button>
      </div>
      <p className="text-[11px] text-faint leading-relaxed">{t('appearance.custom.hint')}</p>

      {themeMsg && (
        <p className={`text-[11px] ${themeMsg.type === 'ok' ? 'text-status-ok' : 'text-status-err'}`} role="status">
          {themeMsg.text}
        </p>
      )}

      {confirm && (
        <ConfirmPopover
          x={confirm.x}
          y={confirm.y}
          message={t('appearance.custom.deleteQuestion', { name: confirm.theme.name })}
          confirmLabel={t('appearance.custom.delete')}
          danger
          onConfirm={() => {
            handleDeleteTheme(confirm.theme);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}

function CustomThemeRow({
  theme,
  active,
  appearance,
  onUse,
  onAskDelete,
}: {
  theme: UserTheme;
  active: boolean;
  appearance: Appearance;
  onUse: () => void;
  onAskDelete: (e: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const { t } = useTranslation('settings');
  const { handleRenameTheme, handleThemeColor, handleExportTheme } = appearance;
  // What is being typed; null shows the saved name (also after a rename on another device)
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? theme.name;

  return (
    <div
      className={`p-2 sm:p-3 rounded-card border bg-canvas flex flex-wrap items-center gap-2 sm:gap-3 ${active ? 'border-accent' : 'border-border'}`}
      data-custom-theme={theme.id}
    >
      <button
        type="button"
        onClick={onUse}
        aria-pressed={active}
        title={active ? t('appearance.active') : t('appearance.custom.use')}
        aria-label={active ? t('appearance.active') : t('appearance.custom.use')}
        className={`shrink-0 w-11 h-11 sm:w-7 sm:h-7 rounded-full border flex items-center justify-center cursor-pointer transition-colors ${
          active ? 'bg-accent border-accent text-on-accent' : 'border-strong text-transparent hover:border-accent'
        }`}
      >
        <Check className="w-3.5 h-3.5" />
      </button>

      <input
        type="text"
        value={name}
        maxLength={60}
        aria-label={t('appearance.custom.nameLabel')}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft !== null && draft.trim()) handleRenameTheme(theme, draft);
          setDraft(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            const input = e.currentTarget;
            setDraft(null);
            // Blur after the reset, so the typed name is not saved
            requestAnimationFrame(() => input.blur());
          }
        }}
        className="flex-1 min-w-[8rem] h-11 sm:h-8 px-2 rounded-input border border-transparent bg-transparent text-sm font-semibold text-main hover:border-border focus:border-accent focus:bg-input outline-none"
      />

      <div className="flex flex-wrap items-center gap-1.5">
        {THEME_COLOR_VARS.map((v) => {
          const raw = readThemeVar(theme.css, v);
          const hex = toHexColor(raw);
          const label = t(`appearance.custom.colors.${v}`);
          return (
            <input
              key={v}
              type="color"
              value={hex || '#808080'}
              onChange={(e) => handleThemeColor(theme, v, e.target.value)}
              title={raw ? `${label}: ${raw}` : label}
              aria-label={t('appearance.custom.colorOf', { color: label, name: theme.name })}
              className="w-11 h-11 sm:w-7 sm:h-7 rounded-btn border border-strong bg-transparent p-0 cursor-pointer"
            />
          );
        })}
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        <button
          type="button"
          onClick={() => handleExportTheme(theme)}
          className="btn-icon w-11 h-11 sm:w-7 sm:h-7"
          title={t('appearance.custom.export')}
          aria-label={t('appearance.custom.export')}
        >
          <FileDown className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={onAskDelete}
          className="btn-icon btn-icon-danger w-11 h-11 sm:w-7 sm:h-7"
          title={t('appearance.custom.deleteTitle')}
          aria-label={t('appearance.custom.deleteTitle')}
        >
          <Trash className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// The "+" turned into a name field: Enter or "Anlegen" creates the theme from the template
function NewThemeRow({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
  const { t } = useTranslation('settings');
  const [name, setName] = useState('');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(name);
      }}
      className="p-2 sm:p-3 rounded-card border-2 border-dashed border-border bg-canvas flex flex-wrap items-center gap-2"
    >
      <input
        type="text"
        value={name}
        autoFocus
        maxLength={60}
        aria-label={t('appearance.custom.nameLabel')}
        placeholder={t('appearance.custom.newNamePlaceholder')}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={() => {
          if (!name.trim()) onCancel();
        }}
        className="flex-1 min-w-[10rem] h-11 sm:h-8 px-2.5 input-field"
      />
      <span className="text-[11px] text-faint">{t('appearance.custom.fromTemplate')}</span>
      <button type="submit" disabled={!name.trim()} className="btn-primary h-11 sm:h-8 px-3 text-xs font-semibold disabled:opacity-50">
        {t('appearance.custom.create')}
      </button>
    </form>
  );
}
