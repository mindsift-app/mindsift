import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { Check, Copy, Laptop } from 'lucide-react';
import { desktopShell, DesktopLocalApi, DesktopShellError, DesktopProblem } from '../../lib/desktopShell';
import { ToggleSwitch } from '../../components/ToggleSwitch';

// The first port the shell tries (DefaultLocalAPIPort in desktop/internal/shell/localapi.go)
export const DEFAULT_LOCAL_API_PORT = 18890;

// The address local programs use for a port
export const localApiBase = (port: number): string => `http://127.0.0.1:${port}`;

interface DesktopLocalAccessProps {
  // The address the examples below show (http://127.0.0.1:<port>), null while no port is chosen yet
  onBaseChange: (base: string | null) => void;
}

// Desktop app, settings → API: "Make reachable for local programs" for the open local instance. The shell
// (desktop/internal/shell/localapi.go) then also listens on 127.0.0.1 with the routes API keys may call.
export const DesktopLocalAccess: React.FC<DesktopLocalAccessProps> = ({ onBaseChange }) => {
  const { t } = useTranslation('settings');
  const [state, setState] = useState<DesktopLocalApi | null>(null);
  const [portInput, setPortInput] = useState('');
  const [problem, setProblem] = useState<DesktopProblem | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const apply = (st: DesktopLocalApi) => {
    setState(st);
    setProblem(st.problem ?? null);
    setPortInput(st.port ? String(st.port) : '');
    onBaseChange(st.port ? localApiBase(st.port) : null);
  };

  const run = async (call: () => Promise<DesktopLocalApi>) => {
    setBusy(true);
    try {
      apply(await call());
    } catch (err) {
      setProblem(err instanceof DesktopShellError ? err.problem : { code: 'failed', detail: String(err) });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // Loads the setting when the panel opens
    // eslint-disable-next-line react-hooks/set-state-in-effect
    run(desktopShell.localApi);
    // run is a new function every render; the setting is loaded once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!state) return problem ? <p className="text-xs text-status-err">{t(`desktop:errors.${problem.code}`, { defaultValue: t('desktop:errors.failed') })}</p> : null;

  const port = Number(portInput);
  const portChanged = state.enabled && portInput !== '' && port !== state.port;
  const address = state.port ? `${localApiBase(state.port)}/api/v1/mcp` : '';

  return (
    <div className="p-3 bg-canvas border border-border space-y-3">
      <div className="flex items-start gap-3">
        <Laptop className="w-4 h-4 mt-0.5 text-accent shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-main">{t('api.local.title')}</p>
          <p className="text-[11px] text-muted">{t('api.local.intro')}</p>
        </div>
        <ToggleSwitch
          checked={state.enabled}
          disabled={busy}
          title={t('api.local.title')}
          onChange={(on) => run(() => desktopShell.setLocalApi(on))}
        />
      </div>

      {state.enabled && address && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 p-2 bg-panel border border-border font-mono text-xs text-main break-all">{address}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(address);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              className="btn-icon w-11 h-11 sm:w-9 sm:h-9 shrink-0"
              aria-label={t('api.mcp.copyAddress')}
              title={t('api.mcp.copyAddress')}
            >
              {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (portChanged) run(() => desktopShell.setLocalApi(true, port));
            }}
          >
            <label htmlFor="local-api-port" className="text-[11px] text-muted">
              {t('api.local.port')}
            </label>
            <input
              id="local-api-port"
              type="number"
              inputMode="numeric"
              min={1024}
              max={65535}
              value={portInput}
              onChange={(e) => setPortInput(e.target.value)}
              className="w-28 h-11 sm:h-8 px-2 input-field text-base sm:text-xs font-mono"
            />
            {portChanged && (
              <button type="submit" disabled={busy} className="btn-action text-xs">
                {t('api.local.changePort')}
              </button>
            )}
          </form>
          <p className="text-[11px] text-muted">
            <Trans t={t} i18nKey="api.local.hint" components={{ c: <code className="font-mono" /> }} />
          </p>
        </div>
      )}

      {problem && (
        <p role="alert" className="text-xs text-status-err">
          {t(`desktop:errors.${problem.code}`, { detail: problem.detail, defaultValue: t('desktop:errors.failed') })}
        </p>
      )}
    </div>
  );
};
