---
name: TikTok Concurso
description: Cabina de control nocturna para correr minijuegos de regalos de TikTok LIVE, con overlay para OBS.
colors:
  accent: "#7C3AED"
  accent-secondary: "#6366F1"
  accent-blue: "#3B82F6"
  accent-blue-secondary: "#06B6D4"
  accent-pink: "#EC4899"
  accent-pink-secondary: "#FB7185"
  accent-green: "#10B981"
  accent-green-secondary: "#34D399"
  page-void: "#100030"
  surface-deep: "#190A36"
  surface-raised: "#251D3E"
  surface-line: "#2D1B4E"
  page-void-kawaii: "#A69AD8"
  surface-kawaii-base: "#C0B2F9"
  surface-kawaii-base-alt: "#B2A8E0"
  page-void-minimal: "#0B0023"
  surface-raised-minimal: "#130A29"
  page-void-cute: "#ACA1DC"
  surface-cute-base: "#C6BAFA"
  surface-cute-base-alt: "#B8B0E1"
  accent-soft: "#A78BFA"
  accent-blue-soft: "#93C5FD"
  accent-pink-soft: "#F9A8D4"
  accent-green-soft: "#6EE7B7"
  ink-kawaii: "#2E2136"
  ink-cute: "#2A1B2E"
  danger: "#EF4444"
  warning: "#F59E0B"
  success: "#10B981"
  neutral-muted: "#6B7280"
  ink: "#FFFFFF"
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
rounded:
  sm: "0.75rem"
  lg: "1.5rem"
  pill: "999px"
  flat: "0px"
spacing:
  sm: "0.5rem"
  md: "1rem"
  lg: "1.5rem"
  xl: "2rem"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "12px 32px"
  button-primary-hover:
    backgroundColor: "{colors.accent}"
  button-secondary:
    backgroundColor: "{colors.surface-deep}"
    textColor: "{colors.accent}"
    rounded: "{rounded.sm}"
    padding: "12px 32px"
  input:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "10px 14px"
  chip:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent}"
    rounded: "{rounded.pill}"
    padding: "4px 12px"
---

# Design System: TikTok Concurso

## Overview

**Creative North Star: "La Cabina de Control"**

