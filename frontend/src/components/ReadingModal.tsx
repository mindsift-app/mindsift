import React, { useEffect } from 'react';
import { X } from 'lucide-react';

interface ReadingModalProps {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

// Slim modal for reading text (legal notices, about); Escape or backdrop click closes it
export const ReadingModal: React.FC<ReadingModalProps> = ({ title, onClose, children }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="panel-surface w-full max-w-2xl max-h-[85vh] flex flex-col shadow-panel">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-bold text-main">{title}</h2>
          <button type="button" onClick={onClose} className="btn-icon" title="Schließen">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto text-sm text-main">{children}</div>
      </div>
    </div>
  );
};
