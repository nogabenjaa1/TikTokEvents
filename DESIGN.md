---
name: TikTok Concurso
description: Cabina de control oscura para correr minijuegos de regalos de TikTok LIVE, con overlay para OBS.
colors:
  accent: "#7C3AED"
  accent-blue: "#3B82F6"
  accent-pink: "#EC4899"
  page: "#0F0E13"
  rail: "#0B0A0F"
  surface: "#17161D"
  surface-sunken: "#121117"
  surface-raised: "#1F1E26"
  ink-primary: "#F2F1F5"
  ink-secondary: "#B4B1BF"
  ink-tertiary: "#8A8797"
  page-light: "#F7F7F9"
  rail-light: "#EFEFF3"
  surface-light: "#FFFFFF"
  surface-sunken-light: "#F3F3F6"
  surface-raised-light: "#ECECF1"
  ink-primary-light: "#16131D"
  ink-secondary-light: "#4A4656"
  ink-tertiary-light: "#66626F"
  overlay-page: "#A69AD8"
  overlay-surface: "#C0B2F9"
  overlay-surface-alt: "#B2A8E0"
  overlay-ink: "#2E2136"
  danger: "#EF4444"
  warning: "#F59E0B"
  success: "#10B981"
  ink-danger: "#B91C1C"
  ink-warning: "#A16207"
  ink-success: "#15803D"
  ink-premio: "#047857"
  ink-info: "#0369A1"
  ink-amber: "#B45309"
  rainbow-red: "#ff3b3b"
  rainbow-orange: "#ff9f1c"
  rainbow-yellow: "#ffe135"
  rainbow-green: "#3ddc84"
  rainbow-blue: "#3b82f6"
  rainbow-purple: "#a855f7"
  neutral-muted: "#6B7280"
  ink: "#FFFFFF"
  page-black: "#05030A"
  scrollbar-track: "#0A0614"
  scrollbar-thumb: "#3E266E"
  scrollbar-thumb-hover: "#6B21A8"
  overlay-playing: "#22C55E"
typography:
  title:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "0.3em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 900
    lineHeight: 1.2
    letterSpacing: "0.05em"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "normal"
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "0.15em"
  control:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: "0.1em"
  overlay-display-sm:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "normal"
  overlay-display-md:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 900
    lineHeight: 1.1
    letterSpacing: "normal"
  overlay-display-lg:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "40px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "normal"
  overlay-display-xl:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "52px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "normal"
  overlay-display-2xl:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "56px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "normal"
  overlay-display-hero:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "80px"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "-0.05em"
rounded:
  sm: "0.625rem"
  md: "0.875rem"
  overlay-sm: "0.75rem"
  overlay-lg: "1.5rem"
  scrollbar: "10px"
  pill: "999px"
spacing:
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  input:
    backgroundColor: "{colors.surface-sunken}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.sm}"
    padding: "10px 12px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.md}"
  chip:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
---

# Design System: TikTok Concurso

## Overview

**Creative North Star: "La Cabina de Control"**

TikTok Concurso es la cabina de control del streamer: una interfaz densa en estado, pensada para leerse de un vistazo en medio de un LIVE. Desde noviembre de 2026 el panel tiene **un solo diseño, el tema maestro**, más **un color de acento** que elige el streamer. Ya no hay materiales ni skins: fondo, superficies, bordes, radios, sombras, tipografía, espaciado y movimiento son iguales con cualquier acento.

Dirección: **estándar premium**, a la altura de Linear, Raycast, Stripe o Vercel en oficio (no en copia). La personalidad de arcade vive en el peso tipográfico y en la energía del acento sobre una cabina oscura y quieta, no en adornos, degradados ni brillos. Se eligió en la ronda de dirección de impeccable (dos tiradas descartadas; el dueño tomó la salida estándar).

- **Oscuro de fábrica**, con apariencia **Clara** y **Automática** como alternativa (misma geometría, otra luz). El streamer trabaja junto a OBS, casi siempre de noche o con la sala a media luz.
- **El acento pinta solo lo que depende de él**: botón principal, selección, navegación activa, foco, chips y texto de acento. Nada más.
- **Los colores de estado** (peligro, aviso, éxito/premio, información) son fijos y nunca siguen al acento.
- **Los overlays de OBS conservan su aspecto pastel de siempre** (el antiguo material Clásico), teñido del acento, y siguen sincronizados por socket. No usan el tema maestro.

**Historia.** Hasta octubre de 2026 el panel tenía dos materiales (Clásico y Cute) sobre un fondo pastel teñido del acento, y antes cuatro (Kawaii y Minimal se retiraron). El tema guardado conserva el campo `style` por compatibilidad con el servidor y con los overlays: siempre vale `"default"`, y quien tenía Cute (en el navegador o en la base) se migra al leerlo, conservando acento y color (`normalizeTheme` en `themeModel.js`). No hubo migración de base de datos.

## Colors

### Acento

Tres de fábrica (**Morado** `#7C3AED`, **Azul** `#3B82F6`, **Rosa** `#EC4899`) o **Personalizado** con cualquier color. Los ids (`purple`, `blue`, `pink`, `custom`) son los que valida el servidor (`lib/tenantSanitizers.js`).

En el panel, `ThemedShell` calcula cinco variables a partir del acento y la apariencia activa (`accentTokens` en `themeModel.js`) y las pone inline:
- `--accent`: el relleno (botón principal, foco, borde de selección).
- `--accent-hover` / `--accent-active`: el mismo matiz, más claro u oscuro.
- `--on-accent`: el texto encima del relleno, blanco o tinta oscura, el que contraste más.
- `--accent-text`: el acento como texto sobre el fondo de página, ajustado hasta 4.5:1.

**La Regla del Acento con Límites.** Un color personalizado puede ser casi blanco, casi negro o gris. Se conserva siempre su matiz, pero luminosidad y croma se llevan al rango donde funciona como acento (oscuro: L 0.53–0.88; claro: L 0.46–0.62; croma 0.09–0.26). La pantalla de Tema avisa cuando ajustó el color. Las pruebas (`themeModel.test.js`) exigen con cualquier color 4.5:1 en el texto del botón y en el texto de acento, y 3:1 del botón contra el fondo. Los overlays de OBS usan el color tal como se eligió.

### Neutros (fijos, no siguen al acento)

Un matiz violeta muy leve y fijo en todos los neutros; la marca vive en el acento.

| Token | Oscuro | Claro | Uso |
|---|---|---|---|
| `--page-bg` | `#0F0E13` | `#F7F7F9` | Fondo de página |
| `--rail-bg` | `#0B0A0F` | `#EFEFF3` | Barra lateral (una capa más profunda) |
| `--surface-bg` | `#17161D` | `#FFFFFF` | Tarjetas |
| `--surface-bg-alt` | `#121117` | `#F3F3F6` | Campos, zonas hundidas |
| `--surface-raised` | `#1F1E26` | `#ECECF1` | Hover de opciones y botones secundarios |
| `--surface-border-color` | blanco 8% | tinta 10% | Borde de tarjeta |
| `--line-strong` | blanco 14% | tinta 18% | Borde de campos y botones secundarios |
| `--ink` | `#F2F1F5` | `#16131D` | Texto principal |
| `--ink-2` | `#B4B1BF` | `#4A4656` | Texto secundario, etiquetas |
| `--ink-3` | `#8A8797` | `#66626F` | Ayudas, metadatos (4.5:1 sobre página y tarjeta) |

