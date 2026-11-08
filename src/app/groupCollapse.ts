const KEY = 'pms.collapsedGroups';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

export function loadCollapsedGroups(store: Store, key = KEY): string[] {
  try {
    const value: unknown = JSON.parse(store.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export function saveCollapsedGroups(store: Store, groups: string[], key = KEY): void {
  try {
    store.setItem(key, JSON.stringify(groups));
  } catch {
    // The groups remain collapsed for this session if storage is unavailable.
  }
}
