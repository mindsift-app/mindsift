import React from 'react';
import { DATA_SECTIONS, DataSection } from '../../lib/types';
import { ToggleSwitch } from '../../components/ToggleSwitch';

interface SectionPickerProps {
  value: DataSection[];
  onChange: (sections: DataSection[]) => void;
  label?: string;
}

// Which parts of the own data a restore or import covers; one switch per section, at least one stays on
export const SectionPicker: React.FC<SectionPickerProps> = ({ value, onChange, label = 'Bereiche' }) => (
  <div role="group" aria-label={label}>
    <p className="text-[11px] text-muted mb-1.5">{label}</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 border border-border rounded-card px-3 py-1.5 bg-panel">
      {DATA_SECTIONS.map((sec) => {
        const on = value.includes(sec.id);
        return (
          <div key={sec.id} className="flex items-center justify-between gap-3 min-h-[44px] sm:min-h-[36px]">
            <span className="text-xs text-main">{sec.label}</span>
            <ToggleSwitch
              checked={on}
              title={sec.label}
              onChange={() => {
                const next = on ? value.filter((v) => v !== sec.id) : [...value, sec.id];
                if (next.length > 0) onChange(next);
              }}
            />
          </div>
        );
      })}
    </div>
  </div>
);
