import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Link as LinkIcon, LoaderCircle, X } from 'lucide-react';
import { copyExternalImage, prepareImage, UploadedMedia, uploadMedia } from '../../lib/media';
import { useTranslation } from 'react-i18next';
import { errorMessage } from '../../lib/errorMessage';

interface ImagePickerProps {
  docId: string;
  onDone: (media: UploadedMedia) => void;
  onCancel: () => void;
}

// Inline box an empty bullet turns into after /image: pick a file (or the camera on phones), drop or
// paste an image, or give a link the server copies. Nothing is synced until the upload succeeded.
export const ImagePicker: React.FC<ImagePickerProps> = ({ docId, onDone, onCancel }) => {
  const { t } = useTranslation('workspace');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [url, setUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    boxRef.current?.focus();
  }, []);

  const uploadFile = async (file: File | Blob | null | undefined) => {
    if (!file || busy) return;
    if (file.type && !file.type.startsWith('image/')) {
      setError(t('media.chooseImage'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { blob, name } = await prepareImage(file);
      onDone(await uploadMedia(docId, blob, name));
    } catch (err) {
      setError(errorMessage(err, t('media.uploadFailed')));
      setBusy(false);
    }
  };

  const copyLink = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const target = url.trim();
    if (!target || busy) return;
    setBusy(true);
    setError(null);
    try {
      onDone(await copyExternalImage(docId, target));
    } catch (err) {
      setError(errorMessage(err, t('media.imageFetchFailed')));
      setBusy(false);
    }
  };

  return (
    <div
      ref={boxRef}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      }}
      onPaste={(e) => {
        const item = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'));
        if (item) {
          e.preventDefault();
          void uploadFile(item.getAsFile());
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void uploadFile(e.dataTransfer.files?.[0]);
      }}
      className={
        dragOver
          ? 'my-1 p-3 rounded-card border-2 border-dashed border-accent bg-accent-dim space-y-3 focus:outline-none'
          : 'my-1 p-3 rounded-card border-2 border-dashed border-border bg-panel space-y-3 focus:outline-none'
      }
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-main flex items-center gap-1.5">
          <ImagePlus className="w-4 h-4 text-accent" /> {t('media.insertImage')}
        </span>
        <button
          type="button"
          onClick={onCancel}
          title={t('media.cancelEsc')}
          className="w-11 h-11 sm:w-7 sm:h-7 flex items-center justify-center rounded-btn text-muted hover:text-main hover:bg-panel-elevated"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {busy ? (
        <div className="flex items-center gap-2 text-xs text-muted py-3">
          <LoaderCircle className="w-4 h-4 animate-spin text-accent" /> {t('workspace:media.uploading')}
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="btn-primary h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5"
            >
              <ImagePlus className="w-4 h-4" /> {t('media.chooseFile')}
            </button>
            <button
              type="button"
              onClick={() => cameraRef.current?.click()}
              className="btn-secondary h-11 sm:h-8 px-3 text-xs flex items-center justify-center gap-1.5 sm:hidden"
            >
              <Camera className="w-4 h-4" /> {t('workspace:media.takePhoto')}
            </button>
            <span className="hidden sm:flex items-center text-[11px] text-faint">
              {t('media.dropHint')}
            </span>
          </div>
          <form onSubmit={copyLink} className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <LinkIcon className="w-3.5 h-3.5 text-faint absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="url"
                inputMode="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={t('media.imageUrl')}
                className="w-full h-11 sm:h-8 pl-8 pr-2 input-field text-xs"
              />
            </div>
            <button
              type="submit"
              disabled={!url.trim()}
              className="btn-secondary h-11 sm:h-8 px-3 text-xs shrink-0 disabled:opacity-40"
            >
              {t('media.take')}
            </button>
          </form>
        </>
      )}

      {error && <p className="text-xs text-status-err">{error}</p>}

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => void uploadFile(e.target.files?.[0])} />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => void uploadFile(e.target.files?.[0])}
      />
    </div>
  );
};
