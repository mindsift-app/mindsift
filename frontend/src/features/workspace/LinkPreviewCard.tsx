import React, { useEffect, useState } from 'react';
import { Globe, X } from 'lucide-react';
import { LinkPreview, loadLinkPreview } from '../../lib/linkPreview';
import { loadAuthorized } from '../../lib/media';
import { safeHref } from '../../lib/safeUrl';
import { useTranslation } from 'react-i18next';

interface LinkPreviewCardProps {
  url: string;
  canEdit: boolean;
  onHide: (title: string) => void;
}

function usePicture(preview: LinkPreview | null, kind: 'image' | 'icon'): string | null {
  const [src, setSrc] = useState<string | null>(null);
  const has = preview ? (kind === 'image' ? preview.hasImage : preview.hasIcon) : false;
  const key = preview?.key;
  useEffect(() => {
    if (!has || !key) return;
    let alive = true;
    loadAuthorized(`/api/v1/link-preview/${key}/${kind}`)
      .then((p) => alive && setSrc(p.url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [has, key, kind]);
  return src;
}

// Compact card above a bullet with a web address: icon and site, title, one line of description and a
// small picture. Nothing is shown when the page offers nothing usable.
export const LinkPreviewCard: React.FC<LinkPreviewCardProps> = ({ url, canEdit, onHide }) => {
  const { t } = useTranslation('workspace');
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const image = usePicture(preview, 'image');
  const icon = usePicture(preview, 'icon');
  const href = safeHref(url);

  useEffect(() => {
    let alive = true;
    setPreview(null);
    void loadLinkPreview(url).then((p) => alive && setPreview(p));
    return () => {
      alive = false;
    };
  }, [url]);

  if (!preview || !href) return null;

  return (
    <div className="relative mb-1 max-w-xl">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-stretch gap-3 min-h-[6.5rem] rounded-card border border-border bg-panel hover:bg-panel-elevated transition-colors overflow-hidden no-underline"
      >
        <div className="min-w-0 flex-1 py-3 pl-3 pr-11 sm:pr-8 space-y-1 flex flex-col justify-center">
          <div className="flex items-center gap-1.5 text-[11px] text-faint min-w-0">
            {icon ? (
              <img src={icon} alt="" className="w-3.5 h-3.5 rounded-sm shrink-0" />
            ) : (
              <Globe className="w-3.5 h-3.5 shrink-0" />
            )}
            <span className="truncate">{preview.siteName}</span>
          </div>
          {preview.title && <div className="text-sm font-semibold text-main line-clamp-2 leading-snug">{preview.title}</div>}
          {preview.description && <div className="text-xs text-muted line-clamp-2">{preview.description}</div>}
        </div>
        {image && <img src={image} alt="" className="w-28 sm:w-40 object-cover shrink-0 border-l border-border" />}
      </a>
      {canEdit && (
        <button
          type="button"
          onClick={() => onHide(preview.title)}
          title={t('preview.hideTitle')}
          aria-label={t('preview.hide')}
          className="absolute top-0 right-0 sm:top-1 sm:right-1 w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded-full bg-panel/70 text-muted hover:text-main"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
};
