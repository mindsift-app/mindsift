import React from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert, Calendar, Flame, Layers, LoaderCircle, Mic, MicOff, X } from 'lucide-react';
import { PriorityLevel } from '../lib/types';
import { triggerHaptic } from '../lib/api';
import { VoiceWave } from '../components/VoiceWave';
import { useMobileCapture } from './useMobileCapture';
import { DateField } from '../components/DateField';

// Phones: the Quick Dump sheet (thought with voice input, priority, optional due date)
export function MobileCaptureSheet({ capture }: { capture: ReturnType<typeof useMobileCapture> }) {
  const { t } = useTranslation('app');
  const {
    showMobileCapture,
    setShowMobileCapture,
    mobileTriageContent,
    setMobileTriageContent,
    mobileTriagePriority,
    setMobileTriagePriority,
    mobileTriageDueDate,
    setMobileTriageDueDate,
    mobileVoiceError,
    mobileVoice,
    mobileVoiceActive,
    toggleMobileVoice,
    handleMobileCreateTriage,
  } = capture;
  if (!showMobileCapture) return null;
  return (
    <div
      className="sm:hidden fixed inset-0 !m-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={() => setShowMobileCapture(false)}
    >
      <div
        className="w-full max-h-[85vh] overflow-y-auto bg-panel border-t border-border rounded-t-2xl shadow-panel p-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))] animate-in slide-in-from-bottom duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-btn bg-accent/15 text-accent flex items-center justify-center">
              <Layers className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-semibold text-main">{t('capture.title')}</h3>
          </div>
          <button
            type="button"
            onClick={() => setShowMobileCapture(false)}
            className="p-1.5 text-faint hover:text-main rounded-btn transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleMobileCreateTriage} className="space-y-3">
          {/* Text Input with Voice Dictation */}
          <div>
            <label className="text-[11px] font-semibold text-muted block mb-1">
              {t('capture.textLabel')}
            </label>
            <div className="relative">
              <input
                type="text"
                autoFocus
                value={mobileTriageContent}
                onChange={(e) => setMobileTriageContent(e.target.value)}
                placeholder={
                  mobileVoiceError
                    ? mobileVoiceError
                    : mobileVoiceActive
                      ? t('capture.listening')
                      : mobileVoice.state === 'transcribing'
                        ? t('capture.transcribing')
                        : t('capture.placeholder')
                }
                className={
                  mobileVoiceActive && mobileVoice.mode === 'server'
                    ? 'w-full input-field px-3 py-2 pr-24 text-sm'
                    : 'w-full input-field px-3 py-2 pr-10 text-sm'
                }
              />
              {mobileVoice.available && (
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  {mobileVoiceActive && mobileVoice.mode === 'server' && (
                    <VoiceWave getLevel={mobileVoice.level} bars={7} className="h-4 text-accent" />
                  )}
                  <button
                    type="button"
                    onClick={toggleMobileVoice}
                    disabled={mobileVoice.state === 'transcribing'}
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors cursor-pointer ${
                      mobileVoiceActive
                        ? mobileVoice.mode === 'server'
                          ? 'bg-status-err text-on-accent'
                          : 'bg-accent text-on-accent animate-pulse'
                        : 'text-muted hover:text-main hover:bg-panel-elevated'
                    }`}
                    title={mobileVoiceActive ? t('capture.stopRecording') : t('capture.voiceInput')}
                  >
                    {mobileVoice.state === 'transcribing' ? (
                      <LoaderCircle className="w-4 h-4 animate-spin" />
                    ) : mobileVoiceActive ? (
                      <MicOff className="w-4 h-4" />
                    ) : (
                      <Mic className="w-4 h-4" />
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Priority - 4 Buttons (Identical to TasksView) */}
          <div className="space-y-1.5 pt-1">
            <label className="text-[11px] font-semibold text-muted block">{t('common:priority.label')}</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(['low', 'normal', 'high', 'urgent'] as PriorityLevel[]).map((p) => {
                const config: Record<
                  PriorityLevel,
                  { label: string; icon?: React.ReactNode; activeClass: string }
                > = {
                  low: {
                    label: t('common:priority.low'),
                    activeClass: 'bg-canvas border-strong text-main font-semibold shadow-xs',
                  },
                  normal: {
                    label: t('common:priority.normal'),
                    activeClass: 'bg-accent/15 border-accent text-accent font-semibold shadow-xs',
                  },
                  high: {
                    label: t('common:priority.high'),
                    icon: <TriangleAlert className="w-3 h-3 text-status-warn" />,
                    activeClass:
                      'bg-status-warn/15 border-status-warn text-status-warn font-semibold shadow-xs',
                  },
                  urgent: {
                    label: t('common:priority.urgent'),
                    icon: <Flame className="w-3 h-3 text-status-err" />,
                    activeClass:
                      'bg-status-err/15 border-status-err text-status-err font-semibold shadow-xs',
                  },
                };
                const active = mobileTriagePriority === p;
                const item = config[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => {
                      triggerHaptic(10);
                      setMobileTriagePriority(p);
                    }}
                    className={`h-9 px-1 text-xs rounded-btn font-medium transition-colors border flex items-center justify-center gap-1 cursor-pointer ${
                      active
                        ? item.activeClass
                        : 'bg-canvas border-border text-muted hover:text-main'
                    }`}
                  >
                    {item.icon}
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Due Date (Optional) */}
          <div className="space-y-1 pt-1">
            <label className="text-[11px] font-semibold text-muted flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-accent" />
              <span>{t('capture.dueOptional')}</span>
            </label>
            <DateField
              ariaLabel={t('capture.dueOptional')}
              value={mobileTriageDueDate}
              onChange={setMobileTriageDueDate}
              className="w-full"
              inputClassName="h-11 input-field px-3 text-base sm:text-xs"
            />
          </div>

          {/* Bottom Buttons */}
          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowMobileCapture(false)}
              className="btn-ghost h-10 px-4 text-xs cursor-pointer"
            >
              {t('common:cancel')}
            </button>
            <button
              type="submit"
              disabled={!mobileTriageContent.trim()}
              className="btn-primary h-10 px-5 text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              {t('capture.submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