El código escribe `text-white` / `text-gray-*` pensando en fondo oscuro: dentro del tema maestro se llevan a los tres niveles de tinta (`white`–`gray-200` → `--ink`, `gray-300`–`400` → `--ink-2`, `gray-500`–`700` → `--ink-3`), así también funcionan en claro.

### Barra de desplazamiento y fondo base

El fondo del `body` (`page-black`, `#05030A`) solo se ve mientras carga la página y detrás de los overlays transparentes; encima va siempre el fondo temático de cada skin. La barra de desplazamiento del navegador es oscura y morada en todos los skins (`scrollbar-track` `#0A0614`, `scrollbar-thumb` `#3E266E`, al pasar el mouse `#6B21A8`, esquinas de `10px`): los navegadores no le pasan variables CSS del tema, así que no sigue el acento.

### Verde de la canción sonando (overlay de música)

El overlay de la cola de Spotify marca la canción que está sonando con un borde `overlay-playing` (`#22C55E`) y un resplandor del mismo verde. Es un color de "en vivo" pensado para verse sobre la escena del directo, así que no sale de los tokens de estado del panel (que son más oscuros para leerse sobre el pastel).

### Estado (fijos, no siguen el acento elegido)
- **Rojo Alerta** (`#EF4444`): ventanas de snipe/peligro, licencias revocadas, errores. Siempre en pares badge (fondo `red-950/70` + borde `red-500/70` + texto claro).
- **Ámbar Aviso** (`#F59E0B`): avisos de vencimiento de licencia, estados "por vencer" o "verificando".
- **Esmeralda Premio** (`#10B981`): franja de premio compartida por los tres juegos y estado "activa"/"conectado en vivo" — casualmente comparte hex con el acento verde, pero es un token de estado independiente, no cambia si el streamer elige otro acento.
- **Gris Apagado** (`#6B7280`): estados offline, deshabilitado, texto secundario de baja prioridad.
- **Overlays y sus vistas previas**: títulos y etiquetas usan el acento a `L 0.36` (`--tkc-accent-ink-l`); el panel no lo hereda.
- **Texto de estado sobre tarjetas**: las utilidades `text-red/amber/yellow/green/emerald/sky-*` del panel usan la tinta de estado mezclada con `--status-mix` (como los avisos), igual que `theme-btn-danger`/`-warning`; sola, la tinta daba entre 1.6:1 y 4:1 (axe).
- **Tintas de estado** (`--ink-danger` `#B91C1C`, `--ink-warning` `#A16207`, `--ink-success` `#15803D`, `--ink-premio` `#047857`, `--ink-info` `#0369A1`, `--ink-amber` `#B45309`): versiones oscuras de los colores de estado, usadas SOLO para texto sobre los paneles claros (`.themed-panel`), donde los tonos vivos de arriba no alcanzan contraste. Viven como variables en `index.css` y son la única fuente de estos valores.
- **Arcoíris** (`#FF6363`, `#FFA23A`, `#FFD93D`, `#4CE38A`, `#2EDCF2`, `#6FB1FF`, `#B08CFF`, `#FF7AC6`, oct 2026): degradado de la opción "Arcoíris" del fondo/texto de los overlays y de la ruleta. Luminancia pareja de 0.31 a 0.72 (antes `#3b82f6`/`#a855f7` bajaban a 0.22 y apagaban medio ciclo); el degradado cierra en el tono con que empieza. Una sola fuente en código: `RAINBOW_STOPS` (`overlayCustomization.js`), copiada en `index.css`. Es deliberadamente independiente del acento del tema y solo aparece cuando el streamer lo elige.

### Named Rules
**La Regla del Faro Único.** El acento es el único color saturado de la interfaz fuera de los estados (rojo/ámbar/esmeralda). Ningún elemento decorativo compite con él.

**La Regla de la Cabina Quieta.** Ningún fondo, superficie, borde ni sombra del panel cambia con el acento. Si elegir otro color mueve algo que no sea acento, es un error.

### Apariencia (claro / oscuro / automático)

Preferencia de cada navegador (`tkc_theme_mode`), de fábrica **Oscuro**; quien ya había elegido una la conserva. La aplica `ThemedShell` con `data-mode`. El overlay de OBS no la lleva, y las vistas previas de overlay dentro del panel se marcan `data-mode="light"` como islas con el aspecto de OBS. Las tintas de estado tienen versión clara (oscuro) y oscura (claro).

## Typography

**Display/Body Font:** Sora (Google Fonts), puesta como `--font-sans` en `index.css`; si no carga, cae a la del sistema.

**Character:** Una sola familia tipográfica hace todo el trabajo; la jerarquía se construye enteramente con peso, tamaño y `letter-spacing`, no con variedad de fuentes. El registro dominante es la "etiqueta": mayúsculas, `tracking` amplio, peso `black` — el mismo tratamiento para el nombre de un módulo, un badge de estado o un botón.

### Hierarchy
- **Headline** (peso 900/`font-black`, 24px, `tracking-widest`): títulos de pantalla completa poco frecuentes — p. ej. "OFFLINE" en la tarjeta del overlay sin conexión.
- **Title** (peso 900/`font-black`, 10px, `tracking-[0.3em]`, mayúsculas): la voz dominante del sistema — encabezados de módulo ("KING", "🔑 Licencias", "🎨 Tema"). Actúa como un eyebrow gigante en vez de un título tradicional.
- **Body** (peso 700, 14px): nombres de usuario, texto de mensajes de error, contenido variable.
- **Display de overlay** (peso 900, 28 / 32 / 40 / 52 / 56 / 80px): los números y textos grandes de los overlays de OBS (el cronómetro de Rey del Trono, los contadores y nombres de ganador, el conteo de Eliminación y Ruleta). Se leen desde lejos sobre la escena del directo, por eso salen de la escala del panel. Solo se usan dentro de los overlays, nunca en el panel de control.
- **Control** (peso 700–900, 12px, `tracking-widest`): el texto de los botones medianos (`theme-btn-md`) y de los avisos (`theme-notice`). Los botones pequeños usan el paso Title (10px) y los grandes el Body (14px).
- **Label** (peso 700, 11px, `tracking-widest`, mayúsculas): etiquetas de formulario, badges de estado, metadata secundaria (fechas, contadores de uso).

