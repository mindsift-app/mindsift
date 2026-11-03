import React, { useEffect, useRef } from 'react';

interface VoiceWaveProps {
  /** Input level 0..1; null (unknown, e.g. browser recognition) shows a calm idle wave. */
  getLevel: () => number | null;
  bars?: number;
  /** Bar colour and size come from the caller, e.g. "h-4 text-accent". */
  className?: string;
}

// Live wave reacting to the voice. Heights are set directly on the bars every frame, so React does
// not re-render 60 times a second.
export const VoiceWave: React.FC<VoiceWaveProps> = ({ getLevel, bars = 5, className = 'h-4 text-accent' }) => {
  const barRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const getLevelRef = useRef(getLevel);
  getLevelRef.current = getLevel;

  useEffect(() => {
    const history: number[] = new Array(bars).fill(0);
    let frame = 0;
    let raf = 0;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const tick = () => {
      frame++;
      const measured = getLevelRef.current();
      const level = measured ?? 0.25 + 0.2 * Math.sin(frame / 9);
      // Newest level enters in the middle and travels outwards
      if (frame % 3 === 0) {
        history.pop();
        history.unshift(level);
      }
      const mid = Math.floor(bars / 2);
      barRefs.current.forEach((el, i) => {
        if (!el) return;
        const v = reduceMotion ? 0.5 : history[Math.abs(i - mid)] ?? 0;
        el.style.transform = `scaleY(${Math.max(0.15, Math.min(1, v * 1.4))})`;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [bars]);

  return (
    <span className={`inline-flex items-center gap-[3px] ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            barRefs.current[i] = el;
          }}
          className="w-[3px] h-full rounded-full bg-current origin-center transition-transform duration-75"
          style={{ transform: 'scaleY(0.15)' }}
        />
      ))}
    </span>
  );
};
