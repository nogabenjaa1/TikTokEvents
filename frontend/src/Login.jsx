import React, { useState } from 'react';
import { loginWithKey, requestFreeTrial, saveSession } from './auth';
import RewardedAdGate from './RewardedAdGate';

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
  // Ver un anuncio es obligatorio ANTES de poder pedir la prueba gratis —
  // se gatea la revelación del formulario (showTrial), no el submit en sí.
  const [showAdGate, setShowAdGate] = useState(false);
  const [alias, setAlias] = useState('');
  const [trialError, setTrialError] = useState('');
  const [trialLoading, setTrialLoading] = useState(false);
  // Se muestra ANTES de loguear (ver submitTrial): la key es la única
  // credencial de esta licencia, y si se pierde antes de guardarla no hay
  // forma de recuperarla — ver auth.requestFreeTrial.
  const [trialResult, setTrialResult] = useState(null); // { key, token, license }
  const [trialCopied, setTrialCopied] = useState(false);

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
      const result = await requestFreeTrial(alias.trim());
      setTrialResult(result); // se muestra para copiar antes de continuar, ver abajo
    } catch (err) {
      setTrialError(err.message || 'No se pudo crear la prueba gratis');
    } finally {
      setTrialLoading(false);
    }
  };

  const copyTrialKey = () => {
    navigator.clipboard.writeText(trialResult.key);
    setTrialCopied(true);
    setTimeout(() => setTrialCopied(false), 2000);
  };

  const continueAfterTrial = () => {
    const { token, key: trialKey, license } = trialResult;
    // Se guarda además del token para poder armar la URL del overlay
    // (?overlay=true&key=...) sin pedírsela de nuevo — ver auth.buildOverlayUrl.
    saveSession({ token, licenseKey: trialKey, ...license });
    onLoggedIn();
  };

  return (
    <div className={embedded ? 'w-full flex items-center justify-center p-6 font-sans' : 'min-h-screen text-white flex items-center justify-center p-6 font-sans'}>
      <div className="w-full max-w-sm flex flex-col gap-4">
        <form onSubmit={submit} className="theme-surface p-8">
          <div className="flex items-center gap-3 mb-8">
            <div className="theme-accent-bg w-3 h-8 rounded-full" />
            <h1 className="theme-heading text-2xl font-semibold tracking-wide">TikTok Concurso</h1>
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

        {/* Prueba gratis: autoservicio, sin tarjeta. Solo pide un alias — el
            usuario real de TikTok recién se registra y se bloquea cuando
            esta licencia se conecta a un LIVE por primera vez (backend). */}
        <div className="theme-surface p-6">
          {trialResult ? (
            <div className="flex flex-col gap-3">
              <p className="theme-label text-xs uppercase tracking-widest font-semibold">Guarda tu clave</p>
              <p className="text-[11px] text-gray-500">
                Es tu única credencial — cópiala antes de continuar. Si más adelante pasas a un
                plan pago, sigues usando esta misma clave (solo cambia el nivel, nunca el texto).
              </p>
              <div className="flex items-center gap-2">
                <code className="theme-input flex-1 px-3 py-2 text-xs text-green-300 break-all">{trialResult.key}</code>
                <button type="button" onClick={copyTrialKey} className="theme-btn-primary px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap">
                  {trialCopied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              <button
                type="button"
                onClick={continueAfterTrial}
                className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all"
              >
                Continuar
              </button>
            </div>
          ) : !showTrial ? (
            <button
              type="button"
              onClick={() => setShowAdGate(true)}
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
              {trialError && <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">{trialError}</p>}
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

      <RewardedAdGate
        open={showAdGate}
        onClaim={() => { setShowAdGate(false); setShowTrial(true); }}
        onCancel={() => setShowAdGate(false)}
        title="Mira un anuncio para continuar"
        description="Antes de pedir tu prueba gratis de 7 días, mira un anuncio corto — nos ayuda a mantener el servicio gratis."
      />
    </div>
  );
}
