import { useId } from 'react';
import { useTranslation } from 'react-i18next';

interface NewPasswordFieldsProps {
  value: string;
  onChange: (value: string) => void;
  repeat: string;
  onRepeatChange: (value: string) => void;
  label: string;
  repeatLabel: string;
  placeholder?: string;
  repeatPlaceholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
  /** Layout of the two fields, e.g. two columns from sm on */
  className?: string;
  labelClassName?: string;
  /** Height, padding and font size of the fields, as the form around them has them */
  inputClassName: string;
}

/**
 * A new password and its repetition (Doku/ui-patterns.md, "New Password"): as soon as the repetition differs
 * it is framed red with the hint below it. The form checks both with `passwordPairProblem` (lib/password.ts)
 * before it sends.
 */
export function NewPasswordFields({
  value,
  onChange,
  repeat,
  onRepeatChange,
  label,
  repeatLabel,
  placeholder,
  repeatPlaceholder,
  autoFocus,
  disabled,
  className = 'space-y-3',
  labelClassName = 'block text-muted font-medium',
  inputClassName,
}: NewPasswordFieldsProps) {
  const { t } = useTranslation('auth');
  const hintId = useId();
  const mismatch = repeat !== '' && value !== repeat;
  const input = `mt-1 w-full input-field disabled:opacity-60 ${inputClassName}`;
  return (
    <div className={className}>
      <label className={labelClassName}>
        {label}
        <input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoFocus={autoFocus}
          disabled={disabled}
          required
          autoComplete="new-password"
          className={input}
        />
      </label>
      <div>
        <label className={labelClassName}>
          {repeatLabel}
          <input
            type="password"
            value={repeat}
            onChange={(e) => onRepeatChange(e.target.value)}
            placeholder={repeatPlaceholder}
            disabled={disabled}
            required
            autoComplete="new-password"
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? hintId : undefined}
            className={`${input} ${mismatch ? 'border-status-err focus:border-status-err' : ''}`}
          />
        </label>
        {mismatch && (
          <span id={hintId} className="text-[10px] text-status-err mt-1 block" data-password-mismatch>
            {t('password.noMatch')}
          </span>
        )}
      </div>
    </div>
  );
}
