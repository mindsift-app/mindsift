// A file or link dropped where nothing takes it (sidebar, header, sign-in page) would make the browser open it
// in place of the app, with no way back in the installed app or the desktop window. Places that take files
// (notes, the image picker, the import) handle the event first and prevent this already; text drops are left
// alone, and a link still drops into a text field as text.

const EDITABLE = 'input, textarea, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]';

/** Refuses a drag (dragover) and drop that nothing on the page handled and that the browser would open. */
export function refuseUnhandledDrop(e: DragEvent): void {
  if (e.defaultPrevented || !e.dataTransfer) return;
  const types = Array.from(e.dataTransfer.types ?? []);
  const files = types.includes('Files');
  if (!files && !types.includes('text/uri-list')) return;
  if (!files && e.target instanceof Element && e.target.closest(EDITABLE)) return;
  e.preventDefault();
  if (e.type === 'dragover') e.dataTransfer.dropEffect = 'none';
}

/** Listens on the window, after every handler on the page (bubbling). Returns the removal. */
export function installDropGuard(target: Window = window): () => void {
  target.addEventListener('dragover', refuseUnhandledDrop);
  target.addEventListener('drop', refuseUnhandledDrop);
  return () => {
    target.removeEventListener('dragover', refuseUnhandledDrop);
    target.removeEventListener('drop', refuseUnhandledDrop);
  };
}
