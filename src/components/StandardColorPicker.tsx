import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export const STANDARD_COLORS = [
  { name: 'Black', value: '#000000' },
  { name: 'White', value: '#ffffff' },
  { name: 'Dark red', value: '#c00000' },
  { name: 'Red', value: '#ff0000' },
  { name: 'Orange', value: '#ed7d31' },
  { name: 'Yellow', value: '#ffc000' },
  { name: 'Light green', value: '#70ad47' },
  { name: 'Green', value: '#00b050' },
  { name: 'Teal', value: '#00b0f0' },
  { name: 'Blue', value: '#0070c0' },
  { name: 'Dark blue', value: '#002060' },
  { name: 'Purple', value: '#7030a0' },
  { name: 'Pink', value: '#e91e63' },
  { name: 'Brown', value: '#843c0c' },
  { name: 'Gray', value: '#808080' },
  { name: 'Light gray', value: '#d9e1f2' },
] as const;

export function StandardColorPicker({ value, onChange, ariaLabel }: { value: string; onChange(value: string): void; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const swatchesRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (detailsRef.current?.contains(event.target as Node) || swatchesRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setPosition(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setPosition(null);
      }
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);
  const toggle = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    const isOpen = event.currentTarget.open;
    setOpen(isOpen);
    if (!isOpen) {
      setPosition(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = 193;
    const height = 55;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = rect.bottom + height + 8 <= window.innerHeight ? rect.bottom + 4 : Math.max(8, rect.top - height - 4);
    setPosition({ left, top });
  };
  const select = (color: string) => {
    onChange(color);
    setOpen(false);
    setPosition(null);
  };
  return (
    <span className="standard-color-picker">
      <input aria-label={ariaLabel ?? 'Color'} type="color" value={value} onChange={(event) => onChange(event.target.value)} />
      <details ref={detailsRef} open={open} onToggle={toggle}>
        <summary aria-label="Standard colors" title="Standard colors">Standard</summary>
      </details>
      {open && position && createPortal(
        <span className="standard-color-swatches" ref={swatchesRef} style={position}>
          {STANDARD_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              aria-label={color.name}
              title={color.name}
              className={value.toLowerCase() === color.value ? 'selected' : ''}
              style={{ backgroundColor: color.value }}
              onClick={() => select(color.value)}
            />
          ))}
        </span>,
        document.body,
      )}
    </span>
  );
}
