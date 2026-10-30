// Pantalla de carga con el mismo modo (claro/oscuro) que va a tener el panel.
// Antes seguía al sistema (prefers-color-scheme), pero el panel arranca en
// claro salvo que la persona elija otra cosa en Tema (tkc_theme_mode, ver
// ThemeContext.jsx): con el sistema en oscuro se veía un parpadeo de oscuro a
// claro al cargar. Va en un archivo aparte porque la CSP no permite scripts en
// línea; es síncrono a propósito, para decidir antes del primer pintado.
(function () {
  var mode = 'light';
  try { mode = localStorage.getItem('tkc_theme_mode') || 'light'; } catch { /* sin storage: claro */ }
  var dark = mode === 'dark' || (mode === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (dark) document.documentElement.setAttribute('data-boot-mode', 'dark');
})();
