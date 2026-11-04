/// <reference types="vite/client" />
interface PickedFile {
  path: string;
  name: string;
  data: Uint8Array;
}

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
  };
}

declare module '*.mjs?url' {
  const url: string;
  export default url;
}
