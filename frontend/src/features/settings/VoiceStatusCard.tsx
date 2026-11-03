import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Check, Loader2, Mic, RefreshCw, Square } from 'lucide-react';
import { api } from '../../lib/api';
import { VoiceAdminStatus } from '../../lib/types';

const TEST_SECONDS = 6;

// Admin: which speech recognition is active. Configured only by environment (STT_*), so this card
// just shows the state and offers a short test recording through the own Whisper server.
export const VoiceStatusCard: React.FC = () => {
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
    } catch (err: any) {
      setError(err.message || 'Status konnte nicht geladen werden');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
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
      setError('Kein Zugriff auf das Mikrofon (Berechtigung, oder die Seite läuft nicht über HTTPS)');
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
      } catch (err: any) {
        setError(err.message || 'Spracherkennung fehlgeschlagen');
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
            Spracherkennung
          </h3>
          <p className="text-muted mt-0.5">
            Wird nur über Umgebungsvariablen eingestellt (<code className="font-mono">STT_URL</code>,{' '}
            <code className="font-mono">STT_MODEL</code> …); Fehler stehen im Container-Log.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          disabled={loading}
          title="Status neu prüfen"
          className="btn-action h-11 w-11 sm:h-8 sm:w-8 flex items-center justify-center shrink-0 disabled:opacity-40"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {info && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">Aktiv</dt>
          <dd className="text-main font-semibold">
            {info.mode === 'server'
              ? 'Eigener Server (Whisper)'
              : info.mode === 'off'
                ? 'Ausgeschaltet'
                : info.demo && info.url
                  ? 'Browser (in der Demo immer)'
                  : 'Browser (Spracherkennung des Browsers)'}
          </dd>
          {info.url && (
            <>
              <dt className="text-muted">Server</dt>
              <dd className="text-main font-mono break-all">{info.url}</dd>
              <dt className="text-muted">Modell</dt>
              <dd className="text-main font-mono break-all">{info.model}</dd>
              <dt className="text-muted">Sprache</dt>
              <dd className="text-main">{info.language || 'automatisch'}</dd>
            </>
          )}
          {info.mode === 'server' && (
            <>
              <dt className="text-muted">Zustand</dt>
              <dd className="flex items-center gap-1.5">
                {serverOk ? (
                  <span className="text-status-ok flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Erreichbar, Modell geladen
                  </span>
                ) : (
                  <span className="text-status-err flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {status?.reachable ? 'Modell fehlt noch (wird heruntergeladen)' : 'Nicht erreichbar'}
                    {status?.error && !status.reachable ? `: ${status.error}` : ''}
                  </span>
                )}
              </dd>
              <dt className="text-muted">Grenzen</dt>
              <dd className="text-main">
                {Math.round(info.maxSeconds / 60)} Min. bzw. {info.maxUploadMb} MB pro Aufnahme, {info.maxParallel}{' '}
                gleichzeitig, {info.perUserPerHour} pro Person und Stunde, {info.timeoutSeconds} s Zeitlimit
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
              <Square className="w-3.5 h-3.5" /> Aufnahme beenden
            </button>
          ) : (
            <button
              type="button"
              onClick={startTest}
              disabled={testing}
              className="btn-secondary h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5 disabled:opacity-40"
            >
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              {testing ? 'Wird erkannt…' : `Testaufnahme (${TEST_SECONDS} s)`}
            </button>
          )}
          {recording && <span className="text-muted">Sprich jetzt …</span>}
          {result && (
            <span className="text-main">
              „{result.text || '(nichts erkannt)'}“ <span className="text-faint">· {(result.ms / 1000).toFixed(1)} s</span>
            </span>
          )}
        </div>
      )}

      {error && <p className="text-status-err text-xs">{error}</p>}
    </div>
  );
};
