import { describe, expect, it } from 'vitest';
import { draggedText, droppedText, textDropEffect, transferText } from '../dropText';
import { refuseUnhandledDrop } from '../dropGuard';
import { clipboard, png } from '../../test/clipboard';
import { BLOCK_DRAG_TYPE } from '../../features/workspace/moveBranchEvent';

describe('draggedText', () => {
  it('takes text and links from other programs', () => {
    expect(draggedText(clipboard({ text: 'Hallo Welt' }))).toBe(true);
    expect(draggedText(clipboard({ text: 'https://example.org/', extra: { 'text/uri-list': 'https://example.org/' } }))).toBe(true);
  });

  it('leaves files and the app’s own drags to their handlers', () => {
    expect(draggedText(clipboard({ files: [png()], text: '/tmp/bild.png' }))).toBe(false);
    expect(draggedText(clipboard({ text: 'doc_1', extra: { 'application/mindsift-doc-id': 'doc_1' } }))).toBe(false);
    expect(draggedText(clipboard({ text: 'task_1', extra: { 'application/mindsift-task-id': 'task_1' } }))).toBe(false);
    expect(draggedText(clipboard({ extra: { [BLOCK_DRAG_TYPE]: '{}' } }))).toBe(false);
    expect(draggedText(null)).toBe(false);
  });
});

describe('droppedText', () => {
  it('leaves an image dragged out of a browser tab to the image drop', () => {
    const img = clipboard({ html: '<img src="https://example.com/a.png">', text: 'https://example.com/a.png' });
    expect(droppedText(img)).toBe(false);
    expect(droppedText(clipboard({ text: 'Einkaufsliste' }))).toBe(true);
  });
});

describe('textDropEffect', () => {
  const drag = (effectAllowed: string) => ({ ...clipboard({ text: 'Hallo' }), effectAllowed }) as DataTransfer;

  it('copies text in where the drag allows it', () => {
    for (const allowed of ['all', 'uninitialized', 'copy', 'copyMove', 'copyLink', 'none']) {
      expect(textDropEffect(drag(allowed))).toBe('copy');
    }
  });

  it('moves or links when the other program allows nothing else (a copy would cancel the drop)', () => {
    expect(textDropEffect(drag('move'))).toBe('move');
    expect(textDropEffect(drag('linkMove'))).toBe('move');
    expect(textDropEffect(drag('link'))).toBe('link');
  });
});

describe('transferText', () => {
  it('reads plain text', () => {
    expect(transferText(clipboard({ text: 'Erste Zeile\nZweite Zeile' }))).toEqual({ own: '', text: 'Erste Zeile\nZweite Zeile' });
  });

  it('prefers the app’s own format of copied bullets', () => {
    expect(transferText(clipboard({ text: '- Punkt ••••', own: '- Punkt {{secret:sec_1}}' }))).toEqual({
      own: '- Punkt {{secret:sec_1}}',
      text: '- Punkt {{secret:sec_1}}',
    });
  });

  it('reads code blocks from the HTML', () => {
    const html = '<p>Beispiel:</p><pre><code class="language-go">fmt.Println("hallo")</code></pre>';
    expect(transferText(clipboard({ text: 'Beispiel:\nfmt.Println("hallo")', html })).text).toContain('```go');
  });

  it('takes the first address of a link without plain text', () => {
    expect(transferText(clipboard({ extra: { 'text/uri-list': '# Kommentar\nhttps://example.org/\nhttps://example.com/' } })).text).toBe(
      'https://example.org/'
    );
  });
});

describe('refuseUnhandledDrop', () => {
  const fire = (type: 'dragover' | 'drop', data: DataTransfer, target: EventTarget = document.body, handled = false) => {
    const ev = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(ev, 'dataTransfer', { value: data });
    target.addEventListener(type, refuseUnhandledDrop as EventListener, { once: true });
    if (handled) ev.preventDefault();
    target.dispatchEvent(ev);
    return ev;
  };

  it('refuses a file dropped where nothing takes it', () => {
    const data = clipboard({ files: [png()] });
    expect(fire('dragover', data).defaultPrevented).toBe(true);
    expect(data.dropEffect).toBe('none');
    expect(fire('drop', clipboard({ files: [png()] })).defaultPrevented).toBe(true);
  });

  it('refuses a link outside a text field, but lets it drop into one', () => {
    const link = () => clipboard({ text: 'https://example.org/', extra: { 'text/uri-list': 'https://example.org/' } });
    expect(fire('drop', link()).defaultPrevented).toBe(true);
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    const data = link();
    expect(fire('dragover', data, field).defaultPrevented).toBe(false);
    expect(fire('drop', link(), field).defaultPrevented).toBe(false);
    field.remove();
  });

  it('keeps the app’s own items out of text fields, where their id would land as text', () => {
    const task = () => clipboard({ text: 'task_1', extra: { 'application/mindsift-task-id': 'task_1' } });
    const field = document.createElement('input');
    document.body.appendChild(field);
    const data = task();
    expect(fire('dragover', data, field).defaultPrevented).toBe(true);
    expect(data.dropEffect).toBe('none');
    expect(fire('drop', task(), field).defaultPrevented).toBe(true);
    // Outside a field the browser does nothing with them anyway
    expect(fire('drop', task()).defaultPrevented).toBe(false);
    field.remove();
  });

  it('leaves plain text and drops a drop zone took alone', () => {
    expect(fire('drop', clipboard({ text: 'Hallo' })).defaultPrevented).toBe(false);
    const data = clipboard({ files: [png()] });
    data.dropEffect = 'copy';
    fire('dragover', data, document.body, true);
    expect(data.dropEffect).toBe('copy');
  });
});
