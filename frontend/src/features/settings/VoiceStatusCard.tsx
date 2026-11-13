import React, { useEffect, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { CircleAlert, Check, LoaderCircle, Mic, RefreshCw, Square } from 'lucide-react';
import { api } from '../../lib/api';
import { VoiceAdminStatus } from '../../lib/types';
import { errorMessage } from '../../lib/errorMessage';

const TEST_SECONDS = 6;

// Admin: which speech recognition is active. Configured only by environment (STT_*), so this card
// just shows the state and offers a short test recording through the own Whisper server.
export const VoiceStatusCard: React.FC = () => {
  const { t } = useTranslation('settings');
  const [info, setInfo] = useState<VoiceAdminStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ text: string; ms: number } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const stopTimerRef = useRef<number | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setInfo(await api.adminVoiceStatus());
      setError(null);
    } catch (err) {
      setError(errorMessage(err, i18n.t('settings:voiceStatus.loadFailed')));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Loads the status when the card opens
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    return () => {
      if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
      recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const stopRecording = () => {
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = null;
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  };

  const startTest = async () => {
    setResult(null);
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t('voiceStatus.noMic'));
      return;
    }
    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      setTesting(true);
      const started = performance.now();
      try {
        const text = await api.transcribe(new Blob(chunks, { type: recorder.mimeType }));
        setResult({ text, ms: Math.round(performance.now() - started) });
      } catch (err) {
        setError(errorMessage(err, t('voiceStatus.failed')));
      } finally {
        setTesting(false);
      }
    };
    recorderRef.current = recorder;
    recorder.start();
    setRecording(true);
    stopTimerRef.current = window.setTimeout(stopRecording, TEST_SECONDS * 1000);
  };

  const status = info?.status;
  const serverOk = info?.mode === 'server' && status?.reachable && status?.modelReady;

  return (
    <div className="p-4 bg-canvas border border-border rounded-card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-main flex items-center gap-1.5">
            <Mic className="w-4 h-4 text-accent" />
            {t('settings:voiceStatus.title')}
          </h3>
          <p className="text-muted mt-0.5">
            <Trans t={t} i18nKey="voiceStatus.intro" components={{ c: <code className="font-mono" /> }} />
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          title={t('voiceStatus.recheck')}
          className="btn-action h-11 w-11 sm:h-8 sm:w-8 flex items-center justify-center shrink-0 disabled:opacity-40"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {info && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">{t('voiceStatus.active')}</dt>
          <dd className="text-main font-semibold">
            {info.mode === 'server'
              ? t('voiceStatus.ownServer')
              : info.mode === 'off'
                ? t('voiceStatus.off')
                : info.demo && info.url
                  ? t('voiceStatus.browserDemo')
                  : t('voiceStatus.browser')}
          </dd>
          {info.url && (
            <>
              <dt className="text-muted">{t('voiceStatus.server')}</dt>
              <dd className="text-main font-mono break-all">{info.url}</dd>
              <dt className="text-muted">{t('voiceStatus.model')}</dt>
              <dd className="text-main font-mono break-all">{info.model}</dd>
            </>
          )}
          {info.mode === 'server' && (
            <>
              <dt className="text-muted">{t('voiceStatus.state')}</dt>
              <dd className="flex items-center gap-1.5">
                {serverOk ? (
                  <span className="text-status-ok flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> {t('voiceStatus.ok')}
                  </span>
                ) : (
                  <span className="text-status-err flex items-center gap-1">
                    <CircleAlert className="w-3.5 h-3.5" />
                    {status?.reachable ? t('voiceStatus.modelMissing') : t('voiceStatus.unreachable')}
                    {status?.error && !status.reachable ? `: ${status.error}` : ''}
                  </span>
                )}
              </dd>
              <dt className="text-muted">{t('voiceStatus.limits')}</dt>
              <dd className="text-main">
                {t('voiceStatus.limitsText', {
                  minutes: Math.round(info.maxSeconds / 60),
                  mb: info.maxUploadMb,
                  parallel: info.maxParallel,
                  perHour: info.perUserPerHour,
                  timeout: info.timeoutSeconds,
                })}
              </dd>
            </>
          )}
        </dl>
      )}

      {info?.mode === 'server' && (
        <div className="pt-2 border-t border-border flex flex-col sm:flex-row sm:items-center gap-2">
          {recording ? (
            <button
              type="button"
              onClick={stopRecording}
              className="btn-danger h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5" /> {t('app:capture.stopRecording')}
            </button>
          ) : (
            <button
              type="button"
              onClick={startTest}
              disabled={testing}
              className="btn-secondary h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              {testing ? <LoaderCircle className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              {testing ? t('app:capture.transcribing') : t('voiceStatus.test', { seconds: TEST_SECONDS })}
            </button>
          )}
          {recording && <span className="text-muted">{t('voiceStatus.speakNow')}</span>}
          {result && (
            <span className="text-main">
              „{result.text || t('voiceStatus.nothing')}“ <span className="text-faint">· {t('voiceStatus.seconds', { value: (result.ms / 1000).toFixed(1) })}</span>
            </span>
          )}
        </div>
      )}

      {error && <p className="text-status-err text-xs">{error}</p>}
    </div>
  );
};
