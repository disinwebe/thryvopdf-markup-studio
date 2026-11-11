import { ActionIcon } from './ActionIcon';

export function SelectIcon({ theme }: { theme: 'light' | 'dark' }) {
  return <ActionIcon name="select" className={`tool-icon select-icon ${theme}`} />;
}
