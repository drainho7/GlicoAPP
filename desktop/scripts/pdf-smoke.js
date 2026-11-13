// Teste de fumaça: electron scripts/pdf-smoke.js <readings.json> <saida.pdf> [from] [to]
// Usa o mesmo código do app (pdf.js) para gerar o relatório com leituras reais.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { registerAppScheme, handleAppProtocol, renderReportPdf, APP_URL } = require('../pdf');

const [readingsPath, outPdf, from, to] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
registerAppScheme();
app.setPath('userData', path.join(app.getPath('temp'), 'glico-smoke')); // não mexe nos dados reais

app.whenReady().then(async () => {
  handleAppProtocol();
  const rows = JSON.parse(fs.readFileSync(readingsPath, 'utf8'))
    .map((r) => {
      const baseTime = r.baseTime.replace(' ', 'T').slice(0, 19);
      return { key: `caretech|${r.sequence}|${baseTime}`, time: r.adjustedTime.replace(' ', 'T').slice(0, 19), mgdl: r.mgdl, sequence: r.sequence, baseTime, offsetMinutes: r.offsetMinutes };
    })
    .sort((a, b) => (a.time < b.time ? -1 : 1));

  const seed = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
  await seed.loadURL(APP_URL);
  await seed.webContents.executeJavaScript(`localStorage.setItem('glico.web.readings.v1', ${JSON.stringify(JSON.stringify(rows))}); true`);

  if (process.env.GLICO_EXAM) {
    const [value, date] = process.env.GLICO_EXAM.split(',');
    await seed.webContents.executeJavaScript(
      `localStorage.setItem('glico.web.settings.v1', ${JSON.stringify(JSON.stringify({ exam: { value: Number(value), date } }))}); true`,
    );
  }

  const pdf = await renderReportPdf({ from, to });
  fs.writeFileSync(outPdf, pdf);
  console.log('PDF gerado:', outPdf, pdf.length, 'bytes');
  app.exit(0);
}).catch((e) => { console.error('FALHOU:', e); app.exit(1); });
