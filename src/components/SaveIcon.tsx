export function SaveIcon({ inverted = false }: { inverted?: boolean }) {
  return (
    <svg className="folder-icon" aria-hidden="true" viewBox="0 0 16 16" focusable="false">
      <g transform={inverted ? 'translate(16 0) scale(-1 1)' : undefined}>
        <path d="M2 1.5h10l2 2v11H2z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M5 2v4h6V2M5 14v-5h6v5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </g>
    </svg>
  );
}
