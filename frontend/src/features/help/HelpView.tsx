import React, { useMemo, useState } from 'react';
import {
  Search,
  Layers,
  FileText,
  CheckSquare,
  Keyboard,
  Sparkles,
  Users,
  ShoppingCart,
  ArrowLeft,
  X,
} from 'lucide-react';
import { AboutModal } from '../../components/AboutModal';
import { Trans, useTranslation } from 'react-i18next';
import { helpContent } from './content';
import type { DocCard, HelpCategory } from './content/types';
import { NO_AUTOFILL } from '../../lib/noAutofill';

interface HelpViewProps {
  onBack?: () => void;
}

export const HelpView: React.FC<HelpViewProps> = ({ onBack }) => {
  const [activeCategory, setActiveCategory] = useState<HelpCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAbout, setShowAbout] = useState(false);

  // Documentation sections & cards data
  // Cards and shortcuts in the language shown (content/<code>.tsx)
  const { t, i18n: i18nInstance } = useTranslation('help');
  const content = helpContent(i18nInstance.language);
  const cards: DocCard[] = content.cards;

  // Filtered cards based on active category & search query
  const filteredCards = useMemo(() => {
    let result = cards;
    if (activeCategory !== 'all' && activeCategory !== 'shortcuts') {
      result = result.filter((card) => card.category === activeCategory);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter((card) => {
        const titleMatch = card.title.toLowerCase().includes(q);
        const subMatch = card.subtitle?.toLowerCase().includes(q) || false;
        const kwMatch = card.keywords.some((kw) => kw.toLowerCase().includes(q));
        return titleMatch || subMatch || kwMatch;
      });
    }

    return result;
  }, [cards, activeCategory, searchQuery]);

  // Keyboard shortcuts table data
  const shortcuts = content.shortcuts;

  const filteredShortcuts = useMemo(() => {
    if (!searchQuery.trim()) return shortcuts;
    const q = searchQuery.toLowerCase().trim();
    return shortcuts.filter(
      (s) =>
        s.key.toLowerCase().includes(q) ||
        s.scope.toLowerCase().includes(q) ||
        s.desc.toLowerCase().includes(q)
    );
  }, [shortcuts, searchQuery]);

  return (
    <div className="w-full space-y-4 pb-12">
      {/* Header Bar */}
      <div className="panel-surface p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="btn-icon"
              title={t('back')}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <div>
            <h1 className="text-base sm:text-lg font-bold text-main flex items-center gap-2">
              <FileText className="w-4 h-4 text-accent" />
              <span>{t('title')}</span>
            </h1>
            <p className="text-xs text-muted">
              {t('subtitle')}
            </p>
          </div>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            {...NO_AUTOFILL}
            placeholder={t('search')}
            className="w-full h-8 pl-8 pr-8 input-field text-xs bg-canvas"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-main"
              title={t('clearSearch')}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Category Filter Pills */}
      <div className="flex flex-wrap items-center gap-1.5">
        {[
          { id: 'all', label: t('cat.all'), icon: Sparkles },
          { id: 'workspace', label: t('cat.workspace'), icon: FileText },
          { id: 'triage', label: t('cat.triage'), icon: Layers },
          { id: 'tasks', label: t('cat.tasks'), icon: CheckSquare },
          { id: 'lists', label: t('cat.lists'), icon: ShoppingCart },
          { id: 'collaboration', label: t('cat.collaboration'), icon: Users },
          { id: 'shortcuts', label: t('cat.shortcuts'), icon: Keyboard },
        ].map((cat) => {
          const Icon = cat.icon;
          const isActive = activeCategory === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id as HelpCategory)}
              className={`h-8 px-3 text-xs font-medium border rounded-btn flex items-center gap-1.5 transition-colors cursor-pointer ${
                isActive
                  ? 'bg-panel-elevated border-accent text-main font-semibold'
                  : 'bg-panel border-border text-muted hover:text-main'
              }`}
            >
              <Icon className="w-3.5 h-3.5 text-accent" />
              <span>{cat.label}</span>
            </button>
          );
        })}
      </div>

      {/* Active Search Status Banner */}
      {searchQuery && (
        <div className="flex items-center justify-between text-xs text-muted px-1">
          <span>
            <Trans
              t={t}
              i18nKey="results"
              values={{ query: searchQuery, count: filteredCards.length }}
              components={{ b: <strong className="text-main" /> }}
            />
            {activeCategory === 'all' || activeCategory === 'shortcuts' ? `, ${t('shortcutCount', { count: filteredShortcuts.length })}` : ''}
          </span>
          <button
            type="button"
            onClick={() => setSearchQuery('')}
            className="text-accent hover:underline cursor-pointer"
          >
            {t('reset')}
          </button>
        </div>
      )}

      {/* Grid of Documentation Cards */}
      {activeCategory !== 'shortcuts' && (
        <div className="space-y-4">
          {filteredCards.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredCards.map((card) => {
                const Icon = card.icon;
                return (
                  <div
                    key={card.id}
                    className="panel-surface p-4 rounded-card border border-border flex flex-col justify-between space-y-3"
                  >
                    <div>
                      <div className="flex items-start gap-2.5 mb-2">
                        <div className="p-1.5 bg-canvas border border-border rounded-btn shrink-0 mt-0.5">
                          <Icon className="w-4 h-4 text-accent" />
                        </div>
                        <div>
                          <h3 className="font-bold text-main text-sm">{card.title}</h3>
                          {card.subtitle && (
                            <p className="text-[11px] text-muted">{card.subtitle}</p>
                          )}
                        </div>
                      </div>
                      <div className="text-xs pt-1">{card.content}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="panel-surface p-8 text-center space-y-2 border border-border rounded-card">
              <Search className="w-6 h-6 text-muted mx-auto" />
              <p className="text-sm font-semibold text-main">{t('none')}</p>
              <p className="text-xs text-muted">
                {t('noneHint')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* SHORTCUTS CHEAT SHEET */}
      {(activeCategory === 'all' || activeCategory === 'shortcuts') && (
        <div className="panel-surface p-5 space-y-4 rounded-card border border-border">
          <div className="border-b border-border pb-2.5 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold text-main flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-accent" />
                <span>{t('shortcutsTitle')}</span>
              </h2>
              <p className="text-xs text-muted mt-0.5">
                {t('shortcutsIntro')}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border text-muted">
                  <th className="py-2 px-3 font-semibold w-1/3">{t('col.key')}</th>
                  <th className="py-2 px-3 font-semibold w-1/4">{t('col.scope')}</th>
                  <th className="py-2 px-3 font-semibold">{t('col.desc')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-main">
                {filteredShortcuts.map((sc, i) => (
                  <tr key={i} className="hover:bg-canvas/50 transition-colors">
                    <td className="py-2 px-3 font-mono text-accent font-medium">{sc.key}</td>
                    <td className="py-2 px-3 text-muted">
                      <span className="px-1.5 py-0.5 bg-canvas border border-border rounded text-[11px]">
                        {sc.scope}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-main">{sc.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex justify-center pt-2">
        <button type="button" onClick={() => setShowAbout(true)} className="text-[11px] text-muted hover:text-main hover:underline underline-offset-2">
          {t('common:aboutMindSift')}
        </button>
      </div>
      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  );
};