### Escala de texto del panel (`index.css`, oct 2026)
El panel acumulaba más de 450 textos de 8 a 11px escritos a mano. Para lo nuevo (y lo que se toque) hay tres clases, que no fijan color salvo la ayuda:
- **`tkc-eyebrow`** (11px, 900, `0.24em`, mayúsculas): antetítulo de pantalla ("DASHBOARD", "MEMBRESÍA").
- **`tkc-label`** (11px, 800, `0.12em`, mayúsculas): etiqueta de campo, título de grupo, dato de estado.
- **`tkc-hint`** (12px, interlineado 1.35, tinta al 80%): ayuda o descripción **dentro de una tarjeta**. Sobre el fondo de página se usa `text-xs`/`text-sm` con `text-gray-500` (88%), que es lo que pasa 4.5:1 ahí.
- Nada por debajo de 11px salvo lo que depende del espacio (nombres en las cuadrículas de participantes, la insignia sobre un avatar, las etiquetas del dock).

### Named Rules
**La Regla de la Mayúscula Obligatoria.** Todo lo que es etiqueta, botón o estado va en mayúsculas con tracking amplio. El texto en minúsculas queda reservado casi exclusivamente para contenido variable (usernames, mensajes).

## Layout

Layout de aplicación de una sola pantalla (no hay scroll de página, cada panel maneja su propio `overflow-y-auto`). Estructura fija: sidebar de navegación de íconos a la izquierda (72px), barra de conexión TikTok flotante fija en la esquina superior derecha, y un panel principal central que ocupa el resto del viewport. No hay grilla responsive tradicional — la app está diseñada para una ventana de escritorio (el streamer trabajando junto a OBS), no para mobile.

**Paneles de los juegos** (Rey del Trono, Zubastinis, Eliminación, Ruleta: `.tkc-game-layout`): en móvil una columna en el orden de siempre (vista previa, ajustes, controles, premio); desde 1024px, la cabina a la izquierda (vista previa, controles de Iniciar/Pausar/Detener y premio) y los ajustes a la derecha. Un juego nuevo usa las mismas clases (`tkc-game-main` para los ajustes, `tkc-game-controls` para los botones).

**Dashboard**: los eventos van en tres tarjetas por grupo (una fila por evento, `tkc-row-link`) y las herramientas en tarjetas compactas (`tkc-card-link`); "Requiere licencia" se dice una vez, no por tarjeta.

El overlay de OBS es un layout completamente aparte, sin sidebar ni chrome: solo la tarjeta o card del juego activo, pensada para recortarse directamente como fuente de captura.

## Elevation & Depth

Poca y real. Las tarjetas llevan un borde fino y, en oscuro, un brillo interior de 1px arriba más una sombra larga y suave hacia abajo (`--surface-shadow`); en claro, una sombra corta y otra larga muy tenue. Sin glows de color ni sombras teñidas del acento. La barra lateral no lleva sombra: se separa por ser una capa más oscura que la página.

## Shapes

Radios fijos: `0.875rem` en tarjetas (`--surface-radius`), `0.625rem` en controles (`--surface-radius-sm`), píldora solo en chips y avisos de estado. Un componente nuevo lee las variables, nunca un radio a mano.

## Components

Táctil y de arcade: los componentes tienen peso, glow y transición suave (0.35s) en cada cambio de propiedad visual al alternar de tema — nunca un corte abrupto.

### Buttons
- **Primario** (`theme-btn-primary`): `--accent` sólido, texto `--on-accent`, sin degradado ni brillo. Hover `--accent-hover`, presionado `--accent-active` y escala 0.97. Uno por zona: es la acción principal.
- **Secundario** (`theme-btn-secondary`): transparente con borde `--line-strong` y texto `--ink`; hover `--surface-raised`. No lleva acento.
- **Peligro / aviso** (`theme-btn-danger`, `theme-btn-warning`): colores de estado fijos.
- **Deshabilitado**: opacidad 45% y cursor `not-allowed`.

### Tallas de botón
Tres, y solo tres, que se suman al tipo de botón (`theme-btn-primary`, `-secondary`, `-danger`, `-warning`). Antes cada archivo decidía a mano su relleno y su tamaño de texto (25 combinaciones distintas entre los primarios).
- **`theme-btn-sm`** — relleno `8px 12px`, texto de 10px: barras de herramientas, alternadores y acciones dentro de una fila.
- **`theme-btn-md`** — relleno `12px 16px`, texto de 12px: la talla normal de formularios y paneles.
- **`theme-btn-lg`** — relleno `16px 24px`, texto de 14px: la acción principal de una pantalla (Iniciar, Detener, Guardar).
- Excepciones a propósito: botones de tamaño fijo (el botón flotante 🎉, las flechas circulares de una fila desplazable, los selectores de dados) y el botón de ancho especial de Color Says.
- El radio no se declara en el botón: lo pone el tema (`--surface-radius-sm`). Escribir `rounded-xl` en un botón de tema no hace nada.

### Avisos (`theme-notice`)
Un solo aspecto para las cajas de error, atención y éxito: relleno `8px 12px` (`theme-notice-roomy`: `12px 16px`), radio del tema (`var(--surface-radius-sm)`: 10px en el panel, 12px en los overlays), borde y fondo del color de estado al 40% y 10%, texto de 12px en negrita. Variantes: `theme-notice` (peligro, la de fábrica), `theme-notice-warning` y `theme-notice-success`.
- El texto usa el token de tinta de estado (`--ink-*`) **mezclado 58% (antes 65%) con negro en modo claro y con blanco en oscuro** (`--status-mix`), lo que da al menos 4,5:1 sobre el pastel y sobre el fondo oscuro. Mezclar con la tinta morada movía el matiz (el verde salía azul): con un acromático el rojo, el ámbar, el verde y el azul siguen reconociéndose.
- Los avisos de ancho completo (las franjas de arriba de la pantalla) siguen siendo componentes propios.

### Enlaces de texto (`theme-link`)
Botones sin caja: subrayados, texto de 11px en negrita (antes 10px), área de toque de 8px arriba y abajo y un cambio visible al pasar el cursor. Por defecto en tinta apagada; `theme-link-danger`, `theme-link-info` y `theme-link-warning` para acciones destructivas, informativas y de atención. Usan los mismos tonos de estado que los avisos.

### Chips
- Fondo del acento al 16%, texto `--accent-text`, píldora. Los badges de estado (Activa, Revocada, Por vencer) usan los colores de estado, no el acento.

### Cards / Containers (`.theme-surface`)
- `--surface-bg`, borde `--surface-border`, radio `--surface-radius`, sombra `--surface-shadow`. `theme-surface-featured` suma un borde del acento al 40% para el bloque destacado de una pantalla.
- **Opción seleccionable** (`tkc-option`, pantalla de Tema): fila de 44px de alto mínimo con borde fino; seleccionada, borde y aro interior del acento (`aria-checked="true"`).

### Casillas, opciones, archivos y colores
Ningún control se queda con el aspecto del navegador. Dentro del panel (`.themed-panel`), y sin tocar cada componente:
- **Casilla y opción** (`checkbox`, `radio`): caja del color de los campos (`--surface-bg-alt`) con borde del acento al 55%; la casilla con radio de 6px y la opción redonda. Al marcarlas se llenan del acento con un latido corto (`tkc-check-pop`) y aparece la palomita blanca (o el punto). Al pasar el cursor, un halo suave del acento. Las que forman un interruptor (`.tkc-switch`, con `.sr-only`) quedan fuera.
- **Selector de archivo**: el botón "Elegir archivo" del navegador toma la forma de `theme-btn-secondary`.
- **Muestra de color**: cuadro con el radio y el borde del tema, sin el marco gris del navegador.
- Los deslizadores (`range`) ya tenían su estilo propio (pista del color de la tinta, perilla del acento).

