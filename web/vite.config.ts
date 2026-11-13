import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Serve data/readings.json (gerado por tools/ble_diag.py) em /data/readings.json durante o dev. */
const serveData = () => ({
  name: 'serve-data',
  configureServer(server: { middlewares: { use: (p: string, h: (req: unknown, res: any) => void) => void } }) {
    server.middlewares.use('/data/readings.json', (_req, res) => {
      const p = path.resolve(__dirname, '../data/readings.json');
      if (!fs.existsSync(p)) {
        res.statusCode = 404;
        return res.end();
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(fs.readFileSync(p));
    });
  },
});

export default defineConfig({
  plugins: [react(), serveData()],
  server: { fs: { allow: ['..'] }, port: 5173 },
  build: { outDir: 'dist' },
});
