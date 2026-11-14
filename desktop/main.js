const { app, BrowserWindow, Menu, dialog, ipcMain, screen, session, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const { APP_URL, handleAppProtocol, openPdfPreview, registerAppScheme, renderReportPdf, safeFileName } = require('./pdf');

// Origem "app://glico" é segura (necessária para Web Bluetooth) e mantém o localStorage estável.
registerAppScheme();

/* ---------------- Backup automático (Documentos\Glico\backup.json) ---------------- */

// GLICO_DOCS_DIR existe só para testes automatizados (não mexer na pasta Documentos real).
const docsDir = () => process.env.GLICO_DOCS_DIR || app.getPath('documents');
const backupDir = () => path.join(docsDir(), 'Glico');
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

/* ---------------- Pasta de importação (Documentos\Glico\Importar) ---------------- */

const importDir = () => path.join(backupDir(), 'Importar');
const doneDir = () => path.join(backupDir(), 'Importados');
const errorDir = () => path.join(backupDir(), 'Erro');

let importTarget = null; // janela que está pronta para receber planilhas
let importWatcher = null;
const inFlight = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Espera o arquivo terminar de ser gravado/baixado (tamanho estável por 2 leituras). */
async function waitStable(file) {
  let last = -1;
  for (let i = 0; i < 25; i++) {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      return false;
    }
    if (size > 0 && size === last) return true;
    last = size;
    await sleep(800);
  }
  return false;
}

async function processImportFile(name) {
  // Só planilhas .xlsx, nunca arquivos temporários do Excel (~$...), e só o nome simples (sem subpastas).
  if (name !== path.basename(name) || !/\.xlsx$/i.test(name) || name.startsWith('~$')) return;
  if (!importTarget || importTarget.isDestroyed() || inFlight.has(name)) return;
  const file = path.join(importDir(), name);
  // Evento de remoção (acontece ao mover o arquivo para Importados): não há nada a importar.
  if (!fs.existsSync(file)) return;
  inFlight.add(name);
  let sent = false;
  try {
    if (!(await waitStable(file))) return;
    importTarget.send('import-file', { name, bytes: fs.readFileSync(file) });
    sent = true;
    // Rede de segurança: se a tela nunca responder, libera o nome depois de 2 minutos.
    setTimeout(() => inFlight.delete(name), 120_000).unref();
  } catch (e) {
    console.error('import: falha ao ler', name, e.message);
  } finally {
    // Só mantém o nome "em andamento" se o arquivo foi de fato entregue à tela
    // (nesse caso 'import-file-done' libera). Qualquer outro caminho precisa liberar,
    // senão uma planilha futura com o mesmo nome ficaria presa para sempre.
    if (!sent) inFlight.delete(name);
  }
}

function startImportFolder() {
  fs.mkdirSync(importDir(), { recursive: true });
  for (const n of fs.readdirSync(importDir())) void processImportFile(n); // o que já estava na pasta
  if (importWatcher) return;
  try {
    const timers = new Map();
    importWatcher = fs.watch(importDir(), (_evt, filename) => {
      if (!filename) return;
      const name = String(filename);
      clearTimeout(timers.get(name));
      timers.set(name, setTimeout(() => void processImportFile(name), 500)); // junta eventos repetidos
    });
    importWatcher.on('error', () => {
      importWatcher = null;
    });
  } catch (e) {
    console.error('import: não foi possível vigiar a pasta:', e.message);
  }
}

ipcMain.on('import-ready', (e) => {
  importTarget = e.sender;
  startImportFolder();
});

/** O app terminou de importar: move a planilha para Importados (ok) ou Erro (falha). */
ipcMain.handle('import-file-done', (_e, r = {}) => {
  const name = typeof r.name === 'string' ? path.basename(r.name) : '';
  inFlight.delete(name);
  if (!name) return;
  const from = path.join(importDir(), name);
  if (!fs.existsSync(from)) return;
  const destDir = r.ok ? doneDir() : errorDir();
  fs.mkdirSync(destDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  try {
    fs.renameSync(from, path.join(destDir, `${stamp}_${name}`));
  } catch (e) {
    console.error('import: não consegui mover', name, e.message);
  }
});

ipcMain.handle('import-open-folder', async () => {
  fs.mkdirSync(importDir(), { recursive: true });
  await shell.openPath(importDir());
  return importDir();
});

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
