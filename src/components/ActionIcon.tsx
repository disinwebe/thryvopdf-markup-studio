import { useId, type ReactNode } from 'react';

export type ActionIconName =
  | 'open' | 'save' | 'undo' | 'redo' | 'select' | 'pan' | 'delete' | 'group' | 'ungroup'
  | 'zoom-in' | 'zoom-out' | 'flatten' | 'flatten-all' | 'bring-front' | 'bring-back'
  | 'compare' | 'text' | 'symbol' | 'signature' | 'line' | 'highlight' | 'cloud' | 'rect'
  | 'ellipse' | 'arrow' | 'polyline' | 'pen' | 'stamp' | 'image' | 'note' | 'page' | 'm-length'
  | 'm-polylength' | 'm-spline' | 'm-radius' | 'm-diameter' | 'm-area' | 'm-perimeter' | 'm-angle'
  | 'm-count' | 'key' | 'cut' | 'copy' | 'paste' | 'fit-width' | 'rotate-cw' | 'rotate-ccw' | 'left' | 'right' | 'up' | 'down';

const paths: Record<ActionIconName, ReactNode> = {
  open: <><path d="M3 7h7l2 2h9v10H3z" /><path d="M3 10h18l-2 9H5z" /></>,
  save: <><path d="M5 3h12l4 4v14H5z" /><path d="M8 3v6h9V3M8 21v-8h10v8" /></>,
  undo: <><path d="M9 8 4 12l5 4v-3h5c4 0 6 2 6 6 2-2 2-5 1-7-1-3-4-4-7-4H9z" /></>,
  redo: <><path d="m15 8 5 4-5 4v-3h-5c-4 0-6 2-6 6-2-2-2-5-1-7 1-3 4-4 7-4h5z" /></>,
  select: <path d="m5 3 14 11-7 1-3 6L5 3z" />,
  pan: <><path d="M7 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v6-3a2 2 0 0 1 4 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-5-3l-4-5a2 2 0 0 1 3-2l2 2" /></>,
  delete: <><path d="M5 7h14l-1 14H6zM3 4h18M9 4V2h6v2" /><path d="M9 10v7m6-7v7" /></>,
  group: <><rect x="3" y="4" width="9" height="9" rx="1.5" /><rect x="12" y="11" width="9" height="9" rx="1.5" /></>,
  ungroup: <><rect x="3" y="4" width="8" height="8" rx="1.5" /><rect x="14" y="13" width="7" height="7" rx="1.5" /><path d="M12 7h7m-3-3 3 3-3 3M12 17H5m3-3-3 3 3 3" /></>,
  'zoom-in': <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6m-11-14v6m-3-3h6" /></>,
  'zoom-out': <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6M7 10h6" /></>,
  flatten: <><path d="M4 5h16M6 9h12M8 13h8M10 17h4M7 21l3-3 3 3 3-3 3 3" /></>,
  'flatten-all': <><path d="M4 5h16M6 9h12M8 13h8M5 20l4-4 3 3 7-7" /></>,
  'bring-front': <><path d="M12 20V5m-6 6 6-6 6 6M4 21h16" /></>,
  'bring-back': <><path d="M12 4v15m-6-6 6 6 6-6M4 3h16" /></>,
  compare: <><rect x="3" y="4" width="12" height="16" rx="1" /><rect x="9" y="7" width="12" height="16" rx="1" /><path d="M6 8h4m2 3h6" /></>,
  text: <><path d="M4 5h16M12 5v15M8 20h8" /></>,
  symbol: <><path d="m5 12 4 4L19 6" /><circle cx="12" cy="12" r="10" /></>,
  signature: <><path d="M3 17c3-1 4-9 7-9s-2 8 1 8 4-5 6-5 0 5 3 5h2" /><path d="m16 7 4-4 2 2-4 4z" /></>,
  line: <path d="m4 20 16-16" />,
  highlight: <><path d="M4 16 15 5l5 5L9 21H4z" /><path d="M3 22h18M8 17l4 4" /></>,
  cloud: <path d="M7 18a4 4 0 0 1-.5-8A6 6 0 0 1 18 9a4.5 4.5 0 1 1 0 9z" />,
  rect: <rect x="4" y="5" width="16" height="14" rx="1" />,
  ellipse: <ellipse cx="12" cy="12" rx="8" ry="6" />,
  arrow: <><path d="M4 19 19 4M10 4h9v9" /><path d="m15 4 4 4" /></>,
  polyline: <path d="m3 17 6-9 5 7 7-9" />,
  pen: <><path d="m4 17 11-11 5 5L9 22H4z" /><path d="m13 8 5 5M4 17l5 5" /></>,
  stamp: <><path d="M9 4a3 3 0 0 1 6 0c0 3-2 4-2 6h4a3 3 0 0 1 3 3v2H4v-2a3 3 0 0 1 3-3h4c0-2-2-3-2-6z" /><path d="M4 18h16v3H4z" /></>,
  image: <><rect x="3" y="4" width="18" height="16" rx="1.5" /><circle cx="8" cy="9" r="1.5" /><path d="m4 18 6-6 4 3 3-4 4 5" /></>,
  note: <><path d="M5 3h10l4 4v14H5z" /><path d="M14 3v5h5M8 12h8m-8 4h8" /></>,
  page: <><path d="M5 3h10l4 4v14H5z" /><path d="M14 3v5h5M8 12h8m-8 4h8" /></>,
  'm-length': <><path d="M4 12h16m-4-4 4 4-4 4M8 8l-4 4 4 4" /></>,
  'm-polylength': <path d="m3 17 5-9 5 7 8-8M6 17h-3v3m10-5 2 2" />,
  'm-spline': <path d="M3 18c4 0 4-12 9-12s5 12 9 12" />,
  'm-radius': <><circle cx="12" cy="12" r="8" /><path d="M12 12 18 6m-9 6h6" /></>,
  'm-diameter': <><circle cx="12" cy="12" r="8" /><path d="M6 18 18 6m-12 0h4m4 12h4" /></>,
  'm-area': <><path d="M4 19 7 5l13 3-3 12z" /><path d="m7 5 10 15" /></>,
  'm-perimeter': <><path d="M5 5h14v14H5z" /><path d="M8 8h8v8H8z" /></>,
  'm-angle': <><path d="M5 19 12 5l7 14z" /><path d="M9 17a4 4 0 0 1 3-3" /></>,
  'm-count': <><path d="M9 4 7 20m10-16-2 16M4 9h16M3 15h16" /></>,
  key: <><circle cx="8" cy="12" r="5" /><path d="M13 12h8m-3 0v3m-3-3v2" /></>,
  cut: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><path d="m8 7 12 10M8 17l5-4m3-2 4-4" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  paste: <><path d="M9 5H6a2 2 0 0 0-2 2v13h14v-3" /><rect x="9" y="4" width="10" height="13" rx="1" /><path d="M12 4.5h4" /></>,
  'fit-width': <><path d="M3 12h18m-5-5 5 5-5 5M8 7l-5 5 5 5" /><path d="M7 4h10M7 20h10" /></>,
  'rotate-cw': <><path d="M20 11a8 8 0 1 1-2.34-5.66" fill="none" strokeWidth="2.5" /><path d="M20 4v7h-7" /></>,
  'rotate-ccw': <><path d="M4 11a8 8 0 1 0 2.34-5.66" fill="none" strokeWidth="2.5" /><path d="M4 4v7h7" /></>,
  left: <path d="m15 5-7 7 7 7" />,
  right: <path d="m9 5 7 7-7 7" />,
  up: <path d="m5 15 7-7 7 7" />,
  down: <path d="m5 9 7 7 7-7" />,
};

