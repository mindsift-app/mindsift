import React from 'react';

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
  disabled?: boolean;
}

// On/off switch for settings; used instead of checkboxes (Doku/ui-patterns.md)
export const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ checked, onChange, title, disabled = false }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-pill border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-50 disabled:cursor-default ${
      checked ? 'bg-accent' : 'bg-panel-elevated border border-border'
    }`}
    title={title}
  >
    <span
      aria-hidden="true"
      className={`pointer-events-none inline-block h-5 w-5 transform rounded-pill bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
        checked ? 'translate-x-5' : 'translate-x-0'
      }`}
    />
  </button>
);
