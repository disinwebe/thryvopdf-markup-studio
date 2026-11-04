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
type AuthResult = { ok: true; user: AuthUser } | { ok: false; error: string };

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