### Inputs / Fields
- Fondo `--surface-bg-alt`, borde `--line-strong`, radio `--surface-radius-sm`.
- **Foco**: borde del acento y aro de 3px del acento al 28%.
- **Deshabilitado**: opacidad 50% y cursor `not-allowed`.

### Arquitectura de navegación (nov 2026)
La navegación va por **áreas** según lo que hace el streamer, no por módulo técnico (`NAV_AREAS` y `AREA_TABS` en `app/navigation.js`):

- **Inicio**: estado de la conexión con TikTok, TTS, plan y sistema; lo que está en curso; primeros pasos; actividad en vivo; resumen de todo lo del directo.
- **Directo**
  - **Juegos**: Rey del Trono · Zubastinis · Eliminación · Ruleta · Versus · Color Says.
  - **Alertas y chat**: Alertas · TTS · Chat · Spotify.
  - **Metas y tiempo**: Extensible · Objetivo.
  - **Overlays de OBS**.
- **Herramientas**: Descargas.
- **Cuenta**: Mi plan · Tema.
- **Administración** (solo admin): Licencias · Sistema.

Antes, "Eventos" juntaba 11 pestañas de tres tipos y Color Says vivía aparte como "ColorDice". **Las URLs no cambiaron** (`/tiktokevents/<pestaña>`, `/colordice`, `/overlays`…): `areaOf` deduce el área a partir de `sidebarMode` y `eventsTab`, así que los marcadores, los enlaces y las URLs de OBS siguen igual y `lib/sitePages.js` no cambia. Volver a un área de Directo abre la última pestaña usada en ella.

### Navegación principal (`AppSidebar.jsx`)
- **Escritorio (md+)**: columna de 224px en `--rail-bg`. Arriba la marca; las áreas, agrupadas con su rótulo (Directo, Herramientas, Cuenta, Administración); al pie, el **estado de TikTok LIVE** (lleva a Inicio, donde se conecta) y la **cuenta** (@usuario y plan, lleva a Mi plan; botón de cerrar sesión, con el aviso si hay un juego activo). El panel mide el alto de la ventana (`.tkc-shell`) y el área principal es la que se desplaza, así el pie siempre se ve.
- **Celular**: barra superior con la marca y el estado del LIVE (`.tkc-mobilebar`) y barra inferior fija (`.tkc-tabbar`) con Inicio · Juegos · Alertas · Overlays · Más. "Más" abre una hoja (`<dialog>`) con el resto de las áreas, la cuenta y cerrar sesión. Se retiró el botón flotante "Ir a TikTokEvents": la barra inferior ya está siempre a mano.
- Activa: texto `--accent-text`, fondo del acento al 16%, y `aria-current="page"`.
- **El fondo activo es un indicador que se desliza** (`NavIndicator`, `.tkc-nav-indicator`): un solo elemento con las clases del botón activo viaja de un elemento al otro. Un botón de navegación nuevo lleva `tkc-nav-item` y `aria-current="page"` cuando está activo; la barra que lo contiene necesita `position: relative` (en `ScrollRow` basta pasar `activeKey`). Ver Motion.

### Encabezado de área (`AreaHeader.jsx`, `.tkc-area-head`)
En Juegos, Alertas y chat y Metas y tiempo: el nombre del área (el único h1 de la pantalla), el estado del servidor, TikTok y la voz, y las pestañas del área con el punto de estado de cada evento. Queda fijo arriba al desplazarse, para cambiar de juego en medio de un directo sin buscar la barra.

### Pestañas (`.tkc-tab`)
Las barras de Eventos, Overlays y Sistema: pestañas de 36px con texto de 13px en tinta secundaria, la activa en `--accent-text` con el indicador deslizante (`tkc-tab-indicator`). Sin mayúsculas.

### Títulos y textos de apoyo
- `tkc-page-title` (24px, 800): el título de una pantalla. Sin antetítulo encima.
- `tkc-section-title` (14px, 700): título de un bloque de la pantalla.
- `tkc-card-title` (13px, 700, tinta secundaria): título dentro de una tarjeta.
- `tkc-field-label` (12px, 700): etiqueta de campo.
- `tkc-meta` (12px, 600, tinta terciaria): metadatos y notas cortas.
- Las mayúsculas quedan para la acción principal de un botón (con tracking de 0.06em); etiquetas, pestañas y títulos van en minúsculas normales.

### Estado y filtros
- `tkc-status-pill`: estado en vivo (neutro; `tkc-status-live` en verde de estado con un punto que late).
- `tkc-filter`: filtro en fila con `aria-pressed`; elegido, relleno del acento.
- `theme-notice-info`: aviso informativo (azul de estado), para lo que no es error ni advertencia (p. ej. "Necesitas una licencia…").

### Paneles de juego (`GameStage`, `SettingsTitle` en `PanelHelp.jsx`)
Rey del Trono, Zubastinis, Eliminación y Ruleta comparten la misma estructura (`.tkc-game-layout`): **escenario**, **controles** y **premio** a la izquierda; **ajustes** a la derecha. En el celular, una columna.
- **Escenario** (`GameStage`, `.tkc-stage`): el nombre del juego, la **fase** como píldora (`.tkc-phase`) y el **reloj** grande (`.tkc-timer`, 48px, cifras tabulares). Debajo, lo propio de cada juego: quién está en el trono (Rey del Trono), el top 3 con puestos y monedas (Zubastinis), los que siguen en pie, el último sorteo y las entradas de cada uno (Eliminación), las entradas en juego (Ruleta).
- **Tonos de fase**: `idle` (sin iniciar o esperando), `live` (en curso; el punto late), `snipe` (snipe o reingreso, rojo), `tiebreak` (desempate, ámbar), `paused` (en pausa), `finished` (terminado, verde) y `nowinner` (sin ganador, rojo). Una línea de 2px arriba del escenario toma el color de la fase: el acento mientras corre. Se retiró el destello amarillo que latía sin parar al terminar.
- **Resultado** (`.tkc-stage-result`): ganador en verde o "sin ganador" en rojo, con el motivo.
- **Ajustes**: título "Ajustes" (`SettingsTitle`), cada campo en `.tkc-field` con su `.tkc-field-label` en minúsculas normales. Los que tienen significado de estado llevan `data-tone`: Insta-Win y desempate en ámbar (`warning`), snipe y reingreso en rojo (`danger`), premio en verde (`premio`). Los interruptores (Offstream, Fast Mode, Locked Mode, Modo Chat/Gift, posición ganadora) son `.tkc-option` con `aria-pressed`.
- **Controles**: Iniciar / Pausar / Reiniciar / Detener en mayúsculas (la voz de acción), `theme-btn-lg`; los avisos de por qué no se puede iniciar son `theme-notice-warning`.
- **Color Says** no usa escenario: su zona de dados (`.theme-die-frame`) es lo que algunos streamers recortan de la ventana en OBS. Arriba de los dados solo va la leyenda de colores; los paneles de Win Bonus, Modo Seguro y Modo invitado flotan a la derecha en escritorio, debajo del encabezado del área.