export function ActionIcon({ name, className = '', mirrored = false }: { name: ActionIconName; className?: string; mirrored?: boolean }) {
  const gradientId = `action-icon-${useId().replace(/:/g, '')}`;
  const palette = name === 'group' || name === 'ungroup' || name === 'compare' || name === 'undo'
    ? ['#c1a8ff', '#8c68ec', '#6547c5', '#563aa9']
    : name === 'pan' || name === 'symbol' || name === 'redo'
      ? ['#8ee5b6', '#48bd81', '#23945d', '#17794b']
      : name.startsWith('m-') || name === 'open' || name === 'highlight' || name === 'stamp'
        ? ['#ffd18a', '#f5a33e', '#d47a20', '#ad6117']
        : name === 'delete' || name === 'cut'
          ? ['#ffa1a1', '#ed6269', '#c73946', '#a82e3b']
          : name === 'image' || name === 'key'
            ? ['#82e6e5', '#37babb', '#19898e', '#116e74']
            : ['#73b8ff', '#3989ed', '#2563c5', '#1d4e9a'];
  return (
    <svg className={`action-icon ${className}`.trim()} viewBox={mirrored ? '0 0 16 16' : '0 0 24 24'} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={palette[0]} />
          <stop offset=".48" stopColor={palette[1]} />
          <stop offset="1" stopColor={palette[2]} />
        </linearGradient>
        <filter id={`${gradientId}-shadow`} x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="1" stdDeviation=".8" floodColor="#25364b" floodOpacity=".34" />
        </filter>
      </defs>
      <g fill={`url(#${gradientId})`} stroke={palette[3]} filter={`url(#${gradientId}-shadow)`}>
        {mirrored ? <g transform="translate(16 0) scale(-1 1)"><g transform="scale(.666667)">{paths[name]}</g></g> : paths[name]}
      </g>
      <path d="M5 5h4" fill="none" stroke="#fff" strokeWidth="1.15" strokeLinecap="round" opacity=".76" />
    </svg>
  );
}
