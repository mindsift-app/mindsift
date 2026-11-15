// Test helpers for paste events (lib/pasteImages.ts)
// A clipboard as the paste event hands it over: files, items and the text formats
export function clipboard(opts: { files?: File[]; text?: string; html?: string; own?: string } = {}): DataTransfer {
  const files = opts.files || [];
  const data: Record<string, string> = {
    'text/plain': opts.text || '',
    'text/html': opts.html || '',
    'application/x-mindsift-outline': opts.own || '',
  };
  return {
    files,
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    types: Object.keys(data).filter((k) => data[k]),
    getData: (type: string) => data[type === 'text' ? 'text/plain' : type] || '',
  } as unknown as DataTransfer;
}

export const png = (name = 'bildschirmfoto.png') => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });
