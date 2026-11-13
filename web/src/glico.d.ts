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
      backupSave(json: string): Promise<void>;
      backupLoad(): Promise<string | null>;
      checkUpdate(): Promise<GlicoUpdateState>;
      downloadUpdate(): Promise<void>;
      installUpdate(): Promise<void>;
      onUpdate(cb: (s: GlicoUpdateState) => void): () => void;
    };
  }
}
