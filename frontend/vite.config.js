import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Las librerías base (React, el router y socket.io) van en su propio archivo
// "vendor": cambian muy poco, así que el navegador lo conserva en caché entre
// despliegues y solo vuelve a bajar el código de la app. Solo esas: con todo
// node_modules, Stripe (que hoy se baja solo al pagar) se cargaría siempre.
const VENDOR = /[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io)[\\/]/;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'vendor', test: VENDOR }],
        },
      },
    },
  },
});
