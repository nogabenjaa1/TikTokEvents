import React, { useState } from 'react';
import { buildOverlayUrl } from './auth';

// Pantalla de ayuda para obtener la URL del overlay (?overlay=true&key=...)
// y pegarla como fuente de navegador en OBS/TikTok LIVE Studio. La key ya
// viene incluida (ver auth.buildOverlayUrl) — nunca se pide de nuevo acá.
export default function OverlayLink() {
  const overlayUrl = buildOverlayUrl();
  const [copied, setCopied] = useState(false);
  const [previewBlocked, setPreviewBlocked] = useState(false);

  const copyUrl = () => {
    if (!overlayUrl) return;
    navigator.clipboard.writeText(overlayUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openPreview = () => {
    if (!overlayUrl) return;
    const win = window.open(overlayUrl, '_blank', 'width=1920,height=1080');
    // Algunos navegadores bloquean la ventana igual (config estricta de
    // pop-ups); avisamos en vez de fallar en silencio.
    setPreviewBlocked(!win);
  };

  return (
    <div className="min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-10 font-sans flex-1 overflow-y-auto">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🖥️ Overlay</p>

      <div className="theme-surface w-full max-w-xl p-6">
        <h2 className="theme-heading text-lg font-bold mb-1">URL para OBS / TikTok LIVE Studio</h2>
        <p className="text-gray-500 text-xs mb-5">
          Ya incluye tu clave de licencia — es personal, no la compartas con nadie.
        </p>

        {!overlayUrl ? (
          <p className="text-amber-400 text-xs font-bold">
            No pudimos recuperar tu clave de licencia de esta sesión. Cerrá sesión y volvé a entrar con tu key para generar el enlace.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4">
              <code className="theme-input flex-1 px-3 py-2 text-xs text-green-300 break-all">{overlayUrl}</code>
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
                ⚠️ Tu navegador bloqueó la ventana. Permití pop-ups para este sitio y probá de nuevo.
              </p>
            )}
          </>
        )}
      </div>

      <div className="theme-surface w-full max-w-xl p-6 text-xs text-gray-400 space-y-5">
        <div>
          <h3 className="theme-heading text-sm font-bold mb-2">En OBS Studio</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>En la escena que quieras, clic en <strong className="text-gray-300">+</strong> dentro de "Fuentes" → <strong className="text-gray-300">Navegador</strong>.</li>
            <li>Pegá la URL de arriba en el campo "URL".</li>
            <li>Poné Ancho/Alto igual a tu resolución de stream (ej. 1920×1080).</li>
            <li>Aceptar — el overlay se sincroniza solo con lo que hagas en este panel.</li>
          </ol>
        </div>
        <div>
          <h3 className="theme-heading text-sm font-bold mb-2">En TikTok LIVE Studio</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Agregá una fuente de tipo <strong className="text-gray-300">Web/Navegador</strong> a tu escena.</li>
            <li>Pegá la misma URL de arriba.</li>
            <li>Ajustá el tamaño de la fuente para que cubra toda la pantalla.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
