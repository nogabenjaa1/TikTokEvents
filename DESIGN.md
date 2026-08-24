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
  page-void: "#05030A"
  surface-deep: "#0D081A"
  surface-raised: "#130E24"
  surface-line: "#2D1B4E"
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

Lo más distintivo del sistema no es una paleta fija sino su **pluralismo controlado**: cuatro "materiales" (Default, Glass, Minimal, Clay) combinables con cuatro acentos de color (morado, azul, rosa, verde) — 16 combinaciones reales, todas construidas sobre el mismo esqueleto de tokens CSS (`--page-bg`, `--surface-bg`, `--surface-radius`, `--surface-shadow`, `--accent`). Cambiar de material cambia radicalmente el lenguaje de forma y profundidad (de esquinas vivas y sombra de neón a paneles totalmente planos sin caja), pero nunca el ritmo de la información ni la jerarquía tipográfica.

El overlay de OBS (lo que ve la audiencia del stream) está deliberadamente **fuera** de este sistema de temas — nunca lleva la clase `.themed-app` — para que la captura de video nunca cambie de aspecto sin que el streamer lo note.

**Key Characteristics:**
- Fondo casi negro + un único acento vivo como faro de atención.
- Cuatro materiales seleccionables (Default / Glass / Minimal / Clay), un mismo esqueleto de tokens.
- Mayúsculas, tracking amplio y peso `black` para todo lo que es etiqueta o acción.
- Táctil y de arcade, no SaaS corporativo: glows, gradientes, transiciones de 0.35s en cada cambio de tema.
- El overlay de OBS vive fuera del sistema de temas — su aspecto es fijo, nunca varía.

## Colors

Paleta oscura de un solo acento vivo sobre neutros casi negros; los colores de estado (rojo, ámbar, esmeralda) son fijos y no cambian con el acento elegido.

### Primary
- **Neón Violeta** (`#7C3AED`): acento por defecto (`--accent`). Botones primarios, texto de énfasis, glow de foco, indicador de módulo activo. Es el faro del sistema — en el material Minimal es literalmente lo único con color en toda la pantalla.
- **Índigo Profundo** (`#6366F1`): pareja de degradé del acento (`--accent-2`). Nunca aparece solo; siempre como el segundo extremo del gradiente en `button-primary` y en la aurora de fondo del material Glass.

### Secondary — acentos alternos seleccionables
El streamer elige uno de estos cuatro como su `--accent` activo; los otros tres quedan disponibles en el selector de Tema. Todos siguen la misma regla: viven en botones, texto de énfasis y glows, nunca en superficies neutras.
- **Azul Transmisión** (`#3B82F6` / secundario `#06B6D4`)
- **Rosa Neón** (`#EC4899` / secundario `#FB7185`)
- **Verde Esmeralda Eléctrico** (`#10B981` / secundario `#34D399`)

### Neutral
- **Vacío Casi-Negro** (`#05030A`): fondo de página (`--page-bg`) en el material Default. Existe para que el acento sea lo único que respire.
- **Panel Profundo** (`#0D081A`): fondo de superficie (`--surface-bg`) — tarjetas, sidebar, inputs de fondo.
- **Panel Elevado** (`#130E24`): fondo de superficie secundaria (`--surface-bg-alt`) — inputs, filas alternas.
- **Línea Violeta Apagada** (`#2D1B4E`): borde de superficie por defecto (`--surface-border-color`) y color de scrollbar.
- **Blanco Puro** (`#FFFFFF`): texto primario sobre fondo oscuro.

### Estado (fijos, no siguen el acento elegido)
- **Rojo Alerta** (`#EF4444`): ventanas de snipe/peligro, licencias revocadas, errores. Siempre en pares badge (fondo `red-950/70` + borde `red-500/70` + texto claro).
- **Ámbar Aviso** (`#F59E0B`): avisos de vencimiento de licencia, estados "por vencer" o "verificando".
- **Esmeralda Premio** (`#10B981`): franja de premio compartida por los tres juegos y estado "activa"/"conectado en vivo" — casualmente comparte hex con el acento verde, pero es un token de estado independiente, no cambia si el streamer elige otro acento.
- **Gris Apagado** (`#6B7280`): estados offline, deshabilitado, texto secundario de baja prioridad.

