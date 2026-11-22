// Text dragged onto a note from another program (or marked elsewhere on the page) goes in like pasted text:
// at the drop point, several lines as bullets (OutlinerBlock, OutlinerTree).
import { htmlHasCodeBlock, htmlToMarkdown } from './pasteHtml';
import { ownClipboardText } from './outlineMarkdown';
import { droppedImages } from './pasteImages';

/** Whether a drag carries text for a note: no files, and none of the app's own items (bullets, notes,
 *  folders, tasks, list items, tabs), whose plain text is only an id. Only the types are known while dragging. */
export function draggedText(data: DataTransfer | null | undefined): boolean {
  if (!data) return false;
  const types = Array.from(data.types ?? []);
  if (types.includes('Files') || types.some((t) => t.startsWith('application/mindsift'))) return false;
  return types.includes('text/plain') || types.includes('text/uri-list') || types.includes('text');
}

/** The drop effect for text dragged in from another program: a copy, unless the drag only allows moving or
 *  linking. A copy the drag does not allow cancels the drop without a drop event: a program may offer only to
 *  move its text, and WebKitGTK under Wayland reports only the action the compositor chose. */
export function textDropEffect(data: DataTransfer): DataTransfer['dropEffect'] {
  const allowed = data.effectAllowed;
  if (allowed === 'move' || allowed === 'linkMove') return 'move';
  return allowed === 'link' ? 'link' : 'copy';
}

/** Whether a drop puts text into the note: text as above, and no image dragged out of a browser tab (its
 *  address or HTML), which becomes an image bullet (OutlinerTree, lib/pasteImages.ts). */
export function droppedText(data: DataTransfer | null | undefined): boolean {
  return draggedText(data) && !droppedImages(data).images;
}

/** The text a paste or drop brings, read as pasting does. own: bullets copied in MindSift, in the app's own
 *  format (hidden values as references); text: that, else the Markdown of HTML with code blocks (their plain
 *  text has the code without a fence), else the plain text. */
export function transferText(data: DataTransfer): { own: string; text: string } {
  const own = ownClipboardText(data);
  const html = own ? '' : data.getData('text/html');
  const fromHtml = html && htmlHasCodeBlock(html) ? htmlToMarkdown(html) : '';
  // A link with no plain text: its first address (lines starting with # are comments)
  const link = () => data.getData('text/uri-list').split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) ?? '';
  return { own, text: own || fromHtml || data.getData('text') || link() };
}
