import React, { useMemo } from 'react';
import {
  ArrowElement,
  Box,
  DEFAULT_FONT_SIZE,
  DrawElement,
  ShapeElement,
  TextElement,
  arrowGeometry,
  arrowLabelBox,
  arrowHeadPath,
  fillColor,
  freehandPath,
  lineHeight,
  spreadLabels,
  strokeColor,
  wrapText,
  ARROW_FONT_SIZE,
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

function Arrow({ el, byId, labelShift }: { el: ArrowElement; byId: Map<string, DrawElement>; labelShift?: [number, number] }) {
  const g = arrowGeometry(el, byId);
  const size = 8 + el.sw * 2;
  const stroke = strokeColor(el.s);
  return (
    <g fill="none" stroke={stroke} strokeWidth={el.sw} strokeLinecap="round" strokeLinejoin="round">
      <path d={g.d} strokeDasharray={dashFor(el)} />
      {el.head & 1 ? <path d={arrowHeadPath(g.start, g.startAngle, size)} /> : null}
      {el.head & 2 ? <path d={arrowHeadPath(g.end, g.endAngle, size)} /> : null}
      {el.txt ? <ArrowLabel text={el.txt} box={arrowLabelBox(el, g)} shift={labelShift} fs={el.fs || ARROW_FONT_SIZE} color={stroke} /> : null}
    </g>
  );
}

// Label on a line: on a level stretch it sits just above the line, else on it (moved aside where it would
// cover another label); its patch of the surface colour lets the line show through a little
function ArrowLabel({ text, box, shift, fs, color }: { text: string; box: Box; shift?: [number, number]; fs: number; color: string }) {
  const x = box.x + (shift?.[0] || 0);
  const y = box.y + (shift?.[1] || 0);
  return (
    <g stroke="none">
      <rect x={x} y={y} width={box.w} height={box.h} rx={4} fill="var(--bg-panel)" fillOpacity={0.85} />
      <TextLines lines={text.split('\n')} x={x + box.w / 2} top={y + 2} fs={fs} anchor="middle" fill={color} />
    </g>
  );
}

interface ElementViewProps {
  el: DrawElement;
  byId: Map<string, DrawElement>;
  labelShift?: [number, number];
}

// An arrow also follows the shapes it is docked to; everything else depends on itself only
const dockedTo = (el: DrawElement, byId: Map<string, DrawElement>, end: 'from' | 'to') =>
  el.t === 'arrow' && el[end] ? byId.get(el[end] as string) : undefined;
const sameView = (a: ElementViewProps, b: ElementViewProps) =>
  a.el === b.el &&
  a.labelShift === b.labelShift &&
  dockedTo(b.el, a.byId, 'from') === dockedTo(b.el, b.byId, 'from') &&
  dockedTo(b.el, a.byId, 'to') === dockedTo(b.el, b.byId, 'to');

// Unchanged elements keep their object, so while one is dragged only it and the arrows docked to it draw again
export const DrawingElementView = React.memo(function DrawingElementView({ el, byId, labelShift }: ElementViewProps) {
  switch (el.t) {
    case 'text':
      return <FreeText el={el} />;
    case 'arrow':
      return <Arrow el={el} byId={byId} labelShift={labelShift} />;
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
}, sameView);

/** All elements in drawing order; hidden ones (being edited as text, about to be erased) are left out or faded */
export function DrawingElements({
  els,
  hidden,
  faded,
  labelShifts,
}: {
  els: DrawElement[];
  hidden?: Set<string>;
  faded?: Set<string>;
  // Labels moved aside so they do not cover each other; without, worked out here once per drawing
  labelShifts?: Map<string, [number, number]>;
}) {
  const byId = useMemo(() => new Map(els.map((el) => [el.id, el])), [els]);
  const own = useMemo(() => (labelShifts ? null : spreadLabels(els)), [labelShifts, els]);
  const shifts = labelShifts || own;
  return (
    <>
      {els.map((el) =>
        hidden?.has(el.id) ? null : (
          <g key={el.id} opacity={faded?.has(el.id) ? 0.25 : 1}>
            <DrawingElementView el={el} byId={byId} labelShift={shifts?.get(el.id)} />
          </g>
        )
      )}
    </>
  );
}
