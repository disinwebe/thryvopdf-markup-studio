import { useState } from 'react';

export function TabNameEditor({ name, onSave, onCancel }: { name: string; onSave(name: string): void; onCancel(): void }) {
  const [value, setValue] = useState(name);
  return (
    <form className="tab-name-editor" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(value); }}>
      <input autoFocus aria-label="Tab name" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }} />
      <button type="submit" aria-label="Save tab name">✓</button>
      <button type="button" aria-label="Cancel tab rename" onClick={onCancel}>×</button>
    </form>
  );
}
