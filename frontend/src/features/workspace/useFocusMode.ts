import { useEffect, useState } from 'react';

// Distraction-free mode of the workspace: state, pinned header/sidebar and the keyboard shortcuts
export function useFocusMode(canFocus: boolean, selectedDocId: string | null) {
  // Distraction-free mode: only the note, full window, as wide as the note with the sidebar hidden
  const [focusMode, setFocusMode] = useState(false);
  // Focus mode: the folder sidebar slides in from the left (button, title click or mouse at the edge)
  const [zenSidebar, setZenSidebar] = useState<'closed' | 'click' | 'hover'>('closed');
  const [zenActionsTarget, setZenActionsTarget] = useState<HTMLDivElement | null>(null);
  // Focus mode: header and sidebar can be pinned so they stay instead of sliding back (kept across sessions)
  const [zenPinTop, setZenPinTop] = useState(() => localStorage.getItem('mindsift_zen_pin_top') === '1');
  const [zenPinSide, setZenPinSide] = useState(() => localStorage.getItem('mindsift_zen_pin_side') === '1');
  useEffect(() => {
    localStorage.setItem('mindsift_zen_pin_top', zenPinTop ? '1' : '0');
    localStorage.setItem('mindsift_zen_pin_side', zenPinSide ? '1' : '0');
  }, [zenPinTop, zenPinSide]);
  const zenSideOpen = zenPinSide || zenSidebar !== 'closed';

  useEffect(() => {
    // Focus mode ends where it is not possible
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!canFocus) setFocusMode(false);
  }, [canFocus]);
  // Leaving focus mode or picking another note closes the sliding sidebar
  useEffect(() => {
    // Leaving focus mode or picking another note closes the sliding sidebar
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZenSidebar('closed');
  }, [focusMode, selectedDocId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f' && canFocus) {
        e.preventDefault();
        setFocusMode((v) => !v);
      } else if (e.key === 'Escape' && focusMode && !e.defaultPrevented) {
        if (zenSidebar !== 'closed') setZenSidebar('closed');
        else setFocusMode(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canFocus, focusMode, zenSidebar]);

  return {
    focusMode,
    setFocusMode,
    zenSidebar,
    setZenSidebar,
    zenActionsTarget,
    setZenActionsTarget,
    zenPinTop,
    setZenPinTop,
    zenPinSide,
    setZenPinSide,
    zenSideOpen,
  };
}
