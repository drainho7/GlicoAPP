const { BrowserWindow, net, protocol } = require('electron');
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

module.exports = { APP_URL, registerAppScheme, handleAppProtocol, renderReportPdf };
