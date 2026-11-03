import React, { createContext, useContext, useState, useCallback } from 'react';

export interface MobileActionItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  badge?: string | number;
  variant?: 'default' | 'accent' | 'danger';
  active?: boolean;
  onClick: () => void;
}

export interface MobileMenuGroup {
  id: string;
  title?: string;
  items: MobileActionItem[];
}

interface MobileActionContextValue {
  groups: MobileMenuGroup[];
  setGroups: (groups: MobileMenuGroup[]) => void;
  isMenuOpen: boolean;
  setIsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  closeMenu: () => void;
  primaryAction?: () => void;
  setPrimaryAction: (fn?: () => void) => void;
}

const MobileActionContext = createContext<MobileActionContextValue>({
  groups: [],
  setGroups: () => {},
  isMenuOpen: false,
  setIsMenuOpen: () => {},
  closeMenu: () => {},
  primaryAction: undefined,
  setPrimaryAction: () => {},
});

export const MobileActionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [groups, setGroupsState] = useState<MobileMenuGroup[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [primaryAction, setPrimaryActionState] = useState<(() => void) | undefined>(undefined);

  const setGroups = useCallback((newGroups: MobileMenuGroup[]) => {
    setGroupsState(newGroups);
  }, []);

  const closeMenu = useCallback(() => {
    setIsMenuOpen(false);
  }, []);

  const setPrimaryAction = useCallback((fn?: () => void) => {
    setPrimaryActionState(() => fn);
  }, []);

  return (
    <MobileActionContext.Provider
      value={{
        groups,
        setGroups,
        isMenuOpen,
        setIsMenuOpen,
        closeMenu,
        primaryAction,
        setPrimaryAction,
      }}
    >
      {children}
    </MobileActionContext.Provider>
  );
};

export const useMobileActions = () => useContext(MobileActionContext);
