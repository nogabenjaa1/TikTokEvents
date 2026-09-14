import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ThemeProvider } from './ThemeContext.jsx'

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
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
