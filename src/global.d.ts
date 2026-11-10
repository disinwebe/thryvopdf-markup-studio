/// <reference types="vite/client" />
interface PickedFile {
  path: string;
  name: string;
  data: Uint8Array;
}

interface AuthUser {
  name: string;
  email: string;
  discipline: string;
  role?: 'admin' | 'user';
  status?: string;
  mustChange?: boolean;
}
interface AppNotification { id: string; type: 'assignment' | 'registration' | 'review'; docId?: string; docName?: string; by?: string; message: string; created: string; read: boolean }
interface ManagedUser extends AuthUser {
  created?: string;
}
interface AuthStatus {
  mode: 'server' | 'local' | null;
  serverUrl: string;
  configured: boolean;
  online: boolean;
  hasUsers: boolean;
  user: AuthUser | null;
  error?: string;
}
type AuthResult = { ok: true; user: AuthUser; pending?: undefined } | { ok: true; pending: true; message: string; user?: undefined } | { ok: false; error: string };
interface Window {
  api?: {
    setMenuState(state: { signedIn: boolean; documentOpen: boolean; viewerActive: boolean; canUndo: boolean; canRedo: boolean; selected: boolean; canFlattenSelected?: boolean; canFlattenAll?: boolean; serverMode: boolean; blocked: boolean; viewOnly?: boolean }): void;
    setNativeTheme(theme: 'dark' | 'light'): void;
    onMenuAction(fn: (action: string) => void): () => void;
    quitApp(): Promise<void>;
    appVersion(): Promise<string>;
    showAbout(): Promise<void>;
    startupFiles(): Promise<PickedFile[]>;
    openFiles(opts?: { multi?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<PickedFile[]>;
    renameFile(args: { path: string; name: string }): Promise<{ ok: boolean; path?: string; error?: string }>;
    pickStamp(): Promise<PickedFile | null>;
    saveFile(args: {
      defaultName: string;
      data: Uint8Array | string;
      filters?: { name: string; extensions: string[] }[];
      path?: string;
    }): Promise<string | null>;
    openSavedPdf(path: string): Promise<{ ok: boolean; error?: string }>;
    saveMany(args: { files: { name: string; data: Uint8Array }[] }): Promise<string | null>;
    authStatus(): Promise<AuthStatus>;
    licenseStatus(): Promise<{ ok: boolean; device?: string; id?: string; error?: string }>;
    importLicense(): Promise<{ ok: boolean; cancelled?: boolean; error?: string }>;
    pickUploads(kind: 'files' | 'folder'): Promise<{ project: string; items: { token: string; name: string; rel: string; size: number }[]; truncated: boolean } | null>;
    sharedDocs(args: { op: 'list' | 'users' | 'upload' | 'open' | 'ops' | 'poll' | 'leave' | 'delete' | 'meta' | 'rename-group' | 'delete-group' | 'members' | 'review'; id?: string; name?: string; project?: string; newProject?: string; revision?: string; description?: string; rel?: string; token?: string; bytes?: Uint8Array; members?: string[]; upserts?: unknown[]; deletes?: string[]; cid?: string; since?: number; pr?: number; done?: boolean }): Promise<any>;
    changePassword(args: { current: string; password: string; confirm: string }): Promise<AuthResult>;
    notifications(args?: { read?: string[] | 'all'; clear?: boolean }): Promise<{ ok: boolean; error?: string; notifications?: AppNotification[]; unread?: number }>;
    adminList(): Promise<{ ok: boolean; error?: string; users?: ManagedUser[] }>;
    adminAction(args: { email: string; action: string; role?: string }): Promise<{ ok: boolean; error?: string; tempPassword?: string }>;
    testServer(url: string): Promise<{ ok: boolean; error?: string; url?: string; hasUsers?: boolean }>;
    configureAuth(args: { mode: 'server' | 'local'; serverUrl?: string }): Promise<{ ok: boolean; error?: string }>;
    register(args: { name: string; email: string; discipline: string; password: string; confirm: string }): Promise<AuthResult>;
    login(args: { email: string; password: string }): Promise<AuthResult>;
    logout(): Promise<{ ok: true }>;
  };
}

declare module '*.mjs?url' {
  const url: string;
  export default url;
}
