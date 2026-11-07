import React from 'react';
import {
  ArrowElement,
  DEFAULT_FONT_SIZE,
  DrawElement,
  ShapeElement,
  TextElement,
  arrowGeometry,
  arrowHeadPath,
  fillColor,
  freehandPath,
  lineHeight,
  strokeColor,
  wrapText,
} from '../../../lib/drawing/model';

const FONT = '"Inter Variable", Inter, system-ui, sans-serif';

function dashFor(el: DrawElement): string | undefined {
  return el.dash ? `${el.sw * 4} ${el.sw * 3}` : undefined;
}

function TextLines({ lines, x, top, fs, anchor, fill }: { lines: string[]; x: number; top: number; fs: number; anchor: 'start' | 'middle'; fill: string }) {
  const lh = lineHeight(fs);
  return (
    <text x={x} y={top} fontSize={fs} fontFamily={FONT} fill={fill} textAnchor={anchor} style={{ whiteSpace: 'pre' }}>
      {lines.map((line, i) => (
        // Baseline at about 80 % of the line, so the text sits inside its box
        <tspan key={i} x={x} y={top + i * lh + fs * 0.95}>
          {line || ' '}
        </tspan>
      ))}
    </text>
  );
}

function Shape({ el }: { el: ShapeElement }) {
  const common = {
    stroke: strokeColor(el.s),
    strokeWidth: el.sw,
    strokeDasharray: dashFor(el),
    fill: fillColor(el.f),
    strokeLinejoin: 'round' as const,
  };
  let outline: React.ReactNode;
  if (el.t === 'ellipse') {
    outline = <ellipse cx={el.x + el.w / 2} cy={el.y + el.h / 2} rx={el.w / 2} ry={el.h / 2} {...common} />;
  } else if (el.t === 'diamond') {
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    outline = <polygon points={`${cx},${el.y} ${el.x + el.w},${cy} ${cx},${el.y + el.h} ${el.x},${cy}`} {...common} />;
  } else {
    const r = el.r ? Math.min(14, el.w / 4, el.h / 4) : 0;
    outline = <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={r} ry={r} {...common} />;
  }
  let label: React.ReactNode = null;
  if (el.txt) {
    const fs = el.fs || DEFAULT_FONT_SIZE;
    // Text area inside the outline: ellipses and diamonds have less room than their box
    const inner = el.t === 'rect' ? 0.9 : el.t === 'ellipse' ? 0.7 : 0.55;
    const lines = wrapText(el.txt, fs, Math.max(fs, el.w * inner - 8));
    const height = lines.length * lineHeight(fs);
    label = <TextLines lines={lines} x={el.x + el.w / 2} top={el.y + (el.h - height) / 2} fs={fs} anchor="middle" fill={strokeColor(el.s)} />;
  }
  return (
    <g>
      {outline}
      {label}
    </g>
  );
}

function FreeText({ el }: { el: TextElement }) {
  const fs = el.fs || DEFAULT_FONT_SIZE;
  return <TextLines lines={el.txt.split('\n')} x={el.x} top={el.y} fs={fs} anchor="start" fill={strokeColor(el.s)} />;
}

function Arrow({ el, byId }: { el: ArrowElement; byId: Map<string, DrawElement> }) {
  const g = arrowGeometry(el, byId);
  const size = 8 + el.sw * 2;
  const stroke = strokeColor(el.s);
  return (
    <g fill="none" stroke={stroke} strokeWidth={el.sw} strokeLinecap="round" strokeLinejoin="round">
      <path d={g.d} strokeDasharray={dashFor(el)} />
      {el.head & 1 ? <path d={arrowHeadPath(g.start, g.startAngle, size)} /> : null}
      {el.head & 2 ? <path d={arrowHeadPath(g.end, g.endAngle, size)} /> : null}
    </g>
  );
}

export function DrawingElementView({ el, byId }: { el: DrawElement; byId: Map<string, DrawElement> }) {
  switch (el.t) {
    case 'text':
      return <FreeText el={el} />;
    case 'arrow':
      return <Arrow el={el} byId={byId} />;
    case 'draw':
      return (
        <path
          d={freehandPath(el.pts)}
          fill="none"
          stroke={strokeColor(el.s)}
          strokeWidth={el.sw}
          strokeDasharray={dashFor(el)}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    default:
      return <Shape el={el} />;
  }
}

/** All elements in drawing order; hidden ones (being edited as text, about to be erased) are left out or faded */
export function DrawingElements({
  els,
  hidden,
  faded,
}: {
  els: DrawElement[];
  hidden?: Set<string>;
  faded?: Set<string>;
}) {
  const byId = new Map(els.map((el) => [el.id, el]));
  return (
    <>
      {els.map((el) =>
        hidden?.has(el.id) ? null : (
          <g key={el.id} opacity={faded?.has(el.id) ? 0.25 : 1}>
            <DrawingElementView el={el} byId={byId} />
          </g>
        )
      )}
    </>
  );
}