### Named Rules
**La Regla del Faro Único.** El acento vivo es siempre el único color saturado en pantalla fuera de los badges de estado (rojo/ámbar/esmeralda). Ningún otro elemento decorativo compite por atención con él.

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

Layout de aplicación de una sola pantalla (no hay scroll de página, cada panel maneja su propio `overflow-y-auto`). Estructura fija: sidebar de navegación de íconos a la izquierda (72px, o 48-60px según el material activo), barra de conexión TikTok flotante fija en la esquina superior derecha, y un panel principal central que ocupa el resto del viewport. No hay grilla responsive tradicional — la app está diseñada para una ventana de escritorio (el streamer trabajando junto a OBS), no para mobile.

El overlay de OBS es un layout completamente aparte, sin sidebar ni chrome: solo la tarjeta o card del juego activo, pensada para recortarse directamente como fuente de captura.

## Elevation & Depth

Sistema híbrido: el material Default y Clay usan sombra real (glow de acento y relieve tipo softui respectivamente); Glass usa blur + reflejo interior en vez de sombra dura; Minimal es deliberadamente plano — cero sombra, la profundidad la da solo una línea de borde. La elevación no es un valor fijo del sistema: es una de las cuatro decisiones de material que el streamer elige.

### Shadow Vocabulary (por material)
- **Default — Glow ambiental** (`0 0 50px rgba(107,33,168,0.15)`): sombra difusa violeta bajo las superficies principales, no ligada a interacción.
- **Glass — Relieve de vidrio** (`inset 0 1px 0 rgba(255,255,255,.12), inset 0 0 0 .5px rgba(255,255,255,.06), 0 8px 32px rgba(0,0,0,.45), 0 2px 8px rgba(0,0,0,.25)`): reflejo superior + sombra profunda exterior, simula una lámina de vidrio flotando.
- **Clay — Relieve doble (softui)** (`12px 12px 28px rgba(0,0,0,.55), -10px -10px 24px rgba(255,255,255,.07)`): sombra hacia ambos lados que hace que las superficies parezcan infladas; los inputs usan la sombra invertida (`inset`) para verse hundidos.
- **Minimal — Ninguna**: cero `box-shadow`. La única señal de profundidad es `border-left: 2px solid` en el acento activo.

### Named Rules
**La Regla del Glow Único.** Cuando hay sombra de color, siempre es el acento activo (nunca un color ajeno) y siempre en baja opacidad (12-18%) — es ambiente, no un efecto llamativo.

## Shapes

El radio de esquina es, junto con la sombra, la variable que más cambia entre materiales: de esquinas totalmente vivas (Minimal, `0px`) a esquinas muy redondeadas (Clay, `2.5rem` en superficies grandes). El material Default usa `1.5rem` en superficies y `0.75rem` en controles internos (inputs, botones) — es el punto de referencia cuando no se especifica material. Los chips y algunos botones (Glass, Clay) usan `border-radius: 999px` (píldora completa) independientemente del material activo en superficies.

### Named Rules
**La Regla del Radio No Fijo.** A diferencia de un sistema de diseño convencional, el radio de esquina no es un token único: es parte de la identidad seleccionable. Cualquier componente nuevo debe leer `var(--surface-radius)` / `var(--surface-radius-sm)`, nunca un valor de radio hardcodeado, para heredar correctamente los cuatro materiales.

## Components

Táctil y de arcade: los componentes tienen peso, glow y transición suave (0.35s) en cada cambio de propiedad visual al alternar de tema — nunca un corte abrupto.

