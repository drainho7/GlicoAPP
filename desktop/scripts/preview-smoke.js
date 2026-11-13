// Teste de fumaça da pré-visualização: electron scripts/preview-smoke.js <readings.json> <captura.png>
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { registerAppScheme, handleAppProtocol, renderReportPdf, openPdfPreview, APP_URL } = require('../pdf');

const [readingsPath, outPng] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
registerAppScheme();
app.setPath('userData', path.join(app.getPath('temp'), 'glico-smoke-preview')); // não mexe nos dados reais

app.whenReady().then(async () => {
  handleAppProtocol();
  const rows = JSON.parse(fs.readFileSync(readingsPath, 'utf8')).map((r) => {
    const baseTime = r.baseTime.replace(' ', 'T').slice(0, 19);
    return { key: `caretech|${r.sequence}|${baseTime}`, time: r.adjustedTime.replace(' ', 'T').slice(0, 19), mgdl: r.mgdl, sequence: r.sequence, baseTime, offsetMinutes: r.offsetMinutes };
  });
  const seed = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await seed.loadURL(APP_URL);
  await seed.webContents.executeJavaScript(`localStorage.setItem('glico.web.readings.v1', ${JSON.stringify(JSON.stringify(rows))}); true`);

  const pdf = await renderReportPdf({ from: '2026-07-01', to: '2026-11-13' });
  const win = openPdfPreview(pdf, 'Relatorio-Teste.pdf', null);
  await new Promise((r) => setTimeout(r, 4000)); // tempo para o visualizador desenhar
  const img = await win.webContents.capturePage();
  fs.writeFileSync(outPng, img.toPNG());
  console.log('janela:', win.getTitle(), '| url:', win.webContents.getURL().slice(0, 40), '| captura:', img.getSize().width + 'x' + img.getSize().height);
  app.exit(0);
}).catch((e) => { console.error('FALHOU:', e); app.exit(1); });
