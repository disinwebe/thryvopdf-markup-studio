import type { Tool } from '../app/model';
import { SelectIcon } from './SelectIcon';

export function FloatingTools({ tool, theme, onTool }: { tool: Tool; theme: 'light' | 'dark'; onTool: (tool: 'select' | 'hand') => void }) {
  return (
    <>
      <button title="Select (V)" aria-label="Select" aria-pressed={tool === 'select'} className={tool === 'select' ? 'on' : ''} onClick={() => onTool('select')}>
        <SelectIcon theme={theme} /> Select
      </button>
      <button title="Pan (H to toggle, or hold Space while using another tool)" aria-label="Pan" aria-pressed={tool === 'hand'} className={tool === 'hand' ? 'on' : ''} onClick={() => onTool('hand')}>
        <span aria-hidden="true">✋</span> Pan
      </button>
    </>
  );
}
