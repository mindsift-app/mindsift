import React from 'react';
import { Check, X } from 'lucide-react';
import { useMobileActions } from '../context/MobileActionContext';
import { triggerHaptic } from '../lib/api';
import { CountBadge } from './CountBadge';

interface MobileHeaderMenuProps {
  activeTabLabel: string;
}

export const MobileHeaderMenu: React.FC<MobileHeaderMenuProps> = ({ activeTabLabel }) => {
  const { groups, isMenuOpen, closeMenu } = useMobileActions();

  if (!isMenuOpen) return null;

  return (
    <div className="sm:hidden fixed inset-0 !m-0 z-50">
      {/* Backdrop */}
      <div
        className="fixed inset-0 !m-0 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
        onClick={() => {
          triggerHaptic(8);
          closeMenu();
        }}
      />

      {/* Menu Sheet below Header */}
      <div className="fixed top-14 left-2.5 right-2.5 max-h-[80vh] overflow-y-auto bg-panel border border-border rounded-2xl shadow-2xl p-3 space-y-3.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
        {/* Menu Header */}
        <div className="flex items-center justify-between px-2 pb-2 border-b border-border">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-accent"></span>
            <span className="text-xs font-bold uppercase tracking-wider text-muted">
              {activeTabLabel} — Optionen & Aktionen
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              triggerHaptic(8);
              closeMenu();
            }}
            className="w-9 h-9 rounded-xl flex items-center justify-center text-muted hover:text-main hover:bg-canvas active:scale-95 transition-all"
            title="Menü schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {groups.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted">
            Keine spezifischen Optionen für diese Ansicht verfügbar.
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => (
              <div key={group.id} className="space-y-1.5">
                {group.title && (
                  <div className="px-2 text-[11px] font-bold uppercase tracking-wider text-faint">
                    {group.title}
                  </div>
                )}
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isAccent = item.variant === 'accent';
                    const isDanger = item.variant === 'danger';
                    const isActive = item.active;

                    let btnClass =
                      'bg-canvas/70 hover:bg-canvas text-main border border-border/60';
                    if (isAccent) {
                      btnClass =
                        'bg-accent text-on-accent border border-accent font-semibold shadow-sm';
                    } else if (isDanger) {
                      btnClass =
                        'bg-status-err/10 text-status-err border border-status-err/30 font-medium';
                    } else if (isActive) {
                      btnClass =
                        'bg-accent/15 text-accent border border-accent/40 font-semibold';
                    }

                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          triggerHaptic(12);
                          closeMenu();
                          item.onClick();
                        }}
                        className={`w-full min-h-[46px] px-3.5 py-2.5 rounded-xl flex items-center justify-between gap-3 text-sm transition-all active:scale-[0.98] cursor-pointer ${btnClass}`}
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1 text-left">
                          {item.icon && (
                            <span
                              className={`flex-shrink-0 flex items-center justify-center w-5 h-5 ${
                                isAccent
                                  ? 'text-on-accent'
                                  : isDanger
                                  ? 'text-status-err'
                                  : isActive
                                  ? 'text-accent'
                                  : 'text-muted'
                              }`}
                            >
                              {item.icon}
                            </span>
                          )}
                          <span className="truncate">{item.label}</span>
                        </div>

                        <div className="flex items-center gap-2 flex-shrink-0">
                          {typeof item.badge === 'number' && !isAccent ? (
                            <CountBadge count={item.badge} showZero variant={isActive ? 'accent' : 'muted'} />
                          ) : item.badge !== undefined && item.badge !== '' && (
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-mono font-semibold ${
                                isAccent
                                  ? 'bg-black/20 text-on-accent'
                                  : isActive
                                  ? 'bg-accent/20 text-accent'
                                  : 'bg-panel text-muted border border-border'
                              }`}
                            >
                              {item.badge}
                            </span>
                          )}
                          {isActive && !isAccent && (
                            <Check className="w-4 h-4 text-accent flex-shrink-0" />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