### Franja de Premio (componente propio)
Franja horizontal fija (imagen 50×50 + título) que comparten los tres juegos de regalos para mostrar el premio configurado. Usa siempre esmeralda fijo (`emerald-900/25` fondo, `emerald-500/40` borde), independiente del acento del tema — es la única superficie de "contenido de juego" que no sigue al acento, porque comunica un estado de negocio (premio), no navegación de marca.

### Overlay de OBS (`.theme-die-frame`)
La tarjeta de cada juego en el overlay (lo que la audiencia ve, recortado como fuente de captura en OBS) usa `.theme-die-frame` — la misma variante de `.theme-surface` sin padding forzado, porque acá el padding lo define el layout del juego. Usa el aspecto pastel de los overlays (`data-theme-style="default"`) con el acento del panel, sincronizado por socket en tiempo real (ver Overview). Dentro de la tarjeta, las etiquetas y bordes que representan la marca del streamer ("STEAL SPOT WITH:", el aro del avatar activo, las cajas de metadata) siguen `var(--accent)`/`var(--surface-bg-alt)`; los colores de estado del juego (amarillo insta-win/ganador, rojo snipe/peligro, gris pausa) se mantienen fijos, igual que en el panel — la regla de "Estado" de la sección Colors aplica también acá.

## Motion

El movimiento cuenta qué cambió y dónde quedó: al entrar al sitio, al cambiar de módulo o de pestaña, al validar algo. No decora ni compite con el contenido; en medio de un LIVE el streamer tiene que poder leer la cabina sin esperar a que nada termine de moverse.

### Tokens (`index.css`, `:root`)
- **`--motion-fast` 160ms**: cambios chicos dentro de un control (aparece o desaparece una etiqueta, un ícono).
- **`--motion-base` 280ms**: el indicador de navegación, la entrada de una vista, un mensaje bajo un campo.
- **`--motion-slow` 420ms**: cambios de forma (el botón que se encoge) y la entrada de la app o de una tarjeta.
- **`--ease-out-soft`** `cubic-bezier(0.22, 1, 0.36, 1)`: todo lo que entra o se desplaza. Arranca rápido y se asienta suave.
- **`--ease-in-out-soft`** `cubic-bezier(0.65, 0, 0.35, 1)`: cambios de forma que van y vuelven (el botón que se transforma).
- Los cambios de tema siguen con su `0.35s ease` de siempre (ver Components).

### Patrones
- **Entrada de vista** (`.tkc-view-enter`, `.tkc-app-enter`, `.tkc-rise`): fundido con 8px de subida. La app entera al cargar, cada sección al elegirla en la barra lateral, el panel de cada pestaña de Eventos (la barra de pestañas no se mueve: lo que se mueve es su indicador), y las tarjetas sueltas como el login (`.tkc-rise-2`/`-3` escalonan 70ms). Usa `animation-fill-mode: backwards`: el `transform` solo existe mientras corre, así que no cambia dónde se posicionan los modales `fixed` de adentro.
- **Contenido que sube** (`ViewEnter` + `useStagger`, `.tkc-reveal`): dentro de una vista, cada tarjeta (`.theme-surface`) sube 16px y aparece con `--motion-slow`, una tras otra cada 55ms (con tope de 8 turnos, para que nada espere de más). Una tarjeta que se monta después —porque terminó de cargar su dato— sube enseguida, sin hacer fila. Lo que reemplaza a un marcador de carga va en `<div className="tkc-reveal contents">`: sus hijos suben en orden sin cambiar el layout.
- **Marcador de carga** (`SkeletonRows`, `SkeletonKpis` en `PanelHelp.jsx`, `.tkc-skeleton`): mientras llega un dato del servidor se muestran bloques del color de los campos (`--surface-bg-alt`, radio del tema) con la forma aproximada de lo que viene, latiendo despacio; aparecen con 120ms de retraso para no parpadear en una respuesta rápida. Nunca un texto suelto "Cargando…". Al abrir el sitio, `index.html` trae su propia pantalla de carga (logo + aro, sin JavaScript) que React reemplaza al montar; el servidor la quita del HTML de los overlays de OBS.
- **Indicador deslizante** (`NavIndicator`): el fondo del módulo activo viaja con `--motion-base` en posición y tamaño. Al aparecer por primera vez o al cambiar el tamaño de la ventana se coloca directo, sin viajar.
- **Botón que se transforma** (`MorphButton`, `.tkc-morph`): para toda acción que valida datos contra el servidor (entrar con la clave, verificar la tarjeta de la prueba gratis, guardar la app de Spotify, crear o editar una licencia, guardar un precio, guardar una alerta). `idle` es el botón normal a todo el ancho de su contenedor; `loading` se encoge a un círculo del alto del botón con un arco girando; `success` cierra el arco y dibuja una palomita, y se sostiene `MORPH_SUCCESS_HOLD_MS` (650ms) antes de seguir; `error` vuelve a su forma con un vaivén de 5px y el mensaje aparece aparte (`.tkc-msg-enter`). La espera mínima (`MORPH_MIN_LOADING_MS`, 450ms) vale para el éxito y para el error: si el servidor contesta al instante, el cambio de forma no se alcanzaría a ver. Mientras valida el botón no se deshabilita (se vería apagado): el componente que lo usa ignora los clics repetidos.
- **Respuesta a cada acción**: los botones se hunden a 0.97 al presionarlos; una ventana emergente (`.tkc-backdrop`) aparece con un fundido y su tarjeta sube; una sección que se despliega (`<details>`) abre con movimiento; un texto que cambia por una acción ("Copiado", "Guardado", la etiqueta de estado de una licencia) aparece con un latido (`.tkc-pop`, con `key` para que se repita); una fila que se borra se desvanece antes de salir de la lista (`.tkc-leaving`); lo que acaba de cambiar destella con un aro del acento (`.tkc-flash`); un aviso flotante se desvanece antes de irse. Después de una acción, una lista se actualiza en su lugar: el marcador de carga es solo para la primera carga, nunca para un refresco.
- **Punto de estado** (`.tkc-status-dot`): la versión chica del mismo lenguaje para estados que no son un botón (la conexión con TikTok, un panel que se está descargando). Aro sin relleno en reposo, arco girando mientras busca o conecta, punto lleno con un halo que se expande al confirmar. Toma el color de su texto (`currentColor`), así que respeta los colores de estado.
- Los tiempos que también necesita el código (no solo el CSS) viven en `src/motion.js`, junto con `wait()`, que no espera nada si el sistema pide menos movimiento.