### Buttons
- **Shape:** radio `var(--surface-radius-sm)` (12px en Default), píldora completa en Glass/Clay.
- **Primary:** degradé del acento activo a su color secundario (`linear-gradient(to right, var(--accent), var(--accent-2))`), texto blanco, `padding` generoso (12px 32px), mayúsculas con tracking amplio.
- **Hover / Focus:** `filter: brightness(1.12)` en primary; en Clay, `:active` agrega sombra interna (efecto "apretado").
- **Secondary:** fondo tenue del acento sobre la superficie (`color-mix` 16%), borde del acento al 55%, texto en el tono suave del acento (`--accent-soft`).

### Chips
- **Style:** fondo del acento activo al 22% de opacidad, texto en `--accent-soft`, siempre píldora completa.
- **State:** los badges de estado (Activa/Revocada/Por vencer/Expirada en licencias) no usan el acento — usan los colores de estado fijos (verde/rojo/ámbar/gris) con el mismo tratamiento de badge (fondo 40% + borde 50%).

### Cards / Containers (`.theme-surface`)
- **Corner Style:** `var(--surface-radius)` (24px en Default; 0 en Minimal, con `border-left` de acento en su lugar).
- **Background:** `var(--surface-bg)`, con variante `theme-surface-featured` que suma un borde del acento al 45% para destacar el bloque de "vista previa" o resumen activo de cada módulo.
- **Shadow Strategy:** ver Elevation & Depth — depende del material activo.
- **Internal Padding:** `1.25rem`–`1.5rem` estándar; Clay fuerza `2.25rem` (parte de su carácter "inflado").

### Inputs / Fields
- **Style:** fondo `var(--surface-bg-alt)`, radio `var(--surface-radius-sm)`, sin sombra en reposo (excepto Clay, que nace hundido con sombra `inset`).
- **Focus:** el borde pasa al acento activo; en Default/Glass suma un glow externo suave del acento (`box-shadow` `color-mix` al 18%).
- **Disabled:** opacidad 50% + cursor `not-allowed` (ver `TikTokLoginBar`, se bloquea mientras hay un juego activo).

### Navigation (dock de íconos)
- Columna fija de botones cuadrados de ícono + micro-label (8px, mayúsculas) debajo. El estado activo suma fondo tintado del acento (20%) y borde sólido del acento; el material Minimal reemplaza esto por una línea vertical de acento a la izquierda del ícono, sin fondo. El dock en sí (`.theme-sidebar`) hereda `var(--surface-bg)`/`var(--surface-shadow)` como cualquier superficie.

### Franja de Premio (componente propio)
Franja horizontal fija (imagen 50×50 + título) que comparten los tres juegos de regalos para mostrar el premio configurado. Usa siempre esmeralda fijo (`emerald-900/25` fondo, `emerald-500/40` borde), independiente del acento del tema — es la única superficie de "contenido de juego" que no seguirá el material/acento activo, porque comunica un estado de negocio (premio), no navegación de marca.

## Do's and Don'ts

### Do:
- **Do** leer siempre los tokens CSS (`var(--surface-bg)`, `var(--accent)`, `var(--surface-radius)`) en vez de hardcodear color o radio — un componente nuevo debe funcionar en los 16 combos de material×acento sin tocarlo.
- **Do** usar mayúsculas + tracking amplio + peso `black` para cualquier etiqueta, botón o estado nuevo — es la voz tipográfica dominante del sistema.
- **Do** reservar los colores de estado fijos (rojo/ámbar/esmeralda/gris) exclusivamente para semántica de juego o licencia (peligro, aviso, premio/éxito, offline) — nunca para decoración.
- **Do** mantener el overlay de OBS (`Overlay.jsx`) completamente fuera de `<ThemedShell>` — su aspecto debe ser estable sin importar el tema elegido por el streamer.

### Don't:
- **Don't** introducir un look plano/claro tipo "SaaS corporativo" (fondos blancos o gris claro, sombras suaves de dashboard B2B) — este es un panel de show en vivo nocturno, no una app de oficina.
- **Don't** usar el color de acento para estados de negocio (premio, error, aviso) — esos ya tienen su propio color fijo; mezclar los dos sistemas rompe la lectura rápida en medio de un live.
- **Don't** agregar una quinta familia tipográfica o romper la regla de "una sola fuente, jerarquía por peso/tracking" sin decisión explícita.
