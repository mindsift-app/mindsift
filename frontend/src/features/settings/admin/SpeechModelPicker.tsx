import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CircleAlert, Download, LoaderCircle, Trash } from 'lucide-react';
import { api } from '../../../lib/api';
import { SpeechModelsInfo } from '../../../lib/types';
import { errorMessage } from '../../../lib/errorMessage';
import { askConfirm } from '../../../components/askConfirm';
import { formatClock } from '../../../lib/format';

const POLL_MS = 3000;

const elapsed = (since: string, now: number) => formatClock((now - Date.parse(since)) / 1000);

// Administration → Voice input & AI: the models of the Whisper server. Downloaded ones are chosen with a
// click; the others are greyed out, a click lets the Whisper server download them and uses them once
// they are there. speaches tells no progress, so a running download shows a moving bar and the time
// since it started. A downloaded model other than the one in use can be deleted from the Whisper server
// (after a confirmation) to free its space. Locked (read only) when STT_MODEL fixes the model.
export function SpeechModelPicker({ locked, onChanged }: { locked: boolean; onChanged: () => void }) {
  const { t } = useTranslation('settings');
  const [info, setInfo] = useState<SpeechModelsInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const [deleting, setDeleting] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await api.adminSpeechModels());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, t('speech.modelsFailed')));
    }
  }, [t]);

  useEffect(() => {
    // Loads the models when the card opens
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // While a download runs: ask again every few seconds and tick the clock
  const running = Boolean(info?.downloads.some((d) => d.running));
  useEffect(() => {
    if (!running) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => void load(), POLL_MS);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
  }, [running, load]);
  // Once the downloads are over, the model in use may be a new one
  const wasRunning = useRef(false);
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  });
  useEffect(() => {
    if (wasRunning.current && !running) onChangedRef.current();
    wasRunning.current = running;
  }, [running]);

  const choose = async (id: string) => {
    if (locked || !id.trim()) return;
    setError(null);
    try {
      const res = await api.adminDownloadSpeechModel(id.trim(), true);
      await load();
      if (res.downloaded) onChanged();
    } catch (err) {
      setError(errorMessage(err, t('speech.downloadFailed')));
    }
  };

  const remove = async (id: string) => {
    const ok = await askConfirm({ message: t('speech.deleteConfirm', { model: id }), confirmLabel: t('speech.delete'), danger: true });
    if (!ok) return;
    setError(null);
    setDeleting(id);
    try {
      await api.adminDeleteSpeechModel(id);
    } catch (err) {
      setError(errorMessage(err, t('speech.deleteFailed')));
    }
    await load();
    setDeleting(null);
  };

  if (!info) {
    return error ? <p className="text-status-err text-xs">{error}</p> : <LoaderCircle className="w-4 h-4 animate-spin text-muted" />;
  }
  const download = (id: string) => info.downloads.find((d) => d.model === id);
  return (
    <div className="space-y-2" data-speech-models>
      {!info.reachable && <p className="text-[11px] text-status-warn">{info.error || t('speech.unreachable')}</p>}
      <ul className="divide-y divide-border border border-border rounded-btn overflow-hidden">
        {info.models.map((m) => {
          const d = download(m.id);
          const current = m.id === info.model;
          // Not the one in use, not while it downloads, not while STT_MODEL fixes the model
          const deletable = !locked && info.reachable && m.downloaded && !current && !d?.running;
          return (
            <li key={m.id} className="flex items-stretch">
              <button
                type="button"
                disabled={locked || d?.running || (current && m.downloaded)}
                onClick={() => void choose(m.id)}
                data-model={m.id}
                data-downloaded={m.downloaded ? 'true' : 'false'}
                className={`flex-1 min-w-0 min-h-11 px-3 py-2 text-left flex items-center gap-2 text-xs ${
                  m.downloaded ? 'bg-panel text-main' : 'bg-canvas text-muted'
                } ${current ? 'ring-1 ring-inset ring-accent' : ''} enabled:hover:bg-panel-elevated disabled:cursor-default`}
              >
                <span className="flex-1 min-w-0">
                  <span className="font-mono break-all">{m.id}</span>
                  {m.sizeMb ? <span className="text-faint"> · {t('speech.size', { size: (m.sizeMb / 1000).toFixed(1) })}</span> : null}
                  {d?.running && (
                    <span className="block mt-1.5">
                      <span className="block h-1 rounded-full bg-border overflow-hidden">
                        <span className="block h-full w-1/3 bg-accent animate-pulse" />
                      </span>
                      <span className="text-[11px] text-muted">{t('speech.downloading', { time: elapsed(d.startedAt, now) })}</span>
                    </span>
                  )}
                  {d && !d.running && d.error && (
                    <span className="block text-[11px] text-status-err">{t('speech.downloadError', { error: d.error })}</span>
                  )}
                </span>
                {current && m.downloaded && (
                  <span className="text-status-ok flex items-center gap-1 shrink-0">
                    <Check className="w-3.5 h-3.5" /> {t('speech.inUse')}
                  </span>
                )}
                {current && !m.downloaded && !d?.running && (
                  <span className="text-status-warn flex items-center gap-1 shrink-0">
                    <CircleAlert className="w-3.5 h-3.5" /> {t('speech.missing')}
                  </span>
                )}
                {!current && m.downloaded && <span className="text-faint shrink-0">{t('speech.downloaded')}</span>}
                {!m.downloaded && !d?.running && (
                  <span className="flex items-center gap-1 shrink-0">
                    <Download className="w-3.5 h-3.5" /> {t('speech.download')}
                  </span>
                )}
                {d?.running && <LoaderCircle className="w-3.5 h-3.5 animate-spin shrink-0" />}
              </button>
              {deletable && (
                <button
                  type="button"
                  disabled={deleting !== null}
                  onClick={() => void remove(m.id)}
                  title={t('speech.deleteModel')}
                  aria-label={t('speech.deleteModelOf', { model: m.id })}
                  data-delete-model={m.id}
                  className="shrink-0 w-11 sm:w-9 flex items-center justify-center border-l border-border bg-panel text-muted enabled:hover:text-status-err enabled:hover:bg-panel-elevated disabled:opacity-50"
                >
                  {deleting === m.id ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Trash className="w-3.5 h-3.5" />}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {!locked && (
        <form
          className="flex flex-col sm:flex-row gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void choose(custom);
            setCustom('');
          }}
        >
          <input
            type="text"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={t('speech.customPlaceholder')}
            aria-label={t('speech.custom')}
            className="flex-1 h-11 sm:h-8 px-2 input-field text-base sm:text-xs font-mono"
          />
          <button type="submit" disabled={!custom.trim()} className="btn-secondary h-11 sm:h-8 px-3 text-xs disabled:opacity-40">
            {t('speech.customUse')}
          </button>
        </form>
      )}
      {error && <p className="text-status-err text-xs">{error}</p>}
    </div>
  );
}