### Named Rules
**La Regla del Movimiento con Motivo.** Solo se anima lo que acaba de cambiar por algo que hizo el streamer o por algo que pasó en el servidor: una vista nueva, un módulo elegido, una validación. Nada se mueve en reposo (salvo el arco de "cargando" y el halo de "conectado", que son estado, no adorno).

**La Regla del Mismo Color.** El movimiento no trae colores nuevos: el indicador lleva las clases del botón activo, el botón que se transforma conserva su relleno, y el punto de estado usa el color de su texto. Nada de gradientes, brillos ni neones agregados para "acompañar" una animación.

**La Regla del Menos Movimiento.** Todo lo de esta sección vive dentro de `.themed-panel`, donde `prefers-reduced-motion: reduce` deja las animaciones y transiciones en 0.01ms; `wait()` tampoco espera. Los overlays de OBS quedan fuera a propósito: sus animaciones son parte de lo que ve la audiencia.

## Iconografía

**La interfaz es texto; los íconos son solo para navegar.** Únicamente la barra lateral, los accesos directos del Dashboard a cada sección y el botón flotante de Eventos llevan ícono, y siempre es un ícono de línea de `NavIcon.jsx`: un solo trazo de 1.8px, esquinas redondeadas, dibujado en `currentColor` (sigue al acento, al modo oscuro y al estado activo como cualquier texto). Nada de emojis en títulos, etiquetas, botones, pestañas, avisos ni estados vacíos: el color de estado y el texto ya dicen lo que hace falta.

- **Se quedan** los glifos que son un control: ✕ (cerrar), ✓ (seleccionado o hecho), ✎ (editar, en botones compactos con `aria-label`), ▶ (escuchar una voz). Las flechas → dentro de un texto (precios, rutas de menú) también.
- **Contenido del juego, no decoración:** los colores de ColorDice (`colorsData.jsx`) y todo lo que se ve en los overlays de OBS siguen como están: es lo que ve la audiencia.
- **Imagen que falta** (un regalo o sticker sin ícono): un cuadro vacío con el fondo de los campos (`theme-input`), no un emoji de reemplazo.
- **Posiciones de un ranking:** el número, no una medalla. **Monedas:** la palabra "monedas", no la moneda dibujada.
- Un ícono nuevo de navegación se agrega a `NavIcon.jsx` con la misma grilla de 24×24 y el mismo trazo.

## Overlays: personalización y fondo transparente

Cada overlay se personaliza por separado. En la página de Overlays cada tarjeta muestra una **miniatura en vivo** (el mismo componente que corre en OBS, con datos de prueba) que abre `OverlayCustomizePanel`: vista previa a la izquierda (fija arriba en el celular) y, a la derecha, primero un **estilo listo** y después los ajustes a mano en pestañas.
- **Estilos listos** (`OVERLAY_STYLE_PRESETS`): una elección deja combinados fondo, bordes, colores de texto y fuente. No son un campo nuevo: escriben los mismos campos de siempre, así que el backend los valida igual y no hay nada que migrar; qué estilo está puesto se deduce comparando (`matchOverlayPreset`), y cualquier ajuste posterior lo deja como "Personalizado" sin perder nada. Un estilo, "Restablecer" y "Usar este aspecto en todos" se pueden deshacer (este último pide confirmación). Ninguno toca el volumen de las Alertas ni la animación del Chat (`VISUAL_KEYS`).
  - **Clásico**: el aspecto de fábrica (fondo del tema, Sora).
  - **Sobre tu escena**: transparente, sin bordes, texto blanco con sombra, Poppins.
  - **Neón**: degradado `#14082E` → `#3B0A63`, nombres `#F472D0`, títulos `#5EEAF5`, Oswald.
  - **Arcade**: degradado `#071A4A` → `#1D3FB0`, nombres `#FDE047` grandes, títulos arcoíris grandes, Bebas Neue.
  - **Fiesta**: fondo arcoíris, sin bordes, texto `#1A1033`, Nunito.
- **Pestaña Fondo**: del tema, transparente, degradado o arcoíris; bordes y separadores con un interruptor.
- **Pestaña Texto**: color (original, del tema, un color, degradado, arcoíris) y tamaño de dos tipos de texto, **con el nombre de lo que pintan en ese overlay** (en Versus el primero es el marcador, en la tira de regalos el apodo, en las Alertas el texto de la alerta). Colores, Extensible y Objetivo no tienen nombres de usuario: solo muestran "Título y textos". El tamaño de los textos fijos se aplica con `zoom` (ocupa espacio real). Los avisos de estado (snipe, pausado, eliminado) solo cambian de tamaño: su color comunica algo.
- **Pestaña Fuente**: Sora (la de siempre), Poppins, Nunito, Oswald, Bebas Neue o la del sistema. Las de Google se descargan solo si se eligen.
- **Pestaña Mensajes** (solo Chat): animación de entrada de cada mensaje.
- **Vista previa sobre un fondo de referencia**: oscuro `#0A0614`, claro `#F1EEF6` o cuadrícula `#C9C3D6`/`#F4F2F8` (`PREVIEW_BACKDROPS`, recordado por navegador; la muestra del estilo transparente usa una cuadrícula oscura `#3B3450`/`#2A2438`), para juzgar el modo transparente sobre una escena clara u oscura.
- **Guardado**: automático; el pie dice "Guardando…", "Guardado" o que falta conexión (se envía al reconectar).

**La Regla de la Tinta Automática.** Con un degradado oscuro, el elemento que lleva ese fondo (el marco, o cada fila en los rankings, el chat y la cola) pasa solo a tinta clara (`backgroundNeedsLightInk` elige la tinta con mejor contraste contra el peor de los dos colores; `resolveBackgroundStyle` pone las variables). Antes, los temas pastel forzaban tinta oscura y el nombre "Original" era negro fijo: un degradado oscuro dejaba el overlay ilegible. Un título que queda fuera de las filas, directo sobre la escena, no cambia.

**La Regla del Letrero.** Un texto con "Un color" que va directo sobre la escena de OBS (el título y los avisos de los rankings, la cola de Spotify y el chat, marcados con `tkc-over-scene`) lleva un contorno fino del tono contrario al texto y, si el texto es claro, un halo de su mismo color: como un letrero de neón, se lee sobre una escena clara u oscura sin ponerle una caja. No se aplica con Original/Del tema, ni al degradado o arcoíris (van recortados y una sombra se vería a través), ni con fondo transparente (que ya trae su sombra).

**El texto arcoíris lleva un trazo fino** (`-webkit-text-stroke`, violeta casi negro semitransparente) para leerse sobre el fondo pastel del tema; se apaga dentro de un degradado oscuro. Nunca `hue-rotate` para animarlo: ese filtro conserva la luminancia y oscurece los tonos (lo comprueba `overlayPresets.test.js`).

**La Regla del Transparente Completo.** Con fondo "Transparente", el elemento raíz del overlay lleva `data-ovl-bg="transparent"` (`overlayRootProps`) y ningún fondo de adentro queda pintado: cajas, píldoras de monedas, avisos, dados vacíos o girando, carátulas y avatares de relleno. Todo fondo interno nuevo de un overlay lleva la clase `tkc-ovl-fill` (o usa `resolveBackgroundStyle`) para obedecer esta regla. Solo quedan pintados los indicadores que son contenido (la barra de progreso, el punto de "en vivo", el color de un dado ya asentado).

