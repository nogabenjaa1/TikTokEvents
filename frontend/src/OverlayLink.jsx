import React, { useState } from 'react';
import { buildOverlayUrl } from './auth';

function OverlayUrlCard({ title, description, url, onReset, resetLabel, resetConfirm }) {
  const [copied, setCopied] = useState(false);

  const copyUrl = () => {
    if (!url) return;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    if (!onReset) return;
    if (resetConfirm && !window.confirm(resetConfirm)) return;
    onReset();
  };

  return (
    <div className="theme-surface w-full max-w-xl p-6">
      <h2 className="theme-heading text-lg font-bold mb-1">{title}</h2>
      <p className="text-gray-500 text-xs mb-5">{description}</p>

      {!url ? (
        <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">
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
            {/* Enlace real (no window.open): un <a target="_blank"> nunca lo
                bloquea un bloqueador de ventanas emergentes, a diferencia de
                una ventana abierta por script. */}
            <a href={url} target="_blank" rel="noopener noreferrer"
              className="theme-btn-secondary flex-1 px-4 py-3 rounded-xl text-xs font-black uppercase tracking-widest text-center">
              👁️ Preview
            </a>
          </div>
          {onReset && (
            <button onClick={handleReset} className="mt-3 w-full px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-400 border border-red-900/50 hover:bg-red-950/30 transition-colors">
              {resetLabel || 'Reiniciar ranking'}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// Pantalla de ayuda para obtener las URLs de overlay (?overlay=true&key=...)
// y pegarlas como fuente de navegador en OBS/TikTok LIVE Studio. La key ya
// viene incluida (ver auth.buildOverlayUrl) — nunca se pide de nuevo acá.
// Hay cuatro overlays distintos, cada uno con su URL propia: el de juegos
// (Rey del Trono/Zubastinis/Eliminación/Ruleta, vertical), el de Colores
// (dados, horizontal, ver DiceOverlay.jsx) y dos widgets angostos aparte,
// Top Tap-Tap y Top Gifter (rankings continuos, ver TopTapTapOverlay/
// TopGifterOverlay en Overlay.jsx) — cada uno se agrega como fuente de
// navegador independiente, nunca reemplaza a los otros.
export default function OverlayLink({ socket, tapTapState, gifterState }) {
  const gamesUrl = buildOverlayUrl('games');
  const colorsUrl = buildOverlayUrl('colors');
  const tapTapUrl = buildOverlayUrl('taptap');
  const gifterUrl = buildOverlayUrl('gifter');

  const tapTapCount = (tapTapState?.leaderboard || []).length;
  const gifterCount = (gifterState?.leaderboard || []).length;

  return (
    <div className="min-h-screen text-white flex flex-col items-center gap-6 p-6 pt-10 font-sans flex-1 overflow-y-auto">
      <p className="theme-accent-text text-[10px] uppercase tracking-[0.3em] font-black">🖥️ Overlays</p>

      <OverlayUrlCard
        title="Overlay de juegos (Rey del Trono / Zubastinis / Eliminación / Ruleta)"
        description="Úsalo para estos cuatro modos. Ya incluye tu clave de licencia — es personal, no la compartas con nadie."
        url={gamesUrl}
      />

      <OverlayUrlCard
        title="Overlay de Colores (dados)"
        description="Overlay horizontal aparte, exclusivo para Color Says — no sirve para los otros modos."
        url={colorsUrl}
      />

      <OverlayUrlCard
        title="Top Tap-Tap (ranking de likes)"
        description={`Widget angosto aparte con quién más likes mandó en el directo${tapTapCount ? ` — ${tapTapCount} en el ranking ahora` : ''}. Se actualiza solo, sin partida ni ganador: reinícialo a mano cuando arranques un directo nuevo.`}
        url={tapTapUrl}
        onReset={() => socket?.emit('reset_taptap_leaderboard')}
        resetLabel="🗑️ Reiniciar ranking de likes"
        resetConfirm="¿Reiniciar el ranking de Top Tap-Tap? Se borra todo lo acumulado hasta ahora."
      />

      <OverlayUrlCard
        title="Top Gifter (ranking de regalos)"
        description={`Widget angosto aparte con quién más regaló en el directo${gifterCount ? ` — ${gifterCount} en el ranking ahora` : ''}. Se actualiza solo, sin partida ni ganador: reinícialo a mano cuando arranques un directo nuevo.`}
        url={gifterUrl}
        onReset={() => socket?.emit('reset_gifter_leaderboard')}
        resetLabel="🗑️ Reiniciar ranking de regalos"
        resetConfirm="¿Reiniciar el ranking de Top Gifter? Se borra todo lo acumulado hasta ahora."
      />

      <div className="theme-surface w-full max-w-xl p-6 text-xs text-gray-400 space-y-5">
        <div>
          <h3 className="theme-heading text-sm font-bold mb-2">En OBS Studio</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>En la escena que quieras, haz clic en <strong className="text-gray-300">+</strong> dentro de "Fuentes" → <strong className="text-gray-300">Navegador</strong>.</li>
            <li>Pega la URL correspondiente en el campo "URL" — la de "juegos" para Rey del Trono/Zubastinis/Eliminación/Ruleta, la de "Colores" solo para Color Says, y las de Top Tap-Tap/Top Gifter como widgets aparte.</li>
            <li>Configura el ancho y el alto: 1920×1080 para el overlay de juegos (vertical); para el de Colores, ancho de al menos 960px, con menos alto (es horizontal); para Top Tap-Tap/Top Gifter, un ancho de ~400px alcanza (son widgets angostos).</li>
            <li>Acepta — cada overlay se sincroniza solo con lo que hagas en su panel correspondiente.</li>
          </ol>
        </div>
        <div>
          <h3 className="theme-heading text-sm font-bold mb-2">En TikTok LIVE Studio</h3>
          <ol className="list-decimal list-inside space-y-1">
            <li>Agrega una fuente de tipo <strong className="text-gray-300">Web/Navegador</strong> a tu escena.</li>
            <li>Pega la URL correspondiente (juegos, Colores, Top Tap-Tap o Top Gifter, según lo que quieras mostrar).</li>
            <li>Ajusta el tamaño de la fuente al overlay elegido, igual que en OBS.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
