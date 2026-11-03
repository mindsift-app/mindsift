import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Hash, Search, X } from 'lucide-react';
import { TagSummary } from '../../lib/types';

// What the tiles know about a hashtag: notes it occurs in and their open to-dos
export type TagMeta = {
  tag: string;
  count: number;
  docs: { id: string; title: string; icon?: string; folderPath?: string }[];
  openTodosCount: number;
};

interface HashtagOverviewProps {
  filteredTags: TagSummary[];
  tagsSummary: TagSummary[];
  tagsMetadataMap: Map<string, TagMeta>;
  handleSelectTag: (tag: string) => void;
  tagSearchQuery: string;
  setTagSearchQuery: (q: string) => void;
  tagSortBy: 'count' | 'name';
  setTagSortBy: (sort: 'count' | 'name') => void;
}

// Hashtag overview of the workspace: tiles with search and sorting; a tile opens the hashtag page
export function HashtagOverview({
  filteredTags,
  tagsSummary,
  tagsMetadataMap,
  handleSelectTag,
  tagSearchQuery,
  setTagSearchQuery,
  tagSortBy,
  setTagSortBy,
}: HashtagOverviewProps) {
  const { t } = useTranslation('workspace');
  return (
    /* =========================================================================
       HASHTAG OVERVIEW & TILE DIRECTORY (KACHEL-ANSICHT MIT SUCHE)
       ========================================================================= */
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-canvas">
      <div className="w-full space-y-5">
        {/* Header with Title and Search Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Hash className="w-5 h-5 text-accent" />
              <h1 className="text-xl font-bold text-main">{t('hashtags.title')}</h1>
              <span className="badge-neutral text-xs font-mono">{t('hashtags.tagCount', { count: tagsSummary.length })}</span>
            </div>
            <p className="text-xs text-muted mt-0.5">
              {t('hashtags.intro')}
            </p>
          </div>

          {/* Search & Sort Toolbar */}
          <div className="flex items-center gap-2">
            <div className="relative min-w-[200px] sm:min-w-[240px]">
              <Search className="w-3.5 h-3.5 text-faint absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={tagSearchQuery}
                onChange={(e) => setTagSearchQuery(e.target.value)}
                placeholder={t('hashtags.search')}
                className="input-field w-full pl-8 pr-7 py-1.5 text-xs"
              />
              {tagSearchQuery && (
                <button
                  type="button"
                  onClick={() => setTagSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-faint hover:text-main cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Sort Mode Switcher */}
            <div className="flex items-center bg-canvas border border-border rounded-btn p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setTagSortBy('count')}
                className={`px-2 py-1 rounded-btn font-semibold transition-colors cursor-pointer ${
                  tagSortBy === 'count'
                    ? 'bg-panel-elevated text-main shadow-xs'
                    : 'text-muted hover:text-main'
                }`}
                title={t('hashtags.byCount')}
              >
                {t('hashtags.count')}
              </button>
              <button
                type="button"
                onClick={() => setTagSortBy('name')}
                className={`px-2 py-1 rounded-btn font-semibold transition-colors cursor-pointer ${
                  tagSortBy === 'name'
                    ? 'bg-panel-elevated text-main shadow-xs'
                    : 'text-muted hover:text-main'
                }`}
                title={t('hashtags.byAlpha')}
              >
                {t('workspace:hashtags.az')}
              </button>
            </div>
          </div>
        </div>

        {/* Grid of Hashtag Tiles (Kacheln) */}
        {filteredTags.length === 0 ? (
          <div className="p-12 text-center text-muted text-xs space-y-2 border border-border rounded-card bg-canvas">
            <Hash className="w-8 h-8 text-faint mx-auto" />
            <p className="font-semibold text-main text-sm">
              {tagSearchQuery
                ? t('hashtags.noneFor', { query: tagSearchQuery })
                : t('hashtags.none')}
            </p>
            <p className="text-faint max-w-sm mx-auto">
              {tagSearchQuery
                ? t('hashtags.tryOther')
                : t('hashtags.hint')}
            </p>
            {tagSearchQuery && (
              <button
                type="button"
                onClick={() => setTagSearchQuery('')}
                className="btn-action inline-flex items-center gap-1 px-3 py-1 text-xs text-accent mt-2 cursor-pointer"
              >
                {t('hashtags.reset')}
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-3.5">
            {/* As many columns as fit with at least 18rem each, so tag names and note titles have room */}
            {filteredTags.map((tag) => {
              const meta = tagsMetadataMap.get(tag.tag.toLowerCase());
              return (
                <div
                  key={tag.tag}
                  onClick={() => handleSelectTag(tag.tag)}
                  className="p-4 rounded-card border border-border bg-panel hover:border-accent hover:bg-panel-elevated transition-all cursor-pointer group flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="w-7 h-7 rounded-btn bg-accent/10 border border-accent/20 text-accent font-bold flex items-center justify-center shrink-0 text-sm group-hover:bg-accent group-hover:text-on-accent transition-colors">
                          #
                        </span>
                        <h3 className="font-bold text-sm text-main group-hover:text-accent transition-colors truncate">
                          {tag.tag.replace(/^#/, '')}
                        </h3>
                      </div>
                      <span className="badge-neutral font-mono text-[10px] shrink-0">
                        {t('hashtags.hits', { count: tag.count })}
                      </span>
                    </div>

                    {meta && meta.docs.length > 0 && (
                      <div className="space-y-1">
                        <span className="text-[10px] font-semibold text-faint uppercase tracking-wider block">
                          {t('hashtags.latest')}
                        </span>
                        <div
                          className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-btn bg-panel-elevated text-main truncate max-w-full"
                          title={meta.docs[0].title}
                        >
                          {meta.docs[0].icon && <span>{meta.docs[0].icon}</span>}
                          <span className="truncate">{meta.docs[0].title || t('editor.untitled')}</span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-2.5 border-t border-border/50 text-[11px]">
                    <div>
                      {meta && meta.openTodosCount > 0 && (
                        <span className="text-status-warn text-[10px] flex items-center gap-1 font-medium">
                          <Check className="w-2.5 h-2.5" />
                          {t('hashtags.openTodos', { count: meta.openTodosCount })}
                        </span>
                      )}
                    </div>
                    <span className="text-accent text-xs font-semibold group-hover:translate-x-0.5 transition-transform flex items-center gap-0.5">
                      <span>{t('hashtags.details')}</span>
                      <span>→</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