**El chat se lee desde OBS vertical.** En una fuente de navegador vertical (más alta que ancha) el overlay de chat la ocupa completa; antes medía siempre 960 × 480 y OBS lo achicaba en un lienzo vertical. En una horizontal sigue midiendo 960 × 480 arriba a la izquierda, exactamente como antes, para no cambiar lo que ya tiene puesto cada quien (`chatFrameSize`). La vista previa de Eventos › Chat tiene las dos formas (960 × 480 y 540 × 960). Letra de 24 px por defecto (12 a 48). Cada mensaje es una sola línea de lectura: `[foto] [insignias] [nombre]: [mensaje]`. La foto, las insignias y el nombre nunca se parten: si caben en menos del 42% del ancho, el mensaje va al lado y sus líneas siguientes se alinean con su comienzo; si no, la fila pasa a texto corrido y el mensaje sigue justo después del nombre, a todo el ancho. Nunca se corta ni se trunca nada. Las insignias son íconos del tamaño de la letra, con su color fijo y su nombre para lectores de pantalla, en este orden: moderador, miembro (corazón con su nivel, el único con número), top gifter (corona dorada, plateada o bronce), Superfan y las demás imágenes de TikTok que no son ninguno de esos (`chatBadgeIcons`; el servidor manda aparte esas otras en `badges.others`, así un rol no aparece dos veces).

**Destacados y eventos del chat.**
- **Mensaje premium (opción "D", pedido del dueño):** el borde de 3 px que giraba apenas se notaba en el stream (una línea fina en movimiento es lo primero que se pierde al comprimir el video) y, con varios en pantalla, hacía ruido. Ahora la fila lleva cuatro cosas, todas en tonos rojizos y púrpuras, nunca blanco:
  - un tinte translúcido y claro de su distintivo (morado al 30 %, frambuesa al 26 %, de uno a otro en "los dos"; `.tkc-chat-premium-tint`, encima del fondo de la burbuja y debajo del texto), que se mezcla con el fondo de Personalizar y con la escena. El dueño probó una base oscura opaca para que fuera idéntico en todo fondo y prefirió esto: se veía demasiado oscura;
  - el borde de la maqueta D, quieto: su color al 60 %, con el grosor en la misma proporción que en la maqueta (1 px con letra de 14 = 0,07em; ~1,7 px a 24). Con 1 px fijo se perdía con la letra grande del overlay (el borde se conserva: decisión del dueño);
  - el nombre en un tono claro de ese color (`.tkc-chat-name-premium`), por encima del color de nombres de Personalizar;
  - un destello que cruza la fila **una sola vez, al llegar** el mensaje (`.tkc-chat-premium-sweep`, 1,4 s); después la fila queda quieta.
  Cada condición basta sola para llevarlo:
  - **Nivel alto del club de fans (20 o más; el 19 no):** morado (`.tkc-chat-glow-elite`). Su insignia de miembro pasa a un corazón con degradado y brillo.
  - **Superfan:** rosa frambuesa (`.tkc-chat-glow-superfan`), aunque no tenga nivel de club. Su insignia propia (escudo violeta, rosa y dorado con un destello) lleva un brillo que cruza solo su forma (`.tkc-svg-shine`).
  - **Subidas de nivel del club:** siempre, en morado.
  - **Suscripciones** (nuevas, renovaciones y "se hizo Superfan"): siempre, en frambuesa.
- **Las insignias no cambian con el destacado** (decisión del dueño): conservan su dibujo y su franja de brillo (`#b24dff` en la de nivel alto, `#ff3d8b` en la de Superfan), que cruza en 1,2 s cada 3 s.
- **Moderador:** insignia propia de la misma familia: un hexágono con degradado verde y turquesa, el mismo contorno blanco fino y una llave inglesa blanca. Sin brillo, que queda para Superfan y los niveles altos.
- **Donador:** su nivel no se dibuja como insignia (decisión del dueño del producto) ni se reemplaza por otra. El dato se sigue recibiendo.
- **Las dos cosas** (nivel 20 o más y Superfan, en mensajes y en estos eventos): un tinte que va del morado al frambuesa (`.tkc-chat-glow-both`), y las dos insignias se ven.
- **Rendimiento:** dos capas absolutas por fila destacada (tinte y destello); después del destello no se repinta nada.
- **Siempre en movimiento:** el destello al llegar y los brillos de las insignias no se apagan con "menos movimiento" (en Windows sale de "Efectos de animación"): como el resto del overlay, son lo que ve la audiencia. La vista previa del panel también los reproduce, aunque la Regla del Menos Movimiento acorte las demás animaciones de `.themed-panel`.
- **Eventos con su color a la izquierda** (los que llevan el destacado premium lo cambian por él):
  - Suscripción (violeta): "se suscribió", "renovó su suscripción", los meses y la renovación automática, o "se hizo Superfan", solo con lo que manda TikTok.
  - Cofre (amarillo): quién lo colocó, sus monedas y para cuántas personas.
  - Subida de nivel del club de fans (rosa): solo el nivel al que llegó, "subió al nivel 6 del club de fans". El anterior nunca se muestra; internamente sirve para no repetir una subida. Desde el 20 dice "alcanzó el nivel 20 del club de fans". Todas llevan el destacado de nivel alto (combinado si es Superfan).
- **Regalos:** llevan su valor total con 🪙 ("×6 · 🪙 6"). Sin valor conocido no se muestra ninguno.

**Versus se adapta al ancho de la fuente.** Sus medidas son `cqw` (porcentaje del ancho disponible) con un piso y un techo (`clamp`), y su alto lo pone el contenido. Un overlay nuevo que deba verse bien en cualquier tamaño de fuente de OBS sigue el mismo patrón (`.tkc-vs` en `index.css`).

## Dashboard y Eventos: estado, configuración y cambios en vivo

El Dashboard y la barra de Eventos leen **el mismo estado de cada evento** (`app/eventStatus.js`), calculado solo con datos reales: el estado en vivo que manda el servidor, los ajustes guardados de la cuenta y, en Versus, los regalos asignados. Cinco tonos, del más urgente al menos: **En curso**, **En pausa**, **Terminado** (el overlay muestra el resultado), **Falta configurar** (con qué falta: el regalo objetivo, el regalo para unirse o para entrar, la meta, regalos en Versus) y **Listo para iniciar**. Se pinta con `EventStatusBadge` (Dashboard) y `EventStatusDot` (barra de Eventos; sin punto cuando está listo, para no llenar la barra de ruido). El color nunca va solo: siempre lo acompaña el texto, visible o para lectores de pantalla.

