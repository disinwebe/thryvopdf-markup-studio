import { ActionIcon, type ActionIconName } from './ActionIcon';

export type ContextMenuAction = 'cut' | 'copy' | 'paste' | 'select' | 'pan' | 'zoom-in' | 'zoom-out' | 'flatten' | 'flatten-all' | 'bring-front' | 'bring-back' | 'group' | 'ungroup';

const actionIcons: Record<ContextMenuAction, ActionIconName> = {
  cut: 'cut', copy: 'copy', paste: 'paste', select: 'select', pan: 'pan',
  'zoom-in': 'zoom-in', 'zoom-out': 'zoom-out', flatten: 'flatten',
  'flatten-all': 'flatten-all', 'bring-front': 'bring-front', 'bring-back': 'bring-back',
  group: 'group', ungroup: 'ungroup',
};

export function ContextMenuIcon({ action }: { action: ContextMenuAction }) {
  return <ActionIcon name={actionIcons[action]} className="context-menu-icon" />;
}
