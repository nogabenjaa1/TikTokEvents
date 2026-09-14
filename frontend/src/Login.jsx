import React, { useState } from 'react';
import { loginWithKey, saveSession } from './auth';
import logoMark from './assets/logo-mark.png';

// Pantalla de login: pide la license key (no hay username/password
// separado, la key ES la credencial). `notice` es un aviso no-error (ej.
// "te desconectamos porque entraste desde otro dispositivo", o el mensaje
// de función bloqueada cuando se usa `embedded`). `embedded`: se usa
// dentro de un panel ya bloqueado (Rey del Trono/Zubastinis/Eliminación/
// TTS sin sesión) en vez de la pantalla de login inicial de pantalla
// completa.
//
// Pedido explícito: la prueba gratis (ver anuncios / verificar tarjeta /
// alias directo) se mudó entera a Membership.jsx -- ahí es donde el
// streamer elige entre probar gratis o comprar un plan, todo en un solo
// lugar, en vez de repetido acá. `onWantsMembership` (siempre provisto por
// los usos `embedded` en App.jsx) es el único puente entre las dos.
export default function Login({ onLoggedIn, notice = '', embedded = false, onWantsMembership }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!key.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const trimmedKey = key.trim();
      const { token, license } = await loginWithKey(trimmedKey);
      // Se guarda además del token para poder armar la URL del overlay
      // (?overlay=true&key=...) sin pedírsela de nuevo — ver auth.buildOverlayUrl.
      saveSession({ token, licenseKey: trimmedKey, ...license });
      onLoggedIn();
    } catch (err) {
      setError(err.message || 'Licencia inválida, revocada o expirada');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={embedded ? 'w-full flex items-center justify-center p-6 font-sans' : 'min-h-screen text-white flex items-center justify-center p-6 font-sans'}>
      <div className="w-full max-w-sm flex flex-col gap-4">
        <form onSubmit={submit} className="theme-surface p-8">
          <div className="flex items-center gap-3 mb-8">
            <img src={logoMark} alt="" className="h-9 w-auto flex-shrink-0" />
            <h1 className="theme-heading text-2xl font-semibold tracking-wide">BenjaApis</h1>
          </div>

          {notice && <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold mb-4">{notice}</p>}

          <label className="theme-label block text-xs uppercase tracking-widest font-semibold mb-2">Clave de licencia</label>
          <input
            autoFocus={!embedded}
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Pega tu clave aquí"
            className="theme-input w-full p-4 outline-none transition-all placeholder-gray-600 font-bold text-white text-sm mb-4"
          />

          {error && <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold mb-4">{error}</p>}

          <button
            type="submit"
            disabled={loading || !key.trim()}
            className="theme-btn-primary w-full py-4 rounded-xl font-black tracking-widest uppercase text-sm transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'VERIFICANDO...' : 'ENTRAR'}
          </button>

          <p className="text-[10px] text-gray-600 mt-4 text-center">¿Sin clave? Pídesela al administrador.</p>
        </form>

        {onWantsMembership && (
          <button
            type="button"
            onClick={onWantsMembership}
            className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all"
          >
            ¿No tienes licencia? Ver planes y prueba gratis
          </button>
        )}
      </div>
    </div>
  );
}
