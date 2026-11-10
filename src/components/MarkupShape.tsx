import { arrowHead, boxCenter, boxOf, cloudPointsFromPath, rectPoly, wrapText, approxTextWidth } from '../core/geometry';
import { measureLabel } from '../core/measurement';
import { Calibration, Markup, Pt } from '../core/types';
import { calloutLayout, calloutTextRuns } from '../core/callout';
import { measurementArrowheads } from '../core/snapping';

const pts = (p: Pt[]) => p.map((q) => `${q.x},${q.y}`).join(' ');
const d = (p: Pt[], close = false) => 'M' + p.map((q) => `${q.x} ${q.y}`).join(' L') + (close ? ' Z' : '');

function Label({ text, x, y, color, area = false }: { text: string; x: number; y: number; color: string; area?: boolean }) {
  if (!text) return null;
  const square = text.indexOf('²');
  const base = square < 0 ? text : text.slice(0, square);
  const raised = square < 0 ? '' : '2' + text.slice(square + 1);
  return (
    <text
      x={x}
      y={y}
      fontSize={11}
      fontWeight={600}
      fill={area ? '#fff' : color}
      stroke={area ? color : '#fff'}
      strokeWidth={1}
      paintOrder="stroke"
      strokeLinejoin="round"
    >
      {base}
      {raised && <tspan baselineShift="super" fontSize="70%">{raised}</tspan>}
    </text>
  );
}

