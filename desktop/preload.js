const { contextBridge, ipcRenderer } = require('electron');

// Ponte mínima e explícita entre a tela e o sistema (a tela não tem acesso direto ao Node).
contextBridge.exposeInMainWorld('glico', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app-version'),
  exportPdf: (opts) => ipcRenderer.invoke('export-pdf', opts),
  previewPdf: (opts) => ipcRenderer.invoke('preview-pdf', opts),
  // Pasta de importação (Documentos\Glico\Importar): o app avisa quando chega uma planilha e depois recebe o resultado.
  onImportFile: (cb) => {
    const fn = (_e, file) => cb(file);
    ipcRenderer.on('import-file', fn);
    ipcRenderer.send('import-ready'); // a partir daqui o app pode entregar planilhas
    return () => ipcRenderer.removeListener('import-file', fn);
  },
  importFileDone: (result) => ipcRenderer.invoke('import-file-done', result),
  openImportFolder: () => ipcRenderer.invoke('import-open-folder'),
  backupSave: (json) => ipcRenderer.invoke('backup-save', json),
  backupLoad: () => ipcRenderer.invoke('backup-load'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdate: (cb) => {
    const fn = (_e, state) => cb(state);
    ipcRenderer.on('update-status', fn);
    return () => ipcRenderer.removeListener('update-status', fn);
  },
});
