import type { Tool } from '../app/model';

export function FloatingTools({ tool, onTool }: { tool: Tool; onTool: (tool: 'select' | 'hand') => void }) {
  return (
    <>
      <button title="Select (V)" aria-label="Select" aria-pressed={tool === 'select'} className={tool === 'select' ? 'on' : ''} onClick={() => onTool('select')}>
        <span aria-hidden="true">➤</span> Select
      </button>
      <button title="Pan (H to toggle, or hold Space while using another tool)" aria-label="Pan" aria-pressed={tool === 'hand'} className={tool === 'hand' ? 'on' : ''} onClick={() => onTool('hand')}>
        <span aria-hidden="true">✋</span> Pan
      </button>
    </>
  );
}