- **Dashboard, de arriba abajo:** saludo y estado del LIVE → **"Ahora en tu directo"** (lo que está en curso, en pausa o con resultado, con un acceso directo a cada uno; si no hay nada, **"Seguir donde lo dejaste"** con el último evento abierto en este navegador) → primeros pasos → actividad en vivo → cuenta → eventos agrupados con su estado → herramientas. Lo urgente va antes que la guía.
- **Ajustes guardados en la cuenta** (`eventSettingsStore.js`, `eventSettingsContext.js`, columna `licenses.event_settings`, `lib/eventSettings.js`): lo que se configura en un evento sin iniciarlo sobrevive a cambiar de sección, recargar y entrar desde otro navegador. Misma regla que el tema y los overlays (nada se manda hasta recibir lo del servidor en cada conexión), pero **campo por campo** (`eventSettingsSync.js`): cada panel manda solo los campos que el streamer cambió y el servidor los mezcla con lo que ya tenía. Reglas:
  - Un cambio queda **pendiente** hasta que el servidor confirma que lo **guardó en la base** (no al recibirlo). Si la base falla, el panel lo avisa ("No se pudieron guardar estos cambios…"), lo conserva y lo reintenta solo. Las demás pestañas y las que se conectan después solo ven lo que ya quedó guardado.
  - Lo pendiente sobrevive a perder la conexión **y a recargar o cerrar la pestaña**: la copia del navegador guarda también lo último confirmado.
  - Dos pestañas que cambian **campos distintos** (aunque sean del mismo evento) no se pisan. Si cambian **el mismo campo**, gana el último en llegar al servidor y las dos lo avisan.
  - Si llega un cambio de otra pestaña para el panel que se está editando (el foco está en uno de sus campos), el panel **no** se vuelve a abrir en ese momento (antes perdía el cursor): se avisa y se actualiza al salir del panel. Mientras tanto se puede seguir escribiendo sin pisar lo que llegó.
  - El panel guarda cada ajuste con la misma forma que le da el servidor (`eventSettingsSchema.js`, copia de `lib/eventSettings.js` que una prueba mantiene igual) y compara por contenido, sin importar el orden de las claves.
  - La copia del navegador lleva el dueño (id de la licencia): otra cuenta en el mismo equipo no la ve. Las claves viejas de cada panel se suben una sola vez, solo a la primera cuenta que entra en ese navegador con esta versión, solo para los eventos que el servidor no tiene, y se dan por migradas cuando el servidor lo confirma.
  El estado de una partida (puntos, participantes, tiempo) **no** se guarda aquí: vive en el servidor y llega por su propio evento.
- **Cambios en vivo:** cada ajuste dice cuándo se aplica con `LiveTag` (solo con el evento en curso): **Al instante**, **Al actualizar** (con un botón), **Al reiniciar** o **Al iniciar uno nuevo**. Después de un cambio, `LiveAppliedNote` dice "Aplicando…", "Cambio aplicado en vivo" (cuando el estado del servidor ya lo refleja) o que no se pudo confirmar. Ver la tabla de abajo.
- **Acciones que borran progreso** (Detener, Reiniciar, Reiniciar progreso): `ConfirmButton` pide confirmar en el mismo botón (segundo clic, se cancela solo a los 4 segundos, con Escape o al salir con el teclado), y solo si hay algo que perder. Sin progreso actúan al primer clic. Iniciar y Reiniciar se bloquean tras un clic hasta que el servidor responde (`useActionLock`), así un doble clic no arranca dos veces.
- **Overlay de juegos de OBS:** abrir la pestaña de otro juego para revisarlo **no** cambia lo que ven los espectadores si hay un juego en curso; el overlay cambia solo al iniciar otro juego (desde cualquier pestaña o dispositivo).

| Evento | Al instante | Al reiniciar / iniciar uno nuevo, y por qué |
|---|---|---|
| Rey del Trono | Regalo objetivo, Insta-Win, tiempo base y de snipe (si esa fase corre y se cambió SU tiempo, el reloj salta al tiempo nuevo; cambiar otra cosa no toca el reloj) | — |
| Zubastinis | Tiempos (principal, snipe, desempate; mismo salto, solo si cambió ese tiempo) y mínimo para ganar | — |
| Eliminación | Regalos, tiempos, eliminados por ronda, Fast Mode; Locked Mode se puede prender | Apagar Locked Mode: al detener o reiniciar (si no, se podría dejar entrar gente a último momento) |
| Ruleta | Todo, mientras se están uniendo participantes (la cuenta para entrar solo salta si se cambia la ventana) | Con la ruleta girando o en el resultado, todo al reiniciar: el sorteo ya está armado y cambiarlo a mitad lo haría injusto |
| Extensible | Segundos por follow y por moneda, Modo Inverso, y el ajuste manual de tiempo | Tiempo base: al reiniciar (es con cuánto arranca; para mover el tiempo que corre están los botones de ajuste) |
| Objetivo | Meta y título **al actualizar**, con el botón Actualizar meta (aviso si hay cambios sin aplicar), sin perder el progreso | Tipo (monedas o seguidores): iniciar uno nuevo, porque el progreso está en una sola unidad. La meta no se aplica en cada tecla: escribir "500" pasa por "5" y una meta cumplida haría sonar el aviso en el directo |

## Do's and Don'ts

### Do:
- **Do** dar tamaño a un botón con `theme-btn-sm|md|lg`, a un aviso con `theme-notice` y a un enlace de texto con `theme-link`, en vez de escribir relleno, tamaño, radio o colores de estado a mano.
- **Do** leer siempre los tokens (`var(--surface-bg)`, `var(--ink-2)`, `var(--accent)`, `var(--surface-radius)`): un componente nuevo debe verse bien con cualquier acento, en oscuro y en claro, sin tocarlo.
- **Do** reservar el acento para lo que depende de él (acción principal, selección, navegación activa, foco) y los colores de estado para semántica de juego o licencia.
- **Do** probar un componente nuevo con un acento personalizado extremo (amarillo puro, gris, casi negro) en las dos apariencias.
- **Do** sincronizar el overlay de OBS con el acento del panel: recibe `theme` por socket (`theme_updated`) y se pinta con `.themed-app` + `data-theme-style="default"` + `data-accent`. Nunca decide su propio tema ni lo lee de `localStorage`.
- **Do** usar `MorphButton` para acciones que validan contra el servidor, `tkc-view-enter` para vistas que entran y `tkc-nav-item` + `aria-current` (con `NavIndicator`) para barras de navegación. Ver Motion.

### Don't:
- **Don't** hacer que un fondo, superficie, borde o sombra del panel dependa del acento (La Regla de la Cabina Quieta).
- **Don't** volver a agregar materiales, skins o un selector de "estilos": un diseño, un acento.
- **Don't** usar degradados, glass o glows decorativos en el panel; el acento es un color sólido.
- **Don't** usar el acento para estados de negocio (premio, error, aviso).
- **Don't** agregar otra familia tipográfica sin decisión explícita.
- **Don't** poner emojis en el copy del panel (títulos, etiquetas, botones, avisos): ver Iconografía.
- **Don't** escribir duraciones o curvas sueltas en una animación nueva: salen de los tokens `--motion-*` / `--ease-*-soft`.
- **Don't** usar bounce/elastic easing en transiciones nuevas.
