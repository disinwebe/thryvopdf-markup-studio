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
    startupFiles(): Promise<PickedFile[]>;
    openFiles(opts?: { multi?: boolean; filters?: { name: string; extensions: string[] }[] }): Promise<PickedFile[]>;
    saveFile(args: {
      defaultName: string;
      data: Uint8Array | string;
      filters?: { name: string; extensions: string[] }[];
      path?: string;
    }): Promise<string | null>;
    saveMany(args: { files: { name: string; data: Uint8Array }[] }): Promise<string | null>;
    authStatus(): Promise<AuthStatus>;
    pickUploads(kind: 'files' | 'folder'): Promise<{ project: string; items: { token: string; name: string; rel: string; size: number }[]; truncated: boolean } | null>;
    sharedDocs(args: { op: 'list' | 'upload' | 'open' | 'ops' | 'poll' | 'leave' | 'delete'; id?: string; name?: string; project?: string; rel?: string; token?: string; bytes?: Uint8Array; upserts?: unknown[]; deletes?: string[]; cid?: string; since?: number; pr?: number }): Promise<any>;
    changePassword(args: { current: string; password: string; confirm: string }): Promise<AuthResult>;
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
