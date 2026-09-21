import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'
import AppErrorBoundary from './AppErrorBoundary.jsx'
import { installErrorReporting } from './errorReporter.js'

// Los errores del navegador (y de los overlays de OBS) llegan al admin en Sistema > Errores.
installErrorReporting()

// La hoja de la fuente (index.html) se pide con <link rel="preload"> para no bloquear el primer dibujo y se
// activa aquí, no con un "onload" en el HTML: así la política de seguridad no necesita permitir scripts en línea.
document.querySelectorAll('link[rel="preload"][as="style"]').forEach((link) => { link.rel = 'stylesheet' })

// BrowserRouter envuelve TODO, overlay de OBS incluido -- a propósito no
// pasa nada raro ahí: el overlay se identifica por query string
// (?overlay=true&screen=...), no por el pathname, así que un router activo
// no interfiere en absoluto con esa URL ya en uso en OBS de streamers
// reales (ver isOverlayMode/App.jsx, que sigue chequeando exactamente lo
// mismo que antes, solo que ahora el panel normal SÍ tiene rutas reales).
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AppErrorBoundary>
          <App />
        </AppErrorBoundary>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
