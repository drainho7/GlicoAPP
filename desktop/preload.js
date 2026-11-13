const { contextBridge, ipcRenderer } = require('electron');

// Ponte mínima e explícita entre a tela e o sistema (a tela não tem acesso direto ao Node).
contextBridge.exposeInMainWorld('glico', {
  isElectron: true,
  getVersion: () => ipcRenderer.invoke('app-version'),
  exportPdf: (opts) => ipcRenderer.invoke('export-pdf', opts),
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
