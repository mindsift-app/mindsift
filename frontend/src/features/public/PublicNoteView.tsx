import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, Home, Lock, LinkIcon } from 'lucide-react';
import { OutlinerTree } from '../workspace/OutlinerTree';
import { computeBreadcrumbs, getZoomedSubtree } from '../workspace/zoom';
import { readableMentions } from '../../lib/mentions';
import { DocumentBlock } from '../../lib/types';
import { docFromSnapshot } from '../../lib/docSync/model';
import { toDocumentBlocks } from '../../lib/docSync/diff';
import { fetchPublicNote, PublicNote, setPublicAccess, storedPublicKey, unlockPublicNote } from '../../lib/publicNote';
import { PublicThemePicker } from './PublicThemePicker';
import { formatDateTime } from '../../lib/format';
import { NO_AUTOFILL } from '../../lib/noAutofill';

// How often the page asks for changes while it is visible (a 204 when nothing happened)
const POLL_MS = 4000;

const noop = () => {};

/** A note shared by public link (/p/<token>): read only, looks like the editor in focus mode, in the
 *  default theme or the one the visitor picks (PublicThemePicker), and follows changes live. */
export const PublicNoteView: React.FC<{ token: string }> = ({ token }) => {
  const { t } = useTranslation('public');
  const [key, setKey] = useState(() => storedPublicKey(token));
  const [phase, setPhase] = useState<'loading' | 'locked' | 'gone' | 'ok'>('loading');
  const [note, setNote] = useState<PublicNote | null>(null);
  // Folding is the visitor's own: kept here, never sent anywhere
  const [collapsed, setCollapsed] = useState<Map<string, boolean>>(new Map());
  const headRef = useRef<number | undefined>(undefined);

  const load = useCallback(async () => {
    setPublicAccess(token, key);
    try {
      const res = await fetchPublicNote(token, key, headRef.current);
      if (res.status === 'unchanged') return;
      if (res.status === 'ok') {
        headRef.current = res.note.headSeq;
        setNote(res.note);
        setPhase('ok');
      } else {
        headRef.current = undefined;
        setPhase(res.status);
      }
    } catch {
      // offline for a moment: keep what is shown and try again on the next round
    }
  }, [token, key]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useEffect(() => {
    document.title = note ? `${note.icon ? note.icon + ' ' : ''}${note.title || t('untitled')}` : 'MindSift';
  }, [note, t]);

  const blocks = useMemo<DocumentBlock[]>(() => {
    if (!note) return [];
    const doc = docFromSnapshot(note.title, note.titleVersion, note.blocks);
    return toDocumentBlocks(doc, 'public').map((b) => (collapsed.has(b.id) ? { ...b, collapsed: collapsed.get(b.id) } : b));
  }, [note, collapsed]);

  // Zoomed into a bullet like in the app (a click on its dot); the path above leads back
  const [zoomedId, setZoomedId] = useState<string | null>(null);
  const zoom = useMemo(() => getZoomedSubtree(blocks, zoomedId), [blocks, zoomedId]);
  const trail = useMemo(() => computeBreadcrumbs(note?.title || t('untitled'), blocks, zoom.zoomedBlock ? zoomedId : null), [note?.title, blocks, zoomedId, zoom.zoomedBlock, t]);

  const onUpdateBlock = (updated: DocumentBlock) => {
    setCollapsed((prev) => new Map(prev).set(updated.id, Boolean(updated.collapsed)));
  };

  if (phase === 'locked') {
    return <PasswordGate token={token} onUnlocked={(k) => setKey(k)} />;
  }
  if (phase === 'gone') {
    return (
      <PublicFrame>
        <div className="max-w-md mx-auto mt-[20vh] text-center space-y-2">
          <LinkIcon className="w-6 h-6 mx-auto text-faint" />
          <h1 className="text-lg font-semibold text-main">{t('gone.title')}</h1>
          <p className="text-sm text-muted">{t('gone.text')}</p>
        </div>
      </PublicFrame>
    );
  }
  if (!note) return <PublicFrame>{null}</PublicFrame>;

  return (
    <PublicFrame>
      <div className="max-w-3xl mx-auto pl-2 pr-1 sm:px-8 pt-16 sm:pt-[18vh] pb-[40vh]">
        <div className="flex items-center gap-3 mb-4">
          {note.icon && !zoom.zoomedBlock && <span className="text-2xl sm:text-3xl leading-none select-none">{note.icon}</span>}
          <h1 className="flex-1 min-w-0 text-2xl sm:text-3xl font-light text-main tracking-tight leading-snug break-words [overflow-wrap:anywhere]">
            {zoom.zoomedBlock ? readableMentions(zoom.zoomedBlock.content || '') || t('untitled') : note.title || t('untitled')}
          </h1>
        </div>
        {zoom.zoomedBlock && (
          <nav aria-label={t('path')} className="flex items-center flex-wrap gap-1 mb-4 text-xs text-muted">
            <button type="button" onClick={() => setZoomedId(null)} className="inline-flex items-center gap-1 hover:text-accent cursor-pointer" title={t('backToNote')}>
              <Home className="w-3.5 h-3.5 text-accent shrink-0" />
            </button>
            {trail.slice(1).map((crumb, i) => (
              <React.Fragment key={crumb.id || i}>
                <ChevronRight className="w-3 h-3 text-faint shrink-0" />
                {i === trail.length - 2 ? (
                  <span className="font-semibold text-accent truncate max-w-[220px]">{readableMentions(crumb.title)}</span>
                ) : (
                  <button type="button" onClick={() => setZoomedId(crumb.id)} className="truncate max-w-[160px] hover:text-main cursor-pointer">
                    {readableMentions(crumb.title)}
                  </button>
                )}
              </React.Fragment>
            ))}
          </nav>
        )}
        <OutlinerTree
          docId="public"
          blocks={zoom.childBlocks}
          levelOffset={zoom.levelOffset}
          onZoomBlock={setZoomedId}
          canEdit={false}
          onUpdateBlock={onUpdateBlock}
          onCreateBlock={noop}
          onDeleteBlock={noop}
          onMoveBlock={noop}
          trailingArea={false}
        />
        <p className="mt-10 text-[11px] text-faint">{t('footer', { date: formatDateTime(note.expiresAt) })}</p>
      </div>
    </PublicFrame>
  );
};

const PublicFrame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-[100dvh] bg-editor text-main overflow-x-hidden">
    <PublicThemePicker />
    {children}
  </div>
);

const PasswordGate: React.FC<{ token: string; onUnlocked: (key: string) => void }> = ({ token, onUnlocked }) => {
  const { t } = useTranslation('public');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <PublicFrame>
      <form
        className="max-w-sm mx-auto mt-[20vh] px-4 space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!password) return;
          setBusy(true);
          setError('');
          try {
            onUnlocked(await unlockPublicNote(token, password));
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="flex items-center gap-2 text-main">
          <Lock className="w-4 h-4 text-accent" />
          <h1 className="text-base font-semibold">{t('locked.title')}</h1>
        </div>
        <p className="text-xs text-muted">{t('locked.text')}</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={t('locked.placeholder')}
          {...NO_AUTOFILL}
          className="input-field w-full h-11 sm:h-9 px-2.5 text-base sm:text-sm"
        />
        {error && <p className="text-xs text-status-err">{error}</p>}
        <button type="submit" disabled={busy || !password} className="btn-primary w-full h-11 sm:h-9 text-sm font-semibold disabled:opacity-50">
          {t('locked.open')}
        </button>
      </form>
    </PublicFrame>
  );
};
