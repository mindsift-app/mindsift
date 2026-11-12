import { Trans, useTranslation } from 'react-i18next';
import { TourStepId } from './tourSteps';
import { LinkedTaskDemo, SlashDemo, TriageDemo } from './TourDemos';

interface TourContentProps {
  step: TourStepId;
  // Phone layout (below sm): other controls, other words
  phone: boolean;
  // data-tour name of the control the card points at ('' without one)
  target: string;
}

const kbd = <kbd className="px-1 py-px bg-canvas border border-border rounded-btn font-mono text-[11px] text-main" />;
const b = <strong className="text-main" />;

// Title of a step (heading of the card)
export function TourTitle({ step }: { step: TourStepId }) {
  const { t } = useTranslation('tour');
  const titles: Record<TourStepId, string> = {
    triage: t('triage.title'),
    notes: t('notes.title'),
    linked: t('linked.title'),
    focus: t('focus.title'),
    tasks: t('tasks.title'),
    search: t('search.title'),
    end: t('end.title'),
  };
  return <>{titles[step]}</>;
}

// What the card says at a step, with its little example where there is one
export function TourContent({ step, phone, target }: TourContentProps) {
  const { t } = useTranslation('tour');
  const text = (key: string, values?: Record<string, string>) => (
    <p>
      <Trans t={t} i18nKey={key} values={values} components={{ b, kbd }} />
    </p>
  );
  switch (step) {
    case 'triage':
      return (
        <>
          {text(phone ? 'triage.capturePhone' : 'triage.capture')}
          <TriageDemo />
          {text(phone ? 'triage.decidePhone' : 'triage.decide')}
        </>
      );
    case 'notes':
      return (
        <>
          {text('notes.text')}
          <SlashDemo />
          {target === 'new-note' && text('notes.empty')}
          {target === 'note-list' && text('notes.phoneList')}
        </>
      );
    case 'linked':
      return (
        <>
          {text('linked.text')}
          <LinkedTaskDemo />
          {text('linked.badge', { badge: t('workspace:block.badgeTask'), back: t('tasks:row.inNote') })}
        </>
      );
    case 'focus':
      return target === 'focus-mode'
        ? text('focus.button')
        : text('focus.menu', { item: t('workspace:editor.startFocusTitle') });
    case 'tasks':
      return text(phone ? 'tasks.textPhone' : 'tasks.text');
    case 'search':
      return text(phone ? 'search.textPhone' : 'search.text');
    case 'end':
      return (
        <>
          {text(phone ? 'end.textPhone' : 'end.text')}
          {text('end.share')}
        </>
      );
  }
}
