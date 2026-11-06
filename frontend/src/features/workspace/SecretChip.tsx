import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { Check, Copy, EyeOff, KeyRound, Lock, Pencil } from 'lucide-react';
import { api } from '../../lib/api';
import { ApiError } from '../../lib/api/client';
import { showError } from '../../components/ErrorNotice';
import { FormSheet } from '../../components/FormSheet';
import { NO_AUTOFILL } from '../../lib/noAutofill';
import { isPublicView } from '../../lib/publicNote';

/** What a failed reveal means: the value was deleted, cannot be decrypted, or another error to show. */
export function revealFailure(err: unknown): 'gone' | 'unreadable' | 'error' {
  if (err instanceof ApiError && err.code === 'secret_gone') return 'gone';
  if (err instanceof ApiError && err.code === 'secret_unreadable') return 'unreadable';
  return 'error';
}

// How long a revealed value stays visible
const REVEAL_MS = 20_000;

// The value goes through CSS (content: attr()), not as text: it stays out of the bullet's rendered text
// (caret mapping, selecting and copying a row) and leaves the page as soon as the chip closes.
const chipClass =
  'inline-flex items-center align-baseline mx-0.5 px-1.5 rounded-btn border border-border bg-panel-elevated font-mono text-[0.85em] leading-snug';
// Phones: wider gaps and a hit area beyond the icon (the line keeps its height)
const chipButton =
  "relative inline-flex items-center justify-center text-muted hover:text-main cursor-pointer after:absolute after:-inset-2 sm:after:inset-0 after:content-['']";

/** A hidden value in a bullet ({{secret:id}}): dots until clicked, then the value for a short while. */
export const SecretChip: React.FC<{ docId: string; secretId: string; canEdit: boolean }> = (props) =>
  // A public page has no id to reveal (the server sends {{secret:hidden}}): only the dots
  isPublicView() ? (
    <span className={`${chipClass} gap-1 text-muted`} data-secret>
      <Lock className="w-3 h-3 shrink-0" />
      <span aria-hidden="true" className="before:content-['••••'] tracking-wider" />
    </span>
  ) : (
    <RevealableSecret {...props} />
  );

