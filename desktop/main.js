const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const { APP_URL, handleAppProtocol, registerAppScheme, renderReportPdf } = require('./pdf');

// Origem "app://glico" é segura (necessária para Web Bluetooth) e mantém o localStorage estável.
registerAppScheme();

/* ---------------- Backup automático (Documentos\Glico\backup.json) ---------------- */

const backupDir = () => path.join(app.getPath('documents'), 'Glico');
const backupFile = () => path.join(backupDir(), 'backup.json');

ipcMain.handle('backup-save', (_e, json) => {
  try {
    if (typeof json !== 'string' || json.length > 50_000_000) return;
    fs.mkdirSync(backupDir(), { recursive: true });
    const tmp = backupFile() + '.tmp';
    fs.writeFileSync(tmp, json, 'utf8');
    fs.renameSync(tmp, backupFile()); // gravação atômica: nunca deixa o backup pela metade
  } catch (e) {
    console.error('backup-save falhou:', e.message);
  }
});

ipcMain.handle('backup-load', () => {
  try {
    return fs.existsSync(backupFile()) ? fs.readFileSync(backupFile(), 'utf8') : null;
  } catch {
    return null;
  }
});

ipcMain.handle('app-version', () => app.getVersion());

/* ---------------- Relatório em PDF ---------------- */

ipcMain.handle('export-pdf', async (event, opts = {}) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const safeName = String(opts.fileName || 'Relatorio-Glicemia.pdf').replace(/[\\/:*?"<>|]/g, '-');
  const { canceled, filePath } = await dialog.showSaveDialog(parent, {
    title: 'Salvar relatório',
    defaultPath: path.join(app.getPath('documents'), safeName),
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };

  try {
    const pdf = await renderReportPdf({ from: opts.from, to: opts.to });
    fs.writeFileSync(filePath, pdf);
    shell.openPath(filePath);
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

/* ---------------- Atualizações ---------------- */

const sendUpdate = (state) => BrowserWindow.getAllWindows().forEach((w) => w.webContents.send('update-status', state));
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.on('update-available', (i) => sendUpdate({ status: 'available', version: i.version }));
autoUpdater.on('update-not-available', () => sendUpdate({ status: 'none' }));
autoUpdater.on('download-progress', (p) => sendUpdate({ status: 'downloading', percent: Math.round(p.percent) }));
autoUpdater.on('update-downloaded', (i) => sendUpdate({ status: 'ready', version: i.version }));
autoUpdater.on('error', (e) => sendUpdate({ status: 'error', message: String((e && e.message) || e) }));

ipcMain.handle('update-check', async () => {
  if (!app.isPackaged) return { status: 'dev' };
  try {
    const r = await autoUpdater.checkForUpdates();
    return { status: r && r.isUpdateAvailable ? 'available' : 'none', version: r && r.updateInfo && r.updateInfo.version };
  } catch (e) {
    const msg = String((e && e.message) || e);
    if (/app-update\.yml|ENOENT/i.test(msg)) return { status: 'not-configured' };
    return { status: 'error', message: msg };
  }
});
ipcMain.handle('update-download', () => autoUpdater.downloadUpdate().then(() => undefined));
ipcMain.handle('update-install', () => autoUpdater.quitAndInstall());

/* ---------------- Janela principal ---------------- */

function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 820,
    minWidth: 380,
    backgroundColor: '#0c0c0d',
    title: 'Glico',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // O app já filtra por serviço 0x1808 no requestDevice; aqui escolhemos o medidor sem janela extra.
  let timer = null;
  win.webContents.on('select-bluetooth-device', (event, devices, callback) => {
    event.preventDefault();
    clearTimeout(timer);
    const pick = devices.find((d) => /^meter\+/i.test(d.deviceName || '')) || devices[0];
    if (pick) return callback(pick.deviceId);
    timer = setTimeout(() => callback(''), 20000); // nenhum medidor achado: cancela
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.loadURL(APP_URL);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [w] = BrowserWindow.getAllWindows();
    if (w) {
      if (w.isMinimized()) w.restore();
      w.focus();
    }
  });

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    handleAppProtocol();
    createWindow();
    app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
  });

  app.on('window-all-closed', () => app.quit());
}
