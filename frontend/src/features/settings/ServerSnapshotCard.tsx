import React, { useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Check, CircleAlert, FileArchive, RotateCcw, Server, Upload, UserRound } from 'lucide-react';
import { DATA_SECTIONS, DataSection, SnapshotAccount, SnapshotStaged, SnapshotTakeOver } from '../../lib/types';
import { api } from '../../lib/api';
import { errorMessage } from '../../lib/errorMessage';
import { ToggleSwitch } from '../../components/ToggleSwitch';
import { SectionPicker } from './SectionPicker';
import { summaryParts } from './importSummary';

// Desktop app, Administration → Data: one account of a server's database snapshot (.db.gz) into this
// instance's account. The snapshot holds every account of the server; the person picks one, sees what
// would come over, then takes it over. Only what that account owns comes along (api/desktop_restore.go).
export const ServerSnapshotCard: React.FC = () => {
  const { t } = useTranslation('settings');
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [staged, setStaged] = useState<SnapshotStaged | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [mode, setMode] = useState<'merge' | 'restore'>('restore');
  const [sections, setSections] = useState<DataSection[]>(DATA_SECTIONS.map((s) => s.id));
  const [settings, setSettings] = useState(true);
  const [preview, setPreview] = useState<SnapshotTakeOver | null>(null);
  const [result, setResult] = useState<SnapshotTakeOver | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<'reading' | 'preview' | 'applying' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  // The preview follows the choice of account, sections and settings; only the answer to the latest
  // choice is shown (mode does not change what it counts)
  const previewSeq = useRef(0);
  const choose = (next: { account?: string; sections?: DataSection[]; settings?: boolean }) => {
    const a = next.account ?? account;
    const sec = next.sections ?? sections;
    const set = next.settings ?? settings;
    if (next.account) setAccount(next.account);
    if (next.sections) setSections(next.sections);
    if (next.settings !== undefined) setSettings(next.settings);
    if (staged && a) loadPreview(staged, a, sec, set);
  };
  const loadPreview = (st: SnapshotStaged, a: string, sec: DataSection[], set: boolean) => {
    const seq = ++previewSeq.current;
    setBusy('preview');
    setError(null);
    setConfirm(false);
    api
      .adminTakeOverSnapshotAccount(st.token, a, { preview: true, mode, sections: sec, settings: set })
      .then((p) => seq === previewSeq.current && setPreview(p))
      .catch((err) => seq === previewSeq.current && setError(errorMessage(err, t('import.readFailed'))))
      .finally(() => seq === previewSeq.current && setBusy(null));
  };

  const reset = () => {
    if (staged) api.adminDiscardServerSnapshot(staged.token).catch(() => {});
    previewSeq.current++; // a preview still on its way is dropped
    setBusy(null);
    setStaged(null);
    setAccount(null);
    setPreview(null);
    setConfirm(false);
    setError(null);
    setFileName('');
  };

  const pick = async (f?: File) => {
    if (!f) return;
    reset();
    setResult(null);
    setFileName(f.name);
    setBusy('reading');
    try {
      const s = await api.adminStageServerSnapshot(f);
      setStaged(s);
      setBusy(null);
      if (s.accounts.length === 1) {
        setAccount(s.accounts[0].id);
        loadPreview(s, s.accounts[0].id, sections, settings);
      }
    } catch (err) {
      setError(errorMessage(err, t('import.readFailed')));
      setBusy(null);
    }
  };

  const takeOver = async () => {
    if (!staged || !account) return;
    setBusy('applying');
    setError(null);
    try {
      setResult(await api.adminTakeOverSnapshotAccount(staged.token, account, { preview: false, mode, sections, settings }));
      setStaged(null);
      setAccount(null);
      setPreview(null);
      setConfirm(false);
    } catch (err) {
      setError(errorMessage(err, t('import.failed')));
    } finally {
      setBusy(null);
    }
  };

  const counts = (a: SnapshotAccount) =>
    [
      t('import.summary.notes', { count: a.notes }),
      t('import.summary.tasks', { count: a.tasks }),
      t('backups.snapshot.lists', { count: a.lists }),
      t('backups.snapshot.inbox', { count: a.inbox }),
    ].join(' · ');

  const restoring = mode === 'restore';
  const sectionNames = DATA_SECTIONS.filter((s) => sections.includes(s.id))
    .map((s) => s.label)
    .join(', ');

  return (
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
      <div>
        <p className="font-bold text-main flex items-center gap-1.5">
          <Server className="w-3.5 h-3.5 text-accent" />
          {t('backups.snapshot.title')}
        </p>
        <p className="text-[11px] text-muted mt-0.5">
          <Trans t={t} i18nKey="backups.snapshot.hint" components={{ c: <code className="font-mono" /> }} />
        </p>
      </div>

      {!staged && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pick(e.dataTransfer.files?.[0]);
          }}
          className={`p-4 border border-dashed rounded-card flex flex-col sm:flex-row items-center justify-center gap-3 text-center transition-colors ${
            dragOver ? 'border-accent bg-accent/10' : 'border-border'
          }`}
        >
          <span className="text-[11px] text-muted hidden sm:inline">{t('import.dropHint')}</span>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => inputRef.current?.click()}
            className="btn-action h-11 sm:h-9 px-4 text-xs flex items-center justify-center gap-2 disabled:opacity-50 w-full sm:w-auto"
          >
            <Upload className="w-3.5 h-3.5 text-accent" />
            <span>{t('backups.snapshot.choose')}</span>
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".gz,.db,application/gzip"
            className="hidden"
            onChange={(e) => {
              pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {busy === 'reading' && <p className="text-[11px] text-muted">{t('backups.snapshot.reading', { name: fileName })}</p>}

      {staged && (
        <div className="space-y-3">
          <div role="radiogroup" aria-label={t('backups.snapshot.pickAccount')} className="space-y-1.5">
            <p className="text-[11px] text-muted flex items-center gap-1.5">
              <FileArchive className="w-3.5 h-3.5 text-accent" />
              <span className="font-mono text-main truncate">{fileName}</span>
              <span>· {t('backups.snapshot.pickAccount')}</span>
            </p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {staged.accounts.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={account === a.id}
                  onClick={() => choose({ account: a.id })}
                  className={`p-2.5 min-h-[44px] text-left border rounded-card transition-colors ${
                    account === a.id ? 'border-accent bg-accent/10' : 'border-border hover:border-strong'
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-main">
                    <UserRound className="w-3.5 h-3.5 text-muted shrink-0" />
                    <span className="truncate">{a.displayName || a.username}</span>
                    {!a.isActive && <span className="text-[10px] font-normal text-faint">({t('backups.snapshot.inactive')})</span>}
                  </span>
                  <span className="block text-[11px] text-muted truncate">
                    @{a.username}
                    {a.email && ` · ${a.email}`}
                  </span>
                  <span className="block text-[11px] text-faint">{counts(a)}</span>
                </button>
              ))}
            </div>
          </div>

          {account && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" role="radiogroup" aria-label={t('backups.restoreMode')}>
                {(
                  [
                    ['restore', t('backups.replace'), t('import.restoreHint')],
                    ['merge', t('import.merge'), t('backups.mergeHint')],
                  ] as const
                ).map(([value, label, text]) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={mode === value}
                    onClick={() => {
                      setMode(value);
                      setConfirm(false);
                    }}
                    className={`p-2 min-h-[44px] text-left border rounded-card transition-colors ${
                      mode === value ? (value === 'restore' ? 'border-status-err bg-status-err/10' : 'border-accent bg-accent/10') : 'border-border'
                    }`}
                  >
                    <span className="block text-xs font-semibold text-main">{label}</span>
                    <span className="block text-[11px] text-muted">{text}</span>
                  </button>
                ))}
              </div>
              <SectionPicker value={sections} onChange={(next) => choose({ sections: next })} />
              <div className="flex items-center justify-between gap-3 border border-border rounded-card px-3 py-2 bg-panel">
                <div>
                  <p className="text-xs text-main">{t('backups.snapshot.settings')}</p>
                  <p className="text-[11px] text-muted">{t('backups.snapshot.settingsHint')}</p>
                </div>
                <ToggleSwitch checked={settings} onChange={(on) => choose({ settings: on })} title={t('backups.snapshot.settings')} />
              </div>
            </>
          )}

          {busy === 'preview' && <p className="text-[11px] text-muted">{t('import.reading')}</p>}
          {busy === 'applying' && <p className="text-[11px] text-muted">{t('import.importing')}</p>}

          {preview && account && busy === null && (
            <div className="p-3 rounded-card border border-border bg-panel text-xs space-y-2">
              <p className="font-semibold text-main flex items-center gap-1.5">
                <FileArchive className="w-3.5 h-3.5 text-accent" />
                <span>{t('backups.snapshot.previewTitle', { name: preview.account.displayName || preview.account.username })}</span>
              </p>
              <p className="text-muted">{t('import.willCreate', { what: summaryParts(preview).join(', ') || t('import.nothing') })}</p>
              {preview.settings && <p className="text-muted">{t('backups.snapshot.settingsToo')}</p>}
              {preview.skipped.length > 0 && (
                <details className="text-[11px] text-muted">
                  <summary className="cursor-pointer">{t('import.skipped', { count: preview.skipped.length })}</summary>
                  <ul className="mt-1 space-y-0.5 max-h-40 overflow-y-auto">
                    {preview.skipped.map((s, i) => (
                      <li key={i}>
                        <span className="font-mono text-main">{s.path}</span> – {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {restoring && (
                <label className="flex items-start gap-2 p-2.5 rounded-card border border-status-err/40 bg-status-err/10 text-[11px] text-main cursor-pointer">
                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 w-4 h-4 shrink-0" />
                  <span>
                    <Trans
                      t={t}
                      i18nKey="backups.snapshot.replaceWarning"
                      values={{ sections: sectionNames }}
                      components={{ b: <strong className="text-status-err" /> }}
                    />
                  </span>
                </label>
              )}
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  type="button"
                  onClick={takeOver}
                  disabled={restoring && !confirm}
                  className={`h-11 sm:h-8 px-4 text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                    restoring ? 'btn-action border-status-err text-status-err' : 'btn-primary'
                  }`}
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {restoring ? t('backups.snapshot.replaceNow') : t('backups.snapshot.takeOver')}
                </button>
                <button type="button" onClick={reset} className="btn-action h-11 sm:h-8 px-3 text-xs">
                  {t('common:cancel')}
                </button>
              </div>
            </div>
          )}
          {!account && (
            <button type="button" onClick={reset} className="btn-action h-11 sm:h-8 px-3 text-xs">
              {t('common:cancel')}
            </button>
          )}
        </div>
      )}

      {error && (
        <p className="text-[11px] text-status-err flex items-start gap-1.5">
          <CircleAlert className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span>{error}</span>
        </p>
      )}

      {result && (
        <div className="p-3 rounded-card border border-status-ok/40 bg-status-ok/10 text-xs space-y-2">
          <p className="font-semibold text-main flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5 text-status-ok" />
            <span>{t('backups.snapshot.done', { name: result.account.displayName || result.account.username })}</span>
          </p>
          <p className="text-muted">{t('import.created', { what: summaryParts(result).join(', ') || t('import.nothing') })}</p>
          {result.skipped.length > 0 && (
            <p className="text-[11px] text-muted">{t('import.skipped', { count: result.skipped.length })}</p>
          )}
          {(result.settingsSkipped?.length ?? 0) > 0 && (
            <p className="text-[11px] text-muted">
              {t('backups.snapshot.settingsSkipped', {
                what: (result.settingsSkipped ?? []).map((k) => t(`backups.snapshot.skippedSetting.${k}`)).join(', '),
              })}
            </p>
          )}
          <button type="button" onClick={() => window.location.reload()} className="btn-primary h-11 sm:h-8 px-4 text-xs font-semibold">
            {t('backups.snapshot.reload')}
          </button>
        </div>
      )}
    </div>
  );
};
