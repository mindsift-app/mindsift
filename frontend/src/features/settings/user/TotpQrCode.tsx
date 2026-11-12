import { useEffect, useState } from 'react';

// The QR code of an otpauth:// address for authenticator apps. The encoder (uqr, small and without
// dependencies) is loaded only here, the first time the code is shown, so neither the login nor the rest
// of the app carries it. Drawn as one SVG path from the module matrix.
//
// Fixed colours on purpose: scanners expect dark modules on a light ground, and not every app reads an
// inverted code, so the code keeps black on white in every theme (with a quiet zone around it).
export function TotpQrCode({ value, label }: { value: string; label: string }) {
  const [qr, setQr] = useState<{ size: number; path: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    import('uqr')
      .then(({ encode }) => {
        const { data, size } = encode(value, { ecc: 'M', border: 2 });
        let path = '';
        data.forEach((row, y) =>
          row.forEach((dark, x) => {
            if (dark) path += `M${x} ${y}h1v1h-1z`;
          })
        );
        if (alive) setQr({ size, path });
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [value]);

  if (failed) return null;
  return (
    <div className="w-44 h-44 sm:w-40 sm:h-40 shrink-0 rounded-card border border-border overflow-hidden" style={{ background: '#fff' }}>
      {qr && (
        <svg
          role="img"
          aria-label={label}
          viewBox={`0 0 ${qr.size} ${qr.size}`}
          shapeRendering="crispEdges"
          className="w-full h-full"
          data-totp-qr
        >
          <path d={qr.path} fill="#000" />
        </svg>
      )}
    </div>
  );
}
