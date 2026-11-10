export type ContextMenuAction = 'cut' | 'copy' | 'paste' | 'select' | 'pan' | 'zoom-in' | 'zoom-out' | 'flatten' | 'flatten-all' | 'bring-front' | 'bring-back';

const paths: Record<ContextMenuAction, React.ReactNode> = {
  cut: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><path d="m8 7 12 10M8 17l5-4m3-2 4-4" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="1" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" /></>,
  paste: <><path d="M9 5H6a2 2 0 0 0-2 2v13h14v-3" /><rect x="9" y="4" width="10" height="13" rx="1" /><path d="M12 4.5h4" /></>,
  select: <path d="m5 3 13 10-6 1-3 6L5 3Z" />,
  pan: <><path d="M8 11V5a2 2 0 0 1 4 0v5-2a2 2 0 0 1 4 0v2-1a2 2 0 0 1 4 0v6a7 7 0 0 1-7 7h-1a6 6 0 0 1-4-2l-4-4a2 2 0 0 1 3-3l2 2" /></>,
  'zoom-in': <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5M10.5 7v7m-3.5-3.5h7" /></>,
  'zoom-out': <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5m-14-10.5h7" /></>,
  flatten: <><path d="M4 5h16M6 9h12M8 13h8M10 17h4" /><path d="m8 20 2-2 2 2 2-2 2 2" /></>,
  'flatten-all': <><path d="M4 5h16M6 9h12M8 13h8" /><path d="m5 17 2 2 4-4m3 2 2 2 4-4" /></>,
  'bring-front': <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M5 19h14" /></>,
  'bring-back': <><path d="M12 21V9m-5 5 5-5 5 5" /><path d="M5 5h14" /></>,
};

export function ContextMenuIcon({ action }: { action: ContextMenuAction }) {
  return (
    <svg className="context-menu-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[action]}
    </svg>
  );
}
