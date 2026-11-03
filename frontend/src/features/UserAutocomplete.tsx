import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Check } from 'lucide-react';
import { User } from '../lib/types';
import { UserAvatar } from '../components/UserAvatar';

// Shared type-to-search for picking people (sharing, groups, task assignees). Nothing is listed until
// something is typed, then at most MAX_RESULTS matches appear below the field. See Doku/ui-patterns.md.
const MAX_RESULTS = 3;

interface UserAutocompleteProps {
  users: User[];
  selectedUser: User | null;
  onSelectUser: (user: User | null) => void;
  placeholder?: string;
  disabled?: boolean;
  excludeUserIds?: string[];
  className?: string;
}

export const UserAutocomplete: React.FC<UserAutocompleteProps> = ({
  users,
  selectedUser,
  onSelectUser,
  placeholder = 'Benutzer suchen (Name, @Benutzername oder E-Mail)…',
  disabled = false,
  excludeUserIds = [],
  className = '',
}) => {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter users based on query and exclusions
  const filteredUsers = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const available = users.filter((u) => !excludeUserIds.includes(u.id));
    return available
      .filter((u) => {
        const nameMatch = (u.displayName || '').toLowerCase().includes(q);
        const emailMatch = (u.email || '').toLowerCase().includes(q);
        const userMatch = (u.username || '').toLowerCase().includes(q);
        return nameMatch || emailMatch || userMatch;
      })
      .slice(0, MAX_RESULTS);
  }, [users, query, excludeUserIds]);
  const showResults = isOpen && query.trim() !== '';

  const handleSelect = (user: User) => {
    onSelectUser(user);
    setQuery('');
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleClear = () => {
    onSelectUser(null);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showResults) {
      if (e.key === 'ArrowDown') {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev < filteredUsers.length - 1 ? prev + 1 : 0
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) =>
        prev > 0 ? prev - 1 : filteredUsers.length - 1
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (highlightedIndex >= 0 && highlightedIndex < filteredUsers.length) {
        handleSelect(filteredUsers[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {selectedUser ? (
        <div className="h-11 sm:h-8 px-2.5 bg-panel-elevated border border-accent/40 rounded-btn flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 min-w-0">
            <UserAvatar user={selectedUser} size="xs" />
            <span className="font-semibold text-main truncate">
              {selectedUser.displayName || selectedUser.email}
            </span>
            {selectedUser.username && (
              <span className="text-[11px] text-muted truncate">
                @{selectedUser.username}
              </span>
            )}
            {selectedUser.email && selectedUser.displayName && (
              <span className="text-[11px] text-muted truncate hidden sm:inline">
                ({selectedUser.email})
              </span>
            )}
          </div>
          {!disabled && (
            <button
              type="button"
              onClick={handleClear}
              className="text-muted hover:text-main p-0.5 rounded hover:bg-canvas transition-colors"
              title="Auswahl aufheben"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            disabled={disabled}
            onChange={(e) => {
              setQuery(e.target.value);
              setIsOpen(true);
              // First match is preselected so Enter picks it right away
              setHighlightedIndex(0);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="w-full h-11 sm:h-8 pl-8 pr-2.5 bg-input text-main border border-border rounded-btn focus:outline-none focus:border-accent text-base sm:text-xs placeholder:text-muted transition-colors disabled:opacity-50"
          />

          {showResults && (
            <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-panel border border-border rounded-card shadow-panel py-1 space-y-0.5">
              {filteredUsers.length === 0 ? (
                <div className="p-3 text-xs text-muted text-center">
                  Kein passender Benutzer gefunden
                </div>
              ) : (
                filteredUsers.map((u, idx) => {
                  const isHighlighted = idx === highlightedIndex;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => handleSelect(u)}
                      onMouseEnter={() => setHighlightedIndex(idx)}
                      className={`w-full min-h-11 sm:min-h-0 px-2.5 py-1.5 flex items-center justify-between gap-2 text-left text-xs transition-colors cursor-pointer ${
                        isHighlighted
                          ? 'bg-accent/15 text-main font-medium'
                          : 'hover:bg-panel-elevated text-main'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <UserAvatar user={u} size="xs" />
                        <div className="truncate">
                          <span className="font-semibold text-main">
                            {u.displayName || u.email}
                          </span>
                          {u.username && (
                            <span className="ml-1 text-[11px] text-muted">
                              @{u.username}
                            </span>
                          )}
                          {u.email && u.displayName && (
                            <span className="ml-1.5 text-[10px] text-muted truncate">
                              {u.email}
                            </span>
                          )}
                        </div>
                      </div>
                      {isHighlighted && (
                        <Check className="w-3.5 h-3.5 text-accent shrink-0" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
