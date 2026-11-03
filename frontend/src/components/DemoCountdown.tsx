import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface DemoCountdownProps {
  deadline: number; // ms timestamp of the next reset, in this browser's clock
  minutes?: number;
  className?: string;
  onElapsed?: () => void;
}

const fmt = (ms: number) => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

// "✨ Demo · Reset in MM:SS" in place of the version under the app name while the demo mode resets itself
export const DemoCountdown: React.FC<DemoCountdownProps> = ({ deadline, minutes, className = '', onElapsed }) => {
  const { t } = useTranslation('app');
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const left = deadline - now;
  useEffect(() => {
    if (left <= 0) onElapsed?.();
    // Runs when the deadline passes, not on every tick
  }, [left <= 0, deadline]);

  return (
    <span
      className={`font-mono leading-tight text-accent ${className}`}
      title={t('demo.resetEvery', { count: minutes || 20 })}
    >
      {t('demo.label')} {left > 0 ? t('demo.resetIn', { time: fmt(left) }) : t('demo.resetting')}
    </span>
  );
};
