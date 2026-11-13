const { app, BrowserWindow, net, protocol } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, 'dist');
const APP_URL = 'app://glico/index.html';

/** Deve ser chamado antes de app.whenReady(). */
function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
}

/** Serve desktop/dist em app://glico (chamar depois de app.whenReady()). */
function handleAppProtocol() {
  protocol.handle('app', (req) => {
    let p = decodeURIComponent(new URL(req.url).pathname);
    if (p === '/' || p === '') p = '/index.html';
    const file = path.normalize(path.join(DIST, p));
    if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString()).catch(() => new Response('not found', { status: 404 }));
  });
}

/** Renderiza a página de relatório numa janela invisível (mesma origem => mesmos dados) e devolve o PDF. */
async function renderReportPdf({ from, to } = {}) {
  const q = new URLSearchParams();
  if (from) q.set('from', String(from));
  if (to) q.set('to', String(to));
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.js') },
  });
  try {
    await win.loadURL(`${APP_URL}#/relatorio?${q}`);
    await win.webContents.executeJavaScript(
      'window.__reportReady ? true : new Promise((r) => window.addEventListener("report-ready", () => r(true), { once: true }))',
    );
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 0.35, bottom: 0.55, left: 0.35, right: 0.35 },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate:
        '<div style="width:100%;font-size:8px;color:#777;text-align:center;font-family:Segoe UI,Arial,sans-serif">' +
        'Glico · página <span class="pageNumber"></span> de <span class="totalPages"></span></div>',
    });
  } finally {
    win.destroy();
  }
}

/** Nome de arquivo seguro para o Windows. */
const safeFileName = (name) => String(name || 'Relatorio-Glicemia.pdf').replace(/[\\/:*?"<>|]/g, '-');

/**
 * Abre o PDF no visualizador embutido do Chromium: mostra as páginas exatamente como serão salvas,
 * com zoom e os botões de salvar e imprimir. O arquivo temporário é apagado ao fechar a janela.
 */
function openPdfPreview(pdf, fileName, parent) {
  const dir = path.join(app.getPath('temp'), 'glico-preview', String(Date.now()));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, safeFileName(fileName));
  fs.writeFileSync(file, pdf);

  const win = new BrowserWindow({
    parent: parent || undefined,
    width: 980,
    height: 1100,
    title: 'Pré-visualização do relatório',
    autoHideMenuBar: true,
    backgroundColor: '#525659',
    webPreferences: { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  win.on('closed', () => fs.rm(dir, { recursive: true, force: true }, () => {}));
  win.loadURL(pathToFileURL(file).toString());
  return win;
}

module.exports = { APP_URL, registerAppScheme, handleAppProtocol, renderReportPdf, openPdfPreview, safeFileName };
