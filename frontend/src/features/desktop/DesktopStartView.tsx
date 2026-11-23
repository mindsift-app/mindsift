import React, { useCallback, useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Brain, CircleAlert, FolderOpen, Globe, HardDrive, LoaderCircle, Pencil, Plus, Trash, TriangleAlert } from 'lucide-react';
import { ActionMenu } from '../../components/ActionMenu';
import { ConfirmHost, askConfirm } from '../../components/askConfirm';
import { initThemeOnBoot } from '../../lib/theme';
import { NO_AUTOFILL } from '../../lib/noAutofill';
import {
  DesktopEntry,
  DesktopProblem,
  DesktopShellError,
  DesktopState,
  desktopShell,
  goTo,
} from '../../lib/desktopShell';
import { errorMessage } from '../../lib/errorMessage';

type Form = null | 'local' | 'server';

const toProblem = (e: unknown): DesktopProblem =>
  e instanceof DesktopShellError ? e.problem : { code: 'failed', detail: errorMessage(e, String(e)) };

// The desktop app's start view (/__desktop/start, served by the shell itself): local instances and servers
// used lately, instances found in the app's folder, a new instance, a new server. In the look of the
// sign-in page; the shell's endpoints in lib/desktopShell.ts.
export const DesktopStartView: React.FC = () => {
  const { t } = useTranslation('desktop');
  const [state, setState] = useState<DesktopState | null>(null);
  const [problem, setProblem] = useState<DesktopProblem | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const empty = state !== null && state.entries.length === 0 && state.found.length === 0;

  const load = useCallback(async () => {
    try {
      const st = await desktopShell.state();
      setState(st);
      if (st.problem) setProblem(st.problem);
    } catch (e) {
      setProblem(toProblem(e));
    }
  }, []);

  useEffect(() => {
    initThemeOnBoot();
    // The state is set only once the shell has answered, not synchronously in the effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Opens what the shell answered; on a refusal (locked, folder gone, server down) the view stays
  const run = async (key: string, action: () => ReturnType<typeof desktopShell.open>) => {
    setBusy(key);
    setProblem(null);
    try {
      await goTo(await action());
    } catch (e) {
      setProblem(toProblem(e));
      setBusy(null);
    }
  };

  const remove = async (entry: DesktopEntry) => {
    const ok = await askConfirm({
      message: t(entry.kind === 'local' ? 'removeConfirmLocal' : 'removeConfirmServer', { name: entry.name }),
      confirmLabel: t('remove'),
    });
    if (!ok) return;
    try {
      await desktopShell.remove(entry.id);
      await load();
    } catch (e) {
      setProblem(toProblem(e));
    }
  };

  const rename = async (entry: DesktopEntry, name: string) => {
    try {
      await desktopShell.rename(entry.id, name);
      setRenaming(null);
      await load();
    } catch (e) {
      setProblem(toProblem(e));
    }
  };

  return (
    <div className="min-h-dvh bg-canvas text-main flex flex-col items-center justify-center p-4 font-sans">
      <div className="w-full max-w-xl panel-surface shadow-panel overflow-hidden">
        <div className="p-4 bg-canvas border-b border-border flex items-center gap-2.5">
          <div className="w-7 h-7 bg-accent text-on-accent rounded-btn flex items-center justify-center">
            <Brain className="w-4 h-4" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-main tracking-tight leading-none">{t('title')}</h1>
            <p className="text-[11px] text-muted mt-1 leading-none">{t('subtitle')}</p>
          </div>
        </div>

        <div className="p-5 text-xs space-y-4">
          {problem && <ProblemNotice problem={problem} onClose={() => setProblem(null)} />}

          {state?.sync && (
            <div role="status" className="p-2.5 rounded-card border border-status-warn/40 bg-status-warn/10 text-main flex items-start gap-2">
              <TriangleAlert className="w-4 h-4 text-status-warn shrink-0 mt-px" />
              <div>
                <p className="font-semibold">{t('syncTitle', { service: state.sync })}</p>
                <p className="text-muted mt-1">{t('syncText')}</p>
              </div>
            </div>
          )}

          {state && state.entries.length > 0 && (
            <section>
              <h2 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">{t('recent')}</h2>
              {/* No overflow-hidden: the entries' menus open below the list */}
              <ul className="border border-border rounded-card divide-y divide-border">
                {state.entries.map((entry) =>
                  renaming === entry.id ? (
                    <RenameRow key={entry.id} entry={entry} onSave={(name) => void rename(entry, name)} onCancel={() => setRenaming(null)} />
                  ) : (
                    <li
                      key={entry.id}
                      className="flex items-center gap-1 pr-1.5 bg-panel hover:bg-panel-elevated transition-colors first:rounded-t-card last:rounded-b-card"
                    >
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void run(entry.id, () => desktopShell.open(entry.id))}
                        className="flex-1 min-w-0 min-h-11 px-3 py-2 flex items-center gap-2.5 text-left disabled:cursor-default"
                      >
                        {entry.kind === 'local' ? (
                          <HardDrive className="w-4 h-4 text-accent shrink-0" />
                        ) : (
                          <Globe className="w-4 h-4 text-accent shrink-0" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="font-semibold text-main truncate">{entry.name}</span>
                            <span className="text-[10px] text-faint shrink-0">{t(entry.kind === 'local' ? 'local' : 'server')}</span>
                            {state.current === entry.id && (
                              <span className="text-[10px] px-1.5 rounded-sm bg-accent/15 text-accent shrink-0">{t('current')}</span>
                            )}
                          </span>
                          <span className="block text-[11px] text-muted font-mono truncate" title={entry.path ?? entry.url}>
                            {entry.path ?? entry.url}
                          </span>
                        </span>
                        {busy === entry.id && <LoaderCircle className="w-4 h-4 animate-spin text-muted shrink-0" />}
                      </button>
                      <ActionMenu
                        label={t('menu', { name: entry.name })}
                        disabled={busy !== null}
                        items={[
                          { key: 'rename', icon: <Pencil className="w-3.5 h-3.5" />, label: t('rename'), onSelect: () => setRenaming(entry.id) },
                          {
                            key: 'remove',
                            icon: <Trash className="w-3.5 h-3.5" />,
                            label: t('remove'),
                            hint: t(entry.kind === 'local' ? 'removeHintLocal' : 'removeHintServer'),
                            danger: true,
                            onSelect: () => void remove(entry),
                          },
                        ]}
                      />
                    </li>
                  )
                )}
              </ul>
            </section>
          )}

          {state && state.found.length > 0 && (
            <section>
              <h2 className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">{t('found')}</h2>
              <ul className="border border-border rounded-card divide-y divide-border overflow-hidden">
                {state.found.map((f) => (
                  <li key={f.path} className="bg-panel">
                    <button
                      type="button"
                      disabled={busy !== null}
                      onClick={() => void run(f.path, () => desktopShell.openFound(f.path))}
                      className="w-full min-h-11 px-3 py-2 flex items-center gap-2.5 text-left hover:bg-panel-elevated transition-colors disabled:cursor-default"
                    >
                      <FolderOpen className="w-4 h-4 text-accent shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-main truncate">{f.name}</span>
                        <span className="block text-[11px] text-muted font-mono truncate" title={f.path}>
                          {f.path}
                        </span>
                      </span>
                      {busy === f.path && <LoaderCircle className="w-4 h-4 animate-spin text-muted shrink-0" />}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* First start (nothing listed): a local instance and a server side by side; nothing is created
              before the person has chosen */}
          {empty && form === null && <FirstRunChoice onChoose={setForm} />}

          {form === 'local' && (
            <LocalForm busy={busy === 'create'} onCancel={() => setForm(null)} onCreate={(name) => void run('create', () => desktopShell.create(name))} />
          )}
          {form === 'server' && (
            <ServerForm
              busy={busy === 'server'}
              onCancel={() => setForm(null)}
              onConnect={(name, url) => void run('server', () => desktopShell.addServer(name, url))}
            />
          )}
          {state && !empty && form === null && (
            <div className="flex flex-col sm:flex-row gap-2">
              <button type="button" onClick={() => setForm('local')} className="btn-action h-11 sm:h-9 px-3 text-xs flex items-center justify-center gap-1.5">
                <Plus className="w-3.5 h-3.5" />
                <span>{t('newLocal')}</span>
              </button>
              <button type="button" onClick={() => setForm('server')} className="btn-action h-11 sm:h-9 px-3 text-xs flex items-center justify-center gap-1.5">
                <Globe className="w-3.5 h-3.5" />
                <span>{t('connect')}</span>
              </button>
            </div>
          )}
        </div>

        {state && (
          <div className="px-5 py-3 bg-canvas border-t border-border text-[11px] text-muted flex flex-col sm:flex-row sm:items-center gap-2">
            <p className="flex-1 min-w-0 break-all">
              <Trans t={t} i18nKey="base" values={{ path: state.base }} components={[<span key="path" className="font-mono text-main" />]} />
            </p>
            <button
              type="button"
              onClick={() => desktopShell.showBase().catch((e) => setProblem(toProblem(e)))}
              className="btn-action h-11 sm:h-7 px-2.5 text-[11px] flex items-center justify-center gap-1.5 shrink-0"
            >
              <FolderOpen className="w-3.5 h-3.5" />
              <span>{t('showBase')}</span>
            </button>
          </div>
        )}
      </div>
      {state?.version && <p className="mt-3 text-[10px] text-faint">{t('version', { version: state.version })}</p>}
      <ConfirmHost />
    </div>
  );
};

// The first start's choice: both ways equal, each a large button with a line on what it means
const FirstRunChoice: React.FC<{ onChoose: (form: 'local' | 'server') => void }> = ({ onChoose }) => {
  const { t } = useTranslation('desktop');
  const choices = [
    { form: 'local' as const, icon: <HardDrive className="w-5 h-5 text-accent shrink-0" />, title: t('firstLocal'), hint: t('firstLocalHint') },
    { form: 'server' as const, icon: <Globe className="w-5 h-5 text-accent shrink-0" />, title: t('firstServer'), hint: t('firstServerHint') },
  ];
  return (
    <section className="space-y-3">
      <p className="text-muted">{t('empty')}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {choices.map((c) => (
          <button
            key={c.form}
            type="button"
            onClick={() => onChoose(c.form)}
            className="min-h-11 p-3.5 border border-border rounded-card bg-panel hover:bg-panel-elevated hover:border-accent/50 transition-colors flex flex-col items-start gap-2 text-left"
          >
            {c.icon}
            <span className="text-sm font-bold text-main">{c.title}</span>
            <span className="text-muted">{c.hint}</span>
          </button>
        ))}
      </div>
    </section>
  );
};

const ProblemNotice: React.FC<{ problem: DesktopProblem; onClose: () => void }> = ({ problem, onClose }) => {
  const { t } = useTranslation('desktop');
  const known = ['shellUnreachable', 'failed', 'urlMissing', 'urlInvalid', 'serverUnreachable', 'notMindSift', 'nameMissing', 'nameTooLong', 'folderFailed', 'locked', 'openFailed', 'notFound', 'folderGone'];
  return (
    <div role="alert" className="alert-err flex items-start gap-2">
      <CircleAlert className="w-4 h-4 text-status-err shrink-0 mt-px" />
      <div className="flex-1 min-w-0">
        <p>{t(`errors.${known.includes(problem.code) ? problem.code : 'failed'}`)}</p>
        {problem.detail && <p className="mt-1 text-[11px] font-mono break-all opacity-80">{problem.detail}</p>}
      </div>
      <button type="button" onClick={onClose} className="btn-action h-7 px-2 text-[11px] shrink-0">
        {t('dismiss')}
      </button>
    </div>
  );
};

const RenameRow: React.FC<{ entry: DesktopEntry; onSave: (name: string) => void; onCancel: () => void }> = ({ entry, onSave, onCancel }) => {
  const { t } = useTranslation('desktop');
  const [name, setName] = useState(entry.name);
  return (
    <li className="bg-panel first:rounded-t-card last:rounded-b-card">
      <form
        className="flex items-center gap-2 px-3 py-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(name);
        }}
      >
        <input
          {...NO_AUTOFILL}
          autoFocus
          value={name}
          maxLength={80}
          aria-label={t('renameLabel')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancel();
          }}
          className="flex-1 min-w-0 h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
        />
        <button type="submit" disabled={!name.trim()} className="btn-primary h-11 sm:h-8 px-3 text-xs disabled:opacity-50">
          {t('save')}
        </button>
        <button type="button" onClick={onCancel} className="btn-action h-11 sm:h-8 px-3 text-xs">
          {t('cancel')}
        </button>
      </form>
    </li>
  );
};

const LocalForm: React.FC<{ busy: boolean; onCreate: (name: string) => void; onCancel: () => void }> = ({ busy, onCreate, onCancel }) => {
  const { t } = useTranslation('desktop');
  const [name, setName] = useState('');
  return (
    <form
      className="space-y-3 p-3.5 border border-border rounded-card bg-canvas"
      onSubmit={(e) => {
        e.preventDefault();
        onCreate(name);
      }}
    >
      <div>
        <h2 className="text-sm font-bold text-main">{t('newLocalTitle')}</h2>
        <p className="text-muted mt-1">{t('newLocalIntro')}</p>
      </div>
      <div>
        <label htmlFor="desktop-local-name" className="block text-muted mb-1">
          {t('name')}
        </label>
        <input
          {...NO_AUTOFILL}
          id="desktop-local-name"
          autoFocus
          value={name}
          maxLength={80}
          placeholder={t('localNamePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          className="w-full h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
        />
      </div>
      <FormButtons busy={busy} disabled={!name.trim()} label={t('create')} onCancel={onCancel} />
    </form>
  );
};

const ServerForm: React.FC<{ busy: boolean; onConnect: (name: string, url: string) => void; onCancel: () => void }> = ({ busy, onConnect, onCancel }) => {
  const { t } = useTranslation('desktop');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  return (
    <form
      className="space-y-3 p-3.5 border border-border rounded-card bg-canvas"
      onSubmit={(e) => {
        e.preventDefault();
        onConnect(name, url);
      }}
    >
      <div>
        <h2 className="text-sm font-bold text-main">{t('connectTitle')}</h2>
        <p className="text-muted mt-1">{t('connectIntro')}</p>
      </div>
      <div>
        <label htmlFor="desktop-server-url" className="block text-muted mb-1">
          {t('address')}
        </label>
        <input
          {...NO_AUTOFILL}
          id="desktop-server-url"
          autoFocus
          inputMode="url"
          value={url}
          placeholder="https://notes.example.com"
          onChange={(e) => setUrl(e.target.value)}
          className="w-full h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs font-mono"
        />
      </div>
      <div>
        <label htmlFor="desktop-server-name" className="block text-muted mb-1">
          {t('serverName')}
        </label>
        <input
          {...NO_AUTOFILL}
          id="desktop-server-name"
          value={name}
          maxLength={80}
          placeholder={t('serverNamePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          className="w-full h-11 sm:h-8 px-2.5 input-field text-base sm:text-xs"
        />
      </div>
      <FormButtons busy={busy} disabled={!url.trim()} label={t('connectButton')} onCancel={onCancel} />
    </form>
  );
};

const FormButtons: React.FC<{ busy: boolean; disabled: boolean; label: string; onCancel: () => void }> = ({ busy, disabled, label, onCancel }) => {
  const { t } = useTranslation('desktop');
  return (
    <div className="flex flex-col-reverse sm:flex-row gap-2 pt-1">
      <button type="button" onClick={onCancel} disabled={busy} className="btn-action h-11 sm:h-9 px-4 text-xs">
        {t('cancel')}
      </button>
      <button type="submit" disabled={busy || disabled} className="flex-1 btn-primary h-11 sm:h-9 text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-50">
        {busy && <LoaderCircle className="w-3.5 h-3.5 animate-spin" />}
        <span>{label}</span>
      </button>
    </div>
  );
};

export default DesktopStartView;
