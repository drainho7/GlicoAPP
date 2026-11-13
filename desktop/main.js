const { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const { APP_URL, handleAppProtocol, openPdfPreview, registerAppScheme, renderReportPdf, safeFileName } = require('./pdf');

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

// Pré-visualização: gera o PDF e abre no visualizador (de lá o usuário salva ou imprime).
ipcMain.handle('preview-pdf', async (event, opts = {}) => {
  try {
    const pdf = await renderReportPdf({ from: opts.from, to: opts.to });
    openPdfPreview(pdf, opts.fileName, BrowserWindow.fromWebContents(event.sender));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

// Ao salvar pelo botão do visualizador, sugere Documentos\<nome do relatório>.
app.on('ready', () => {
  session.defaultSession.on('will-download', (_e, item) => {
    item.setSaveDialogOptions({
      title: 'Salvar relatório',
      defaultPath: path.join(app.getPath('documents'), safeFileName(item.getFilename())),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
  });
});

ipcMain.handle('export-pdf', async (event, opts = {}) => {
  const parent = BrowserWindow.fromWebContents(event.sender);
  const safeName = safeFileName(opts.fileName);
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

/* ---------------- Tamanho/posição da janela (lembrados entre aberturas) ---------------- */

const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return null;
  }
}

const onSomeDisplay = (b) =>
  screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y;
  });

/** Primeira abertura: janela larga e alta (tudo visível sem rolar), limitada à área útil da tela. */
function initialBounds(saved) {
  const ok = saved && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(saved[k]));
  if (ok && onSomeDisplay(saved)) return { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1020, wa.width);
  const height = Math.min(1400, wa.height);
  return { width, height, x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2) };
}

function createWindow() {
  const saved = loadWindowState();
  const win = new BrowserWindow({
    ...initialBounds(saved),
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

  if (saved && saved.maximized) win.maximize();
  win.on('close', () => {
    try {
      fs.writeFileSync(stateFile(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
    } catch (e) {
      console.error('window-state não gravado:', e.message); // lembrar a janela é só conforto
    }
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
