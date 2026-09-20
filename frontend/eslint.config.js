import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Estas cuatro reglas existen para preparar el código para el compilador
      // de React (React Compiler), que este proyecto no usa. Marcan patrones
      // que aquí son normales y correctos (cargar datos al montar con
      // setLoading(true), reiniciar un estado al cambiar una prop, funciones
      // que se llaman entre sí desde callbacks) y no son errores.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  {
    // Archivos que mezclan un componente con un contexto o con constantes.
    // En desarrollo, editarlos recarga la página completa en vez de refrescar
    // en caliente; en producción no cambia nada.
    files: ['src/ThemeContext.jsx', 'src/colorsData.jsx', 'src/lazyPanel.jsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
