export function PanelToggle({ side, visible, onToggle }: { side: 'left' | 'right'; visible: boolean; onToggle(): void }) {
  const action = visible ? 'Hide' : 'Show';
  const direction = side === 'left' ? (visible ? '◀' : '▶') : (visible ? '▶' : '◀');
  const shortcut = side === 'left' ? 'Ctrl+Alt+L' : 'Ctrl+Alt+R';
  return (
    <button className={`panel-toggle ${side}-toggle`} aria-controls={`${side}-panel`} aria-expanded={visible}
      title={`${action} ${side} panel (${shortcut})`} aria-label={`${action} ${side} panel`} onClick={onToggle}>
      {direction}
    </button>
  );
}
