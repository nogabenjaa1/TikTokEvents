// Copia frontend/dist (build de Vite) a backend/public, de donde Express
// sirve el sitio en producción (ver backend/server.js). Se corre como parte
// de `npm run build` en la raíz del proyecto.
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'frontend', 'dist');
const dest = path.join(__dirname, '..', 'backend', 'public');

if (!fs.existsSync(src)) {
    console.error('No existe frontend/dist — corré "npm run build --prefix frontend" primero.');
    process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

console.log(`Copiado ${src} -> ${dest}`);
