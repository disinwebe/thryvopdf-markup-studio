import { ActionIcon } from './ActionIcon';

export function SaveIcon({ inverted = false }: { inverted?: boolean }) {
  return <ActionIcon name="save" className="folder-icon" mirrored={inverted} />;
}
