// Test helpers for paste events (lib/pasteImages.ts)
// A clipboard as the paste event hands it over: files, items and the text formats. The same serves as the
// dataTransfer of a drag (types lists "Files" when there are files, as browsers do; extra adds formats)
export function clipboard(
  opts: { files?: File[]; text?: string; html?: string; own?: string; extra?: Record<string, string> } = {}
): DataTransfer {
  const files = opts.files || [];
  const data: Record<string, string> = {
    'text/plain': opts.text || '',
    'text/html': opts.html || '',
    'application/x-mindsift-outline': opts.own || '',
    ...opts.extra,
  };
  return {
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: [...Object.keys(data).filter((k) => data[k]), ...(files.length > 0 ? ['Files'] : [])],
    dropEffect: 'none',
    getData: (type: string) => data[type === 'text' ? 'text/plain' : type] || '',
  } as unknown as DataTransfer;
}

export const png = (name = 'bildschirmfoto.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
