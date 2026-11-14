export {};

declare global {
  interface GlicoUpdateState {
    status: 'dev' | 'not-configured' | 'checking' | 'none' | 'available' | 'downloading' | 'ready' | 'error';
    version?: string;
    percent?: number;
    message?: string;
  }

  /** Ponte do Electron (desktop/preload.js). Ausente quando roda como página no navegador. */
  interface Window {
    glico?: {
      isElectron: true;
      getVersion(): Promise<string>;
      exportPdf(o: { from?: string; to?: string; fileName: string }): Promise<{ ok: boolean; canceled?: boolean; path?: string; error?: string }>;
      previewPdf(o: { from?: string; to?: string; fileName: string }): Promise<{ ok: boolean; error?: string }>;
      onImportFile(cb: (file: { name: string; bytes: Uint8Array }) => void): () => void;
      importFileDone(result: { name: string; ok: boolean; message?: string }): Promise<void>;
      openImportFolder(): Promise<string>;
      backupSave(json: string): Promise<void>;
      backupLoad(): Promise<string | null>;
      checkUpdate(): Promise<GlicoUpdateState>;
      downloadUpdate(): Promise<void>;
      installUpdate(): Promise<void>;
      onUpdate(cb: (s: GlicoUpdateState) => void): () => void;
    };
  }
}
