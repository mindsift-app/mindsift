import { CheckSquare, FileText, Layers, ShoppingCart } from 'lucide-react';
import { DashboardStats, Thought } from '../lib/types';
import { api, triggerHaptic } from '../lib/api';
import { CountBadge } from '../components/CountBadge';
import { HoldToRecordFab } from '../features/capture/HoldToRecordFab';
import { ActiveTab } from './appTabs';

interface MobileNavProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  stats: DashboardStats;
  // The open view's "+" action; without one the + opens the Quick Dump sheet
  primaryAction?: () => void;
  openMobileTriageCapture: () => void;
  handleCaptured: (thought: Thought, target?: 'inbox' | 'task' | 'list_item' | 'document') => void;
}

// Bottom navigation on phones: Triage, Workspace, the + button in the middle (tap: the view's action,
// hold: voice capture into the inbox), Aufgaben, Listen
export function MobileNav({
  activeTab,
  setActiveTab,
  stats,
  primaryAction,
  openMobileTriageCapture,
  handleCaptured,
}: MobileNavProps) {
  return (
    <nav data-mobile-nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 bg-panel/95 backdrop-blur-md border-t border-border px-2 pt-1.5 pb-[calc(0.5rem+env(safe-area-inset-bottom))] grid grid-cols-5 items-center shadow-panel">
      {/* Col 1: Triage */}
      <button
        type="button"
        onClick={() => {
          triggerHaptic(10);
          setActiveTab('triage');
        }}
        className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors relative cursor-pointer active:scale-95 ${
          activeTab === 'triage' ? 'text-accent font-semibold' : 'text-muted hover:text-main'
        }`}
        title="Triage"
      >
        <div className="relative">
          <Layers className="w-5 h-5" />
          <CountBadge count={stats.inboxCount} variant="accent" position="corner" className="-top-1.5 -right-2.5" />
        </div>
        <span className="text-[10px] leading-tight">Triage</span>
      </button>

      {/* Col 2: Workspace */}
      <button
        type="button"
        onClick={() => {
          triggerHaptic(10);
          setActiveTab('workspace');
        }}
        className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors relative cursor-pointer active:scale-95 ${
          activeTab === 'workspace' ? 'text-accent font-semibold' : 'text-muted hover:text-main'
        }`}
        title="Workspace"
      >
        <FileText className="w-5 h-5" />
        <span className="text-[10px] leading-tight">Workspace</span>
      </button>

      {/* Col 3 (EXACT CENTER): + Quick-Add FAB */}
      <div className="flex items-center justify-center">
        <HoldToRecordFab
          onTap={() => {
            triggerHaptic(15);
            if (primaryAction) {
              primaryAction();
            } else {
              openMobileTriageCapture();
            }
          }}
          onTranscript={async (text) => {
            const thought = await api.captureThought(text, 'normal', 'voice', '', { target: 'inbox' });
            handleCaptured(thought, 'inbox');
          }}
        />
      </div>

      {/* Col 4: Aufgaben */}
      <button
        type="button"
        onClick={() => {
          triggerHaptic(10);
          setActiveTab('tasks');
        }}
        className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors relative cursor-pointer active:scale-95 ${
          activeTab === 'tasks' ? 'text-accent font-semibold' : 'text-muted hover:text-main'
        }`}
        title="Aufgaben"
      >
        <div className="relative">
          <CheckSquare className="w-5 h-5" />
          <CountBadge count={stats.tasksOpenCount} variant="accent" position="corner" className="-top-1.5 -right-2.5" />
        </div>
        <span className="text-[10px] leading-tight">Aufgaben</span>
      </button>

      {/* Col 5: Listen */}
      <button
        type="button"
        onClick={() => {
          triggerHaptic(10);
          setActiveTab('lists');
        }}
        className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors relative cursor-pointer active:scale-95 ${
          activeTab === 'lists' ? 'text-accent font-semibold' : 'text-muted hover:text-main'
        }`}
        title="Listen"
      >
        <div className="relative">
          <ShoppingCart className="w-5 h-5" />
          <CountBadge count={stats.listItemsOpenCount} variant="accent" position="corner" className="-top-1.5 -right-2.5" />
        </div>
        <span className="text-[10px] leading-tight">Listen</span>
      </button>
    </nav>
  );
}