const RevealableSecret: React.FC<{ docId: string; secretId: string; canEdit: boolean }> = ({ docId, secretId, canEdit }) => {
  const { t } = useTranslation('workspace');
  const [value, setValue] = useState<string | null>(null);
  const [state, setState] = useState<'hidden' | 'loading' | 'gone' | 'unreadable'>('hidden');
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const hideTimer = useRef<number | null>(null);

  const clearTimer = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
  };
  useEffect(() => clearTimer, []);

  const hide = () => {
    clearTimer();
    setValue(null);
    setCopied(false);
  };
  const show = (v: string) => {
    setValue(v);
    setState('hidden');
    clearTimer();
    hideTimer.current = window.setTimeout(hide, REVEAL_MS);
  };

  const reveal = async () => {
    setState('loading');
    try {
      show(await api.revealSecret(docId, secretId));
    } catch (err) {
      const failed = revealFailure(err);
      setState(failed === 'error' ? 'hidden' : failed);
      if (failed === 'error') showError(err instanceof Error ? err.message : String(err));
    }
  };

  // Clicks stay with the chip: the row would otherwise start editing or a selection
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  const act = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };

  if (state === 'gone' || state === 'unreadable') {
    return (
      <span className={`${chipClass} gap-1 text-faint italic font-sans`} data-secret onMouseDown={stop} onClick={stop}>
        <Lock className="w-3 h-3 shrink-0" />
        <span aria-hidden="true" data-v={t(state === 'gone' ? 'secret.gone' : 'secret.unreadable')} className="before:content-[attr(data-v)]" />
      </span>
    );
  }

  // In a portal, so the row's styles (font, white-space) stay out of the dialog; React still bubbles its
  // clicks up to the row, hence the wrapper
  const editSheet =
    editing !== null &&
    createPortal(
      <span onMouseDown={stop} onClick={stop} onKeyDown={stop}>
      <FormSheet
        title={t('secret.editTitle')}
        icon={<KeyRound className="w-4 h-4 text-accent" />}
        submitLabel={t('secret.save')}
        busy={saving}
        onClose={() => {
          setEditing(null);
          if (value !== null) show(value);
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!editing.trim()) return;
          setSaving(true);
          try {
            await api.updateSecret(docId, secretId, editing);
            show(editing);
            setEditing(null);
          } catch (err) {
            showError(err instanceof Error ? err.message : String(err));
          } finally {
            setSaving(false);
          }
        }}
      >
        <input
          type="text"
          autoFocus
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          spellCheck={false}
          {...NO_AUTOFILL}
          className="input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs font-mono"
        />
      </FormSheet>
      </span>,
      document.body
    );

  if (value === null) {
    return (
      <>
        <button
          type="button"
          data-secret
          onMouseDown={stop}
          onClick={act(() => void reveal())}
          disabled={state === 'loading'}
          title={t('secret.reveal')}
          aria-label={t('secret.label')}
          className={`${chipClass} gap-1 text-muted hover:text-main cursor-pointer`}
        >
          <Lock className="w-3 h-3 shrink-0" />
          <span aria-hidden="true" className="before:content-['••••'] tracking-wider" />
        </button>
        {editSheet}
      </>
    );
  }

  return (
    <span className={`${chipClass} gap-3 sm:gap-1 text-main`} data-secret onMouseDown={stop} onClick={stop}>
      <span data-v={value} className="before:content-[attr(data-v)] select-none break-all" />
      <button
        type="button"
        onClick={act(() => {
          void navigator.clipboard?.writeText(value).catch(() => {});
          setCopied(true);
        })}
        title={copied ? t('secret.copied') : t('secret.copy')}
        aria-label={copied ? t('secret.copied') : t('secret.copy')}
        className={chipButton}
      >
        {copied ? <Check className="w-3.5 h-3.5 sm:w-3 sm:h-3 text-status-ok" /> : <Copy className="w-3.5 h-3.5 sm:w-3 sm:h-3" />}
      </button>
      {canEdit && (
        <button
          type="button"
          onClick={act(() => {
            clearTimer();
            setEditing(value);
          })}
          title={t('secret.edit')}
          aria-label={t('secret.edit')}
          className={chipButton}
        >
          <Pencil className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
        </button>
      )}
      <button type="button" onClick={act(hide)} title={t('secret.hide')} aria-label={t('secret.hide')} className={chipButton}>
        <EyeOff className="w-3.5 h-3.5 sm:w-3 sm:h-3" />
      </button>
      {editSheet}
    </span>
  );
};

/** Asks for a value to hide (slash command /secret) and stores it; onCreated gets the reference. */
export const NewSecretSheet: React.FC<{ docId: string; onClose: () => void; onCreated: (ref: string) => void }> = ({
  docId,
  onClose,
  onCreated,
}) => {
  const { t } = useTranslation('workspace');
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  return createPortal(
    <FormSheet
      title={t('secret.newTitle')}
      icon={<KeyRound className="w-4 h-4 text-accent" />}
      submitLabel={t('secret.create')}
      busy={saving}
      onClose={onClose}
      onSubmit={async (e) => {
        e.preventDefault();
        if (!value.trim() || saving) return;
        setSaving(true);
        try {
          const { ref } = await api.createSecret(docId, value);
          onCreated(ref);
        } catch (err) {
          showError(err instanceof Error ? err.message : String(err));
          setSaving(false);
        }
      }}
    >
      <input
        type="text"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={t('secret.placeholder')}
        spellCheck={false}
        {...NO_AUTOFILL}
        className="input-field w-full h-11 sm:h-8 px-2.5 text-base sm:text-xs font-mono"
      />
      <p className="mt-2 text-[11px] text-muted leading-snug">{t('secret.hint')}</p>
    </FormSheet>,
    document.body
  );
};
