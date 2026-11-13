// Constrói o app web (Vite) e copia web/dist para desktop/dist.
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
execSync('npm run web:build', { cwd: root, stdio: 'inherit' });

const src = path.join(root, 'web', 'dist');
const dst = path.resolve(__dirname, '..', 'dist');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
console.log('web/dist copiado para desktop/dist');