export function MarkupShape({ m, cal, countNo, tag }: { m: Markup; cal: Calibration; countNo?: number; tag?: number }) {
  const common = {
    stroke: m.color,
    strokeWidth: m.width,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  const label = measureLabel(m, cal);
  let body: React.ReactNode = null;

  switch (m.type) {
    case 'highlight': {
      const r = boxOf(m);
      body = <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={m.color} style={{ mixBlendMode: 'multiply' }} />;
      break;
    }
    case 'rect': {
      const r = boxOf(m);
      body = <rect {...common} fill={m.fill ?? 'none'} x={r.x} y={r.y} width={r.w} height={r.h} />;
      break;
    }
    case 'cloud': {
      const p = cloudPointsFromPath(m.points, m.cloudArc);
      body = <path {...common} fill={m.fill ?? 'none'} d={d(p, true)} />;
      break;
    }
    case 'ellipse': {
      const r = boxOf(m);
      body = <ellipse {...common} fill={m.fill ?? 'none'} cx={r.x + r.w / 2} cy={r.y + r.h / 2} rx={r.w / 2} ry={r.h / 2} />;
      break;
    }
    case 'line':
    case 'm-length': {
      const [a, b] = m.points;
      const arrowheads = measurementArrowheads(m);
      const startArrow = m.measurementArrowheads === 'start' || m.measurementArrowheads === 'both';
      const endArrow = m.measurementArrowheads === 'end' || m.measurementArrowheads === 'both';
      body = (
        <>
          <path {...common} d={d([a, b])} />
          {!startArrow && <circle cx={a.x} cy={a.y} r={2.5} fill={m.color} />}
          {!endArrow && <circle cx={b.x} cy={b.y} r={2.5} fill={m.color} />}
          {arrowheads.map((head, index) => <polygon key={index} points={pts(head)} fill={m.color} stroke={m.color} strokeWidth={1} />)}
          <Label text={label} x={(a.x + b.x) / 2 + 4} y={(a.y + b.y) / 2 - 6} color={m.color} />
        </>
      );
      break;
    }
    case 'arrow': {
      const [a, b] = m.points;
      body = (
        <>
          <path {...common} d={d([a, b])} />
          <polygon points={pts(arrowHead(a, b, 8 + m.width * 2))} fill={m.color} stroke={m.color} strokeWidth={1} />
        </>
      );
      break;
    }
    case 'polyline':
    case 'pen':
      body = <path {...common} d={d(m.points)} />;
      break;
    case 'm-polylength': {
      const mid = m.points[Math.floor(m.points.length / 2)] ?? m.points[0];
      body = (
        <>
          <path {...common} d={d(m.points)} />
          <Label text={label} x={mid.x + 4} y={mid.y - 6} color={m.color} />
        </>
      );
      break;
    }
    case 'm-angle': {
      const mid = m.points[1] ?? m.points[0];
      body = (
        <>
          <path {...common} d={d(m.points)} />
          <Label text={label} x={mid.x + 6} y={mid.y - 6} color={m.color} />
        </>
      );
      break;
    }
    case 'm-area':
    case 'm-perimeter': {
      const xs = m.points.reduce((s, p) => s + p.x, 0) / m.points.length;
      const ys = m.points.reduce((s, p) => s + p.y, 0) / m.points.length;
      body = (
        <>
          <path {...common} fill={m.type === 'm-area' ? m.fill ?? m.color : 'none'} fillOpacity={m.type === 'm-area' ? 1 : 0} d={d(m.points, true)} />
          <Label text={label} x={xs - approxTextWidth(label, 11) / 2} y={ys} color={m.color} area={m.type === 'm-area'} />
        </>
      );
      break;
    }
    case 'm-count': {
      const p = m.points[0];
      body = (
        <>
          <circle cx={p.x} cy={p.y} r={7} fill={m.color} stroke="#fff" strokeWidth={1} />
          <text x={p.x} y={p.y + 3.7} fontSize={10} fontWeight={700} textAnchor="middle" fill="#fff">
            {countNo ?? ''}
          </text>
        </>
      );
      break;
    }
    case 'text':
    case 'callout': {
      const r = boxOf(m);
      const size = m.fontSize ?? 12;
      const lines = wrapText(m.text ?? '', Math.max(10, r.w - 8), size);
      let leader: React.ReactNode = null;
      if (m.type === 'callout' && m.points[2]) {
        const tip = m.points[2];
        const c = boxCenter(m);
        const edge = clampEdge(c, tip, r);
        leader = (
          <>
            <path {...common} d={d([edge, tip])} />
            <polygon points={pts(arrowHead(edge, tip, 7 + m.width))} fill={m.color} stroke={m.color} />
          </>
        );
      }
      body = (
        <>
          {leader}
          <rect {...common} fill={m.fill ?? '#fff'} x={r.x} y={r.y} width={r.w} height={r.h} />
          <text fontSize={size} fill={m.color} fontFamily="Helvetica, Arial, sans-serif">
            {lines.map((ln, i) => (
              <tspan key={i} x={r.x + 4} y={r.y + 3 + size * (i + 1) * 1.15 - size * 0.2}>
                {ln}
              </tspan>
            ))}
          </text>
        </>
      );
      break;
    }
    case 'stamp': {
      const r = boxOf(m);
      if (m.stampImage) {
        body = <image href={m.stampImage.data} x={r.x} y={r.y} width={r.w} height={r.h} preserveAspectRatio="none" />;
        break;
      }
      const t = (m.stamp ?? 'STAMP').toUpperCase();
      const size = Math.max(6, Math.min(r.h * 0.5, (r.w - 10) / Math.max(1, t.length * 0.62)));
      body = (
        <>
          <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="none" stroke={m.color} strokeWidth={Math.max(2, m.width)} rx={3} />
          <text x={r.x + r.w / 2} y={r.y + r.h / 2 + size * 0.35} textAnchor="middle" fontSize={size} fontWeight={700} fill={m.color} fontFamily="Helvetica, Arial, sans-serif">
            {t}
          </text>
        </>
      );
      break;
    }
    case 'note': {
      const p = m.points[0];
      body = (
        <g stroke="#664d00" strokeWidth={1}>
          <rect x={p.x - 10} y={p.y - 10} width={20} height={20} fill="#ffec66" />
          <path d={`M${p.x - 6} ${p.y - 4}h12M${p.x - 6} ${p.y}h12M${p.x - 6} ${p.y + 4}h8`} fill="none" />
        </g>
      );
      break;
    }
  }
  const co = calloutLayout(m);
  return (
    <g>
      <g opacity={m.type === 'm-area' || m.type === 'm-count' ? Math.max(0.5, m.opacity) : m.opacity}>{body}</g>
      {co && (
        <g className="callout-box">
          <line x1={co.edge.x} y1={co.edge.y} x2={co.anchor.x} y2={co.anchor.y} stroke="#e11d48" strokeWidth={1.2} />
          <circle cx={co.anchor.x} cy={co.anchor.y} r={2.5} fill="#e11d48" />
          <rect x={co.x} y={co.y} width={co.w} height={co.h} fill="#fff" stroke="#e11d48" strokeWidth={1.5} />
          {calloutTextRuns(co, tag).map((run, i) => (
            <g key={i}>
              {run.badge && <circle cx={run.badge.cx} cy={run.badge.cy} r={run.badge.r} fill="#e11d48" />}
              <text x={run.x} y={run.y} fontSize={run.size} fontFamily="Helvetica, Arial, sans-serif" fontWeight={run.kind === 'number' ? 700 : 400}
                fill={run.kind === 'number' ? '#fff' : run.kind === 'author' ? '#9e1236' : '#212121'}>{run.text}</text>
            </g>
          ))}
        </g>
      )}
    </g>
  );
}
function clampEdge(from: Pt, to: Pt, r: { x: number; y: number; w: number; h: number }): Pt {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (r.x + r.w - from.x) / dx);
  else if (dx < 0) t = Math.min(t, (r.x - from.x) / dx);
  if (dy > 0) t = Math.min(t, (r.y + r.h - from.y) / dy);
  else if (dy < 0) t = Math.min(t, (r.y - from.y) / dy);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

export { rectPoly };
