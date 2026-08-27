import React, { useState } from 'react';
import { buildOverlayUrl } from './auth';

function OverlayUrlCard({ title, description, url }) {
  const [copied, setCopied] = useState(false);
  const [previewBlocked, setPreviewBlocked] = useState(false);

  const copyUrl = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openPreview = () => {
    if (!url) return;
    const win = window.open(url, '_blank', 'width=1920,height=1080');
    // Algunos navegadores bloquean la ventana igual (configuración estricta
    // de ventanas emergentes); avisamos en vez de fallar en silencio.
    setPreviewBlocked(!win);
  };

  return (
    <div className="theme-surface w-full max-w-xl p-6">
      <h2 className="theme-heading text-lg font-bold mb-1">{title}</h2>
      <p className="text-gray-500 text-xs mb-5">{description}</p>

      {!url ? (
        <p className="text-amber-400 text-xs font-bold">
          No pudimos recuperar tu clave de licencia de esta sesión. Cierra sesión y vuelve a entrar con tu clave para generar el enlace.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            <code className="theme-input flex-1 px-3 py-2 text-xs text-green-300 break-all">{url}</code>
          </div>
          <div className="flex gap-3">
            <button onClick={copyUrl} className="theme-btn-primary flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest">
              {copied ? '✅ Copiado' : 'Copiar URL'}
            </button>
            <button onClick={openPreview} className="theme-btn-secondary flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest">
              👁️ Preview
            </button>
          </div>
          {previewBlocked && (
            <p className="text-amber-400 text-[11px] font-bold mt-3">
              ⚠️ Tu navegador bloqueó la ventana. Permite las ventanas emergentes para este sitio e inténtalo de nuevo.
            </p>
          )}
        </>
      )}
    </div>
  );
}

// Pantalla de ayuda para obtener las URLs de overlay (?overlay=true&key=...)
// y pegarlas como fuente de navegador en OBS/TikTok LIVE Studio. La key ya
// viene incluida (ver auth.buildOverlayUrl) — nunca se pide de nuevo acá.
// Hay dos overlays distintos: el normal (Rey del Trono/Zubastinis/
// Eliminación, vertical) y el especial de Colores (dados, horizontal, ver
// DiceOverlay.jsx) — cada juego usa el que corresponde, nunca el otro.
export default function OverlayLink() {
  const gamesUrl = buildOverlayUrl('games');
  const colorsUrl = buildOverlayUrl('colors');

  return (
    <div className="min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-10 font-sans flex-1 overflow-y-auto">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🖥️ Overlay</p>

      <OverlayUrlCard
        title="Overlay de juegos (Rey del Trono / Zubastinis / Eliminación)"
        description="Úsalo para estos tres modos. Ya incluye tu clave de licencia — es personal, no la compartas con nadie."
        url={gamesUrl}
      />

      <OverlayUrlCard
        title="Overlay de Colores (dados)"
        description="Overlay horizontal aparte, exclusivo para Color Says — no sirve para los otros modos."
        url={colorsUrl}
      />

      <div className="theme-surface w-full max-w-xl p-6 text-xs text-gray-400 space-y-5">
        <div>
          <h3 className="theme-heading text-sm font-bold mb-2">En OBS Studio</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>En la escena que quieras, haz clic en <strong className="text-gray-300">+</strong> dentro de "Fuentes" → <strong className="text-gray-300">Navegador</strong>.</li>
            <li>Pega la URL correspondiente en el campo "URL" — la de "juegos" para Rey del Trono/Zubastinis/Eliminación, la de "Colores" solo para Color Says.</li>
            <li>Configura el ancho y el alto: 1920×1080 para el overlay de juegos (vertical); para el de Colores, ancho de al menos 960px, con menos alto (es horizontal).</li>
            <li>Acepta — cada overlay se sincroniza solo con lo que hagas en su panel correspondiente.</li>
          </ol>
        </div>
        <div>
          <h3 className="theme-heading text-sm font-bold mb-2">En TikTok LIVE Studio</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Agrega una fuente de tipo <strong className="text-gray-300">Web/Navegador</strong> a tu escena.</li>
            <li>Pega la URL correspondiente (juegos o Colores, según el modo).</li>
            <li>Ajusta el tamaño de la fuente al modo elegido, igual que en OBS.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