TikTok Concurso es la cabina de control nocturna del streamer: una interfaz densa en estado, pensada para leerse de un vistazo en medio de un LIVE, donde un único acento de color hace de faro sobre un fondo casi negro. El sistema es deliberadamente táctil y de arcade — botones con peso, glows de acento, tipografía en mayúsculas y trazo grueso — no un dashboard corporativo silencioso. El fondo, casi negro (#05030A), nunca compite con el acento: existe para que el morado (o el azul, rosa o verde elegido) sea lo único que brille.

Lo más distintivo del sistema no es una paleta fija sino su **pluralismo controlado**: cuatro "materiales" (Default, Kawaii, Minimal, Cute) combinables con cuatro acentos de color (morado, azul, rosa, verde) — 16 combinaciones reales, todas construidas sobre el mismo esqueleto de tokens CSS (`--page-bg`, `--surface-bg`, `--surface-radius`, `--surface-shadow`, `--accent`). Cambiar de material cambia radicalmente el lenguaje de forma y profundidad, y en Kawaii/Cute también el lenguaje de luz: Default y Minimal se quedan en la cabina nocturna casi negra; Kawaii y Cute son los dos materiales "tiernos" del sistema y rompen deliberadamente con ese fondo oscuro — van a un **pastel claro de verdad** (`L` 0.72–0.82 en OKLCH), porque una skin que se elige para "sentirse tierna" no puede quedar apagada por un fondo casi negro. Son distintos entre sí en forma, no en luminosidad: Cute (reemplazo de Claymorfismo) es dulce y contenido — borde punteado tipo washi-tape, radios grandes (`1.75rem`), textura de puntitos tipo sprinkles; Kawaii (reemplazo de Glassmorfismo) es dulce y máximo — radios ultra redondeados (`2rem`/píldora completa en cada control), relleno pastel lleno en botones/chips con brillo diagonal interior tipo gomita inflada, sombra profunda y difuminada del color del acento. Al pasar a fondo claro, todo el texto blanco/gris del resto del sistema se sobreescribe a una tinta oscura propia de cada material (`--ink-kawaii`, `--ink-cute`) para mantener el contraste — ver Colors › Tinta de Material.

El overlay de OBS (lo que ve la audiencia del stream) **replica el mismo skin** (material + acento) que el streamer eligió en el panel — sincronizado en tiempo real por Socket.io, no por `localStorage` (el overlay corre en la ventana de OBS, un navegador aparte que nunca comparte sesión con el panel). El streamer elige el skin justamente para que represente su marca frente a su audiencia; que solo él lo vea sería el fallo del sistema, no una protección.

**Key Characteristics:**
- Fondo casi negro + un único acento vivo como faro de atención.
- Cuatro materiales seleccionables (Default / Kawaii / Minimal / Cute), un mismo esqueleto de tokens.
- Mayúsculas, tracking amplio y peso `black` para todo lo que es etiqueta o acción.
- Táctil y de arcade, no SaaS corporativo: glows, gradientes, transiciones de 0.35s en cada cambio de tema.
- El overlay de OBS sincroniza el mismo skin que el panel, en tiempo real, vía socket — nunca queda desfasado del tema elegido.

## Colors

Paleta oscura de un solo acento vivo sobre neutros casi negros; los colores de estado (rojo, ámbar, esmeralda) son fijos y no cambian con el acento elegido.

### Primary
- **Neón Violeta** (`#7C3AED`): acento por defecto (`--accent`). Botones primarios, texto de énfasis, glow de foco, indicador de módulo activo. Es el faro del sistema — en el material Minimal es literalmente lo único con color en toda la pantalla.
- **Índigo Profundo** (`#6366F1`): pareja de degradé del acento (`--accent-2`). Nunca aparece solo; siempre como el segundo extremo del gradiente en `button-primary` y del relleno pastel de botones/chips en el material Kawaii.

### Secondary — acentos alternos seleccionables
El streamer elige uno de estos cuatro como su `--accent` activo; los otros tres quedan disponibles en el selector de Tema. Todos siguen la misma regla: viven en botones, texto de énfasis y glows, nunca en superficies neutras.
- **Azul Transmisión** (`#3B82F6` / secundario `#06B6D4`)
- **Rosa Neón** (`#EC4899` / secundario `#FB7185`)
- **Verde Esmeralda Eléctrico** (`#10B981` / secundario `#34D399`)

### Neutral
`--page-bg`, `--surface-bg` y `--surface-bg-alt` no tienen hex propio: se construyen en el momento con **sintaxis de color relativo**, `oklch(from var(--accent) L C h)` — se toma SOLO el matiz (`h`) del acento activo y se fija una luminosidad/croma (`L`/`C`) propios de cada token y cada material. Es deliberadamente distinto de `color-mix()` hacia una base: mezclar diluye luminosidad y croma en proporción al % mezclado, y el croma nativo en OKLCH no es igual entre los 4 acentos (rosa y verde parten "más flojos" que morado/azul), así que un mismo % de mezcla los deja menos saturados — ese fue el bug real detrás del "se ve grisáceo en rosa y verde". Fijando `L`/`C` a mano, los 4 acentos quedan con la misma intensidad, no solo el mismo matiz. Los hex de abajo son el resultado con el acento morado (por defecto) — cambian de matiz con cualquier otro acento, pero no de intensidad.

Default y Minimal se quedan en la cabina nocturna casi negra; Kawaii y Cute cruzan a un **pastel claro de verdad** — misma sintaxis de color relativo, pero con `L` alto en vez de bajo. Son dos familias de luminosidad distintas dentro del mismo esqueleto de tokens:

**Default / Minimal (fondo oscuro):**
- **Vacío Casi-Negro** (`oklch(from var(--accent) 0.15 0.1 h)` → `#100030` en morado): fondo de página (`--page-bg`) en el material Default.
- **Panel Profundo** (`oklch(from var(--accent) 0.2 0.08 h)` → `#190A36`): fondo de superficie (`--surface-bg`) — tarjetas, sidebar. Más croma que el `--page-bg` pese a ser más claro: la tarjeta debe sentirse "encima" y con más presencia que el vacío detrás.
- **Panel Elevado** (`oklch(from var(--accent) 0.26 0.06 h)` → `#251D3E`): fondo de superficie secundaria (`--surface-bg-alt`) — inputs, filas alternas. Menos croma que las otras dos: es donde se escribe/lee texto, así que se aquieta un poco.
- Minimal usa `0.13/0.08` (page) · `transparent` (surface, es su identidad) · `0.18/0.06` (surface-alt) — el material más contenido, a tono con su carácter callado.
- **Línea Violeta Apagada** (`#2D1B4E`): borde de superficie por defecto (`--surface-border-color`) — este sí es un hex fijo, no sigue el acento; el contraste del borde importa más que su tinte.
- **Blanco Puro** (`#FFFFFF`): texto primario sobre fondo oscuro, en estos dos materiales.

**Kawaii / Cute (fondo pastel claro):**
- Kawaii usa `0.74/0.085` (page) · `0.82/0.09` (surface) · `0.78/0.07` (surface-alt) → con acento morado: `#A69AD8` / `#C0B2F9` / `#B2A8E0`. Cute usa `0.74/0.085` · `0.82/0.09` · `0.78/0.07` → los mismos valores de luminosidad (ambos deben leerse igual de "pastel"); la diferencia entre los dos materiales vive en forma y textura (Shapes/Components), no en color.
- **Tinta de Material** (`--ink-kawaii` `#2E2136`, `--ink-cute` `#2A1B2E` — violeta casi negro): en Kawaii y Cute, TODO el texto blanco/gris del resto del sistema se sobreescribe a esta tinta oscura (selector `.themed-app[data-theme-style="kawaii"] .text-white`, etc., con `!important` porque compite con utilidades de Tailwind en una capa distinta) — a diferencia de un fondo oscuro, un fondo pastel claro no tiene contraste suficiente para texto blanco. Es la razón por la que estos dos materiales son la única excepción de color de texto del sistema.
- **Acento Suave** (`accent-soft`, uno por acento — `#A78BFA` morado, `#93C5FD` azul, `#F9A8D4` rosa, `#6EE7B7` verde): versión desaturada del acento activo, usada en texto de énfasis (`theme-label`, `theme-accent-text`) sobre fondo oscuro (Default/Minimal) y bordes de botón en Minimal.
- **Acento Pastel** (`--accent-pastel`, solo en Kawaii — `oklch(from var(--accent) 0.6 0.15 h)`): un tono del acento más saturado que el fondo pastel del material, usado para rellenar botones/chips por completo y darles presencia sobre un fondo que ya es claro. Construido con la misma sintaxis de color relativo que el resto — no mezclado hacia blanco, para no perder croma nativo del acento.

### Estado (fijos, no siguen el acento elegido)
- **Rojo Alerta** (`#EF4444`): ventanas de snipe/peligro, licencias revocadas, errores. Siempre en pares badge (fondo `red-950/70` + borde `red-500/70` + texto claro).
- **Ámbar Aviso** (`#F59E0B`): avisos de vencimiento de licencia, estados "por vencer" o "verificando".
- **Esmeralda Premio** (`#10B981`): franja de premio compartida por los tres juegos y estado "activa"/"conectado en vivo" — casualmente comparte hex con el acento verde, pero es un token de estado independiente, no cambia si el streamer elige otro acento.
- **Gris Apagado** (`#6B7280`): estados offline, deshabilitado, texto secundario de baja prioridad.

### Named Rules
**La Regla del Faro Único.** El acento vivo es siempre el único color saturado en pantalla fuera de los badges de estado (rojo/ámbar/esmeralda). Ningún otro elemento decorativo compite por atención con él — el fondo teñido (ver regla siguiente) no rompe esto porque es el mismo acento, no un segundo color; solo cambia de intensidad.

**La Regla del Fondo Teñido.** Ningún fondo del sistema es un neutro real: `--page-bg`, `--surface-bg` y `--surface-bg-alt` toman siempre el matiz del acento activo. Un fondo que no cambia con el acento hace que elegir morado, azul, rosa o verde se sienta como cambiar un detalle chico en vez de cambiar la cabina entera — con 4 acentos posibles, el fondo tiene que cargar tanto peso de identidad como los botones.

**La Regla del Color Construido, No Mezclado.** `--page-bg`, `--surface-bg` y `--surface-bg-alt` se escriben `oklch(from var(--accent) L C h)` — nunca `color-mix()` hacia una base oscura. `color-mix()` diluye luminosidad Y croma en proporción al % mezclado, y el croma nativo de cada acento en OKLCH no es igual (rosa y verde parten con menos croma que morado/azul), así que un mismo % de mezcla deja algunos acentos más "lavados" que otros — es el bug real detrás de "se ve grisáceo en rosa y verde, pero bien en morado/azul": no era casualidad, morado y azul tienen más croma nativo y disimulaban el problema. Tomar solo el matiz (`h`) del acento y fijar `L`/`C` a mano garantiza la misma intensidad para los 4. `color-mix()` sigue siendo la herramienta correcta para todo lo demás (sombras y bordes hacia `transparent`, `--accent-pastel` hacia `white`) — ahí no hay croma nativo que perder, así que mezclar no diluye nada. La regla es específica a fondos/superficies, no un rechazo general de `color-mix()`.

## Typography

**Display/Body Font:** Tailwind `font-sans` (system UI stack — sin fuente custom cargada).

**Character:** Una sola familia tipográfica hace todo el trabajo; la jerarquía se construye enteramente con peso, tamaño y `letter-spacing`, no con variedad de fuentes. El registro dominante es la "etiqueta": mayúsculas, `tracking` amplio, peso `black` — el mismo tratamiento para el nombre de un módulo, un badge de estado o un botón.

### Hierarchy
- **Headline** (peso 900/`font-black`, 24px, `tracking-widest`): títulos de pantalla completa poco frecuentes — p. ej. "OFFLINE" en la tarjeta del overlay sin conexión.
- **Title** (peso 900/`font-black`, 10px, `tracking-[0.3em]`, mayúsculas): la voz dominante del sistema — encabezados de módulo ("KING", "🔑 Licencias", "🎨 Tema"). Actúa como un eyebrow gigante en vez de un título tradicional.
- **Body** (peso 700, 14px): nombres de usuario, texto de mensajes de error, contenido variable.
- **Label** (peso 700, 11px, `tracking-widest`, mayúsculas): etiquetas de formulario, badges de estado, metadata secundaria (fechas, contadores de uso).

### Named Rules
**La Regla de la Mayúscula Obligatoria.** Todo lo que es etiqueta, botón o estado va en mayúsculas con tracking amplio. El texto en minúsculas queda reservado casi exclusivamente para contenido variable (usernames, mensajes).

## Layout

Layout de aplicación de una sola pantalla (no hay scroll de página, cada panel maneja su propio `overflow-y-auto`). Estructura fija: sidebar de navegación de íconos a la izquierda (72px), barra de conexión TikTok flotante fija en la esquina superior derecha, y un panel principal central que ocupa el resto del viewport. No hay grilla responsive tradicional — la app está diseñada para una ventana de escritorio (el streamer trabajando junto a OBS), no para mobile.

El overlay de OBS es un layout completamente aparte, sin sidebar ni chrome: solo la tarjeta o card del juego activo, pensada para recortarse directamente como fuente de captura.

## Elevation & Depth

Sistema híbrido: el material Default usa sombra real (glow de acento); Kawaii usa la sombra más profunda y difuminada del sistema, siempre teñida del acento activo, más un brillo diagonal interior que simula relieve inflado; Cute usa un glow difuso más suave y disperso, sin relieve duro; Minimal es deliberadamente plano — cero sombra, la profundidad la da solo una línea de borde. La elevación no es un valor fijo del sistema: es una de las cuatro decisiones de material que el streamer elige.

### Shadow Vocabulary (por material)
- **Default — Glow ambiental** (`0 0 50px color-mix(in oklch, var(--accent) 22%, transparent)`): sombra difusa del acento activo bajo las superficies principales, no ligada a interacción. Antes era un violeta fijo (`rgba(107,33,168,.15)`) sin importar el acento elegido — se corrigió para que siga la misma Regla del Fondo Teñido que el resto del sistema.
- **Kawaii — Sombra gomita** (`0 22px 45px -12px color-mix(in oklch, var(--accent) 40%, transparent), inset 0 2px 0 rgba(255,255,255,.16)`): la más profunda y difuminada del sistema — sombra exterior grande + brillo superior marcado, para el efecto "inflado" que pidió el streamer. En superficies y dock se suma un `background-image: linear-gradient(155deg, rgba(255,255,255,.16), transparent 50%)` — el mismo mecanismo de brillo diagonal que usaba Claymorfismo, reciclado con paleta pastel.
- **Cute — Glow de algodón de azúcar** (`0 10px 30px color-mix(in oklch, var(--accent) 28%, transparent), inset 0 1px 0 rgba(255,255,255,.1)`): sombra difusa teñida del acento activo, más un brillo superior sutil tipo caramelo — nunca relieve duro ni sombra doble.
- **Minimal — Ninguna**: cero `box-shadow`. La única señal de profundidad es `border-left: 2px solid` en el acento activo.

### Named Rules
**La Regla del Glow Único.** Cuando hay sombra de color, siempre es el acento activo (nunca un color ajeno) y siempre en baja opacidad (12-18%) — es ambiente, no un efecto llamativo.

## Shapes

El radio de esquina es, junto con la sombra, la variable que más cambia entre materiales: de esquinas totalmente vivas (Minimal, `0px`) al extremo más redondeado del sistema (Kawaii, `2rem` en superficies / `1.5rem` en controles, con inputs, botones y chips en píldora completa `999px` — es el único material donde CADA control interactivo es una píldora, no solo algunos). El material Default usa `1.5rem` en superficies y `0.75rem` en controles internos — es el punto de referencia cuando no se especifica material. Cute usa esquinas grandes y parejas (`1.75rem`/`1.25rem`, con borde punteado `2px dashed` como seña de identidad) — deliberadamente un escalón menos extremo que Kawaii, para que los dos materiales "tiernos" se sientan distintos entre sí y no como el mismo look con otro nombre.

### Named Rules
**La Regla del Radio No Fijo.** A diferencia de un sistema de diseño convencional, el radio de esquina no es un token único: es parte de la identidad seleccionable. Cualquier componente nuevo debe leer `var(--surface-radius)` / `var(--surface-radius-sm)`, nunca un valor de radio hardcodeado, para heredar correctamente los cuatro materiales.

## Components

Táctil y de arcade: los componentes tienen peso, glow y transición suave (0.35s) en cada cambio de propiedad visual al alternar de tema — nunca un corte abrupto.

### Buttons
- **Shape:** radio `var(--surface-radius-sm)` (12px en Default), píldora completa en Kawaii/Cute.
- **Primary:** degradé del acento activo a su color secundario (`linear-gradient(to right, var(--accent), var(--accent-2))`), texto blanco, `padding` generoso (12px 32px), mayúsculas con tracking amplio.
- **Hover / Focus:** `filter: brightness(1.12)` en primary; en Cute/Kawaii suma un `translateY(-2px)` suave (sin rebote/elastic easing — la calidez viene de la forma y el glow, no de una animación exagerada); en Kawaii, `:active` suma `scale(0.96)` — el único material con feedback de "apretado" al soltar el clic.
- **Secondary:** fondo tenue del acento sobre la superficie (`color-mix` 16%), borde del acento al 55%, texto en el tono suave del acento (`--accent-soft`).
- **Kawaii/Cute son la excepción de color de texto:** al vivir sobre fondo pastel claro (no el casi-negro de Default/Minimal), todo su texto —incluido el botón primario— usa la tinta oscura del material (`--ink-kawaii`/`--ink-cute`) en vez de blanco. El botón primario de Kawaii además usa un degradé **pastel lleno** (`linear-gradient(145deg, var(--accent-pastel), color-mix(accent-2 55% white))`, no el degradé eléctrico del resto) — ver Colors › Acento Pastel / Tinta de Material.

### Chips
- **Style:** fondo del acento activo al 22% de opacidad, texto en `--accent-soft`, siempre píldora completa. En Kawaii, relleno pastel lleno (`--accent-pastel`) con texto en `--ink-kawaii`. En Cute, relleno del acento a `oklch(from var(--accent) 0.6 0.14 h)` con texto en `--ink-cute` y borde punteado, mismo criterio de tinta oscura por vivir sobre fondo claro.
- **State:** los badges de estado (Activa/Revocada/Por vencer/Expirada en licencias) no usan el acento — usan los colores de estado fijos (verde/rojo/ámbar/gris) con el mismo tratamiento de badge (fondo 40% + borde 50%).

### Cards / Containers (`.theme-surface`)
- **Corner Style:** `var(--surface-radius)` (24px en Default; 0 en Minimal, con `border-left` de acento en su lugar).
- **Background:** `var(--surface-bg)`, con variante `theme-surface-featured` que suma un borde del acento al 45% para destacar el bloque de "vista previa" o resumen activo de cada módulo.
- **Shadow Strategy:** ver Elevation & Depth — depende del material activo.
- **Internal Padding:** `1.25rem`–`1.5rem` estándar en todos los materiales.

### Inputs / Fields
- **Style:** fondo `var(--surface-bg-alt)`, radio `var(--surface-radius-sm)` (en Kawaii/Cute, píldora completa: `border-radius: 999px`), sin sombra en reposo.
- **Focus:** el borde pasa al acento activo; en Default/Kawaii/Cute suma un glow externo suave del acento (`box-shadow` `color-mix`) — en Kawaii ese glow es más ancho (`0 0 0 5px`) para que combine con el resto de sombras profundas del material.
- **Disabled:** opacidad 50% + cursor `not-allowed` (ver `TikTokLoginBar`, se bloquea mientras hay un juego activo).

### Navigation (dock de íconos)
- Columna fija de botones cuadrados de ícono + micro-label (8px, mayúsculas) debajo. El estado activo suma fondo tintado del acento (20%) y borde sólido del acento; el material Minimal reemplaza esto por una línea vertical de acento a la izquierda del ícono, sin fondo. El dock en sí (`.theme-sidebar`) hereda `var(--surface-bg)`/`var(--surface-shadow)` como cualquier superficie.

### Franja de Premio (componente propio)
Franja horizontal fija (imagen 50×50 + título) que comparten los tres juegos de regalos para mostrar el premio configurado. Usa siempre esmeralda fijo (`emerald-900/25` fondo, `emerald-500/40` borde), independiente del acento del tema — es la única superficie de "contenido de juego" que no seguirá el material/acento activo, porque comunica un estado de negocio (premio), no navegación de marca.

### Overlay de OBS (`.theme-die-frame`)
La tarjeta de cada juego en el overlay (lo que la audiencia ve, recortado como fuente de captura en OBS) usa `.theme-die-frame` — la misma variante de `.theme-surface` pero sin el padding forzado que algunos materiales le suman a las superficies normales, porque acá el padding lo define el layout del juego, no el material. Refleja el mismo material/acento que el panel de control, sincronizado por socket en tiempo real (ver Overview). Dentro de la tarjeta, las etiquetas y bordes que representan la marca del streamer ("STEAL SPOT WITH:", el aro del avatar activo, las cajas de metadata) siguen `var(--accent)`/`var(--surface-bg-alt)`; los colores de estado del juego (amarillo insta-win/ganador, rojo snipe/peligro, gris pausa) se mantienen fijos, igual que en el panel — la regla de "Estado" de la sección Colors aplica también acá.

## Do's and Don'ts

### Do:
- **Do** leer siempre los tokens CSS (`var(--surface-bg)`, `var(--accent)`, `var(--surface-radius)`) en vez de hardcodear color o radio — un componente nuevo debe funcionar en los 16 combos de material×acento sin tocarlo.
- **Do** usar mayúsculas + tracking amplio + peso `black` para cualquier etiqueta, botón o estado nuevo — es la voz tipográfica dominante del sistema.
- **Do** reservar los colores de estado fijos (rojo/ámbar/esmeralda/gris) exclusivamente para semántica de juego o licencia (peligro, aviso, premio/éxito, offline) — nunca para decoración.
- **Do** sincronizar el overlay de OBS (`Overlay.jsx`) con el skin elegido en el panel — recibe `theme` por socket (evento `theme_updated`, ver `tenant.js`/`App.jsx`) y se pinta con `.themed-app`/`data-theme-style`/`data-accent` igual que cualquier otra pantalla. El overlay nunca decide su propio tema ni lo lee de `localStorage`.
- **Do** mantener el fondo casi negro en Default y Minimal — son la cabina nocturna base del sistema, no candidatos a pastel claro.
- **Do** usar tinta oscura (`--ink-kawaii` / `--ink-cute`) en TODO el texto blanco/gris dentro del scope de esos dos materiales — a diferencia de Default/Minimal (fondo oscuro, texto blanco), Kawaii y Cute son fondo claro de punta a punta, así que la sobreescritura de tinta no se limita a un botón o chip puntual.
- **Do** definir `--page-bg`/`--surface-bg`/`--surface-bg-alt` de cualquier material (nuevo o existente) como `oklch(from var(--accent) L C h)` con `L`/`C` fijos a mano — nunca un hex fijo, nunca `color-mix()` hacia una base. Ver La Regla del Fondo Teñido y La Regla del Color Construido, No Mezclado.

### Don't:
- **Don't** dejar un fondo (`--page-bg`, `--surface-bg`, sombra ambiental) como color fijo sin relación al acento — es exactamente el bug que tenía el glow de Default hasta que se corrigió, y el motivo original de este Do.
- **Don't** usar `color-mix()` para construir `--page-bg`/`--surface-bg`/`--surface-bg-alt` — mezclar hacia una base siempre diluye el croma en proporción distinta según el acento (rosa/verde quedan más lavados que morado/azul con el mismo %), aunque la base sea neutra y la mezcla sea `in oklch`. Es el bug que ya se corrigió dos veces antes de encontrar la causa real: usar `oklch(from ...)` para construir el color directo, no para mezclarlo.
- **Don't** introducir un look plano/neutro tipo "SaaS corporativo" (fondo blanco puro o gris sin teñir, sombras suaves de dashboard B2B) en ningún material, incluidos Kawaii/Cute — el pastel de estos dos SIEMPRE lleva el matiz del acento activo (`oklch(from var(--accent)...)`), nunca un gris o blanco neutro; "claro" no es lo mismo que "sin color".
- **Don't** usar el color de acento para estados de negocio (premio, error, aviso) — esos ya tienen su propio color fijo; mezclar los dos sistemas rompe la lectura rápida en medio de un live.
- **Don't** agregar una quinta familia tipográfica o romper la regla de "una sola fuente, jerarquía por peso/tracking" sin decisión explícita.
- **Don't** usar bounce/elastic easing en transiciones nuevas (incluidos Cute y Kawaii) — la calidez del material viene de la forma, el punteado/relleno pastel y el glow, nunca de una animación con rebote.
