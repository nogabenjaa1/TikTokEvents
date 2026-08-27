import React, { useState } from 'react';
import { loginWithKey, requestFreeTrial, saveSession } from './auth';

// Pantalla de login: pide la license key (no hay username/password
// separado, la key ES la credencial), o permite pedir una prueba gratis de
// 7 días con solo un alias (texto libre, no se valida contra TikTok — ver
// auth.requestFreeTrial). `notice` es un aviso no-error (ej. "te
// desconectamos porque entraste desde otro dispositivo", o el mensaje de
// función bloqueada cuando se usa `embedded`). `embedded`: se usa dentro de
// un panel ya bloqueado (Rey del Trono/Zubastinis/Eliminación/TTS sin
// sesión) en vez de la pantalla de login inicial de pantalla completa.
export default function Login({ onLoggedIn, notice = '', embedded = false }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [showTrial, setShowTrial] = useState(false);
  const [alias, setAlias] = useState('');
  const [trialError, setTrialError] = useState('');
  const [trialLoading, setTrialLoading] = useState(false);

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

  const submitTrial = async (e) => {
    e.preventDefault();
    if (!alias.trim() || trialLoading) return;
    setTrialLoading(true);
    setTrialError('');
    try {
      const { key: trialKey, token, license } = await requestFreeTrial(alias.trim());
      saveSession({ token, licenseKey: trialKey, ...license });
      onLoggedIn();
    } catch (err) {
      setTrialError(err.message || 'No se pudo crear la prueba gratis');
    } finally {
      setTrialLoading(false);
    }
  };

  return (
    <div className={embedded ? 'w-full flex items-center justify-center p-6 font-sans' : 'min-h-screen text-white flex items-center justify-center p-6 font-sans'}>
      <div className="w-full max-w-sm flex flex-col gap-4">
        <form onSubmit={submit} className="theme-surface p-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="theme-accent-bg w-3 h-8 rounded-full" />
            <h1 className="theme-heading text-2xl font-semibold tracking-wide">TikTok Concurso</h1>
          </div>

          {notice && <p className="text-amber-400 text-xs font-bold mb-4">⚠️ {notice}</p>}

          <label className="theme-label block text-xs uppercase tracking-widest font-semibold mb-2">Clave de licencia</label>
          <input
            autoFocus={!embedded}
            value={key}
            onChange={e => setKey(e.target.value)}
            placeholder="Pega tu clave aquí"
            className="theme-input w-full p-4 outline-none transition-all placeholder-gray-600 font-bold text-white text-sm mb-4"
          />

          {error && <p className="text-red-400 text-xs font-bold mb-4">❌ {error}</p>}

          <button
            type="submit"
            disabled={loading || !key.trim()}
            className="theme-btn-primary w-full py-4 rounded-xl font-black tracking-widest uppercase text-sm transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {loading ? 'VERIFICANDO...' : 'ENTRAR'}
          </button>

          <p className="text-[10px] text-gray-600 mt-4 text-center">¿Sin clave? Pídesela al administrador.</p>
        </form>

        {/* Prueba gratis: autoservicio, sin tarjeta. Solo pide un alias — el
            usuario real de TikTok recién se registra y se bloquea cuando
            esta licencia se conecta a un LIVE por primera vez (backend). */}
        <div className="theme-surface p-6">
          {!showTrial ? (
            <button
              type="button"
              onClick={() => setShowTrial(true)}
              className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all"
            >
              ¿No tienes una licencia? Solicita 7 días gratis
            </button>
          ) : (
            <form onSubmit={submitTrial} className="flex flex-col gap-3">
              <p className="theme-label text-xs uppercase tracking-widest font-semibold">Prueba gratis de 7 días</p>
              <p className="text-[11px] text-gray-500">Elige un alias para tu clave. Acceso completo por 7 días, sin tarjeta.</p>
              <input
                value={alias}
                onChange={e => setAlias(e.target.value)}
                placeholder="Elige un alias"
                className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-white text-sm"
              />
              {trialError && <p className="text-red-400 text-xs font-bold">❌ {trialError}</p>}
              <button
                type="submit"
                disabled={trialLoading || !alias.trim()}
                className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {trialLoading ? 'CREANDO...' : 'Solicitar prueba gratis'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
