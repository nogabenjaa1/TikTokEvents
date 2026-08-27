import React, { useState } from 'react';
import { loginWithKey, saveSession } from './auth';

// Pantalla de login: solo pide la license key (no hay username/password
// separado, la key ES la credencial). `notice` es un aviso no-error (ej.
// "te desconectamos porque entraste desde otro dispositivo").
export default function Login({ onLoggedIn, notice = '' }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!key.trim() || loading) return;
    setLoading(true);
    setError('');
    try {
      const { token, license } = await loginWithKey(key.trim());
      saveSession({ token, ...license });
      onLoggedIn();
    } catch (err) {
      setError(err.message || 'Licencia inválida, revocada o expirada');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen text-white flex items-center justify-center p-6 font-sans">
      <form onSubmit={submit} className="theme-surface w-full max-w-sm p-8">
        <div className="flex items-center gap-3 mb-8">
          <div className="theme-accent-bg w-3 h-8 rounded-full" />
          <h1 className="theme-heading text-2xl font-semibold tracking-wide">TikTok Concurso</h1>
        </div>

        {notice && <p className="text-amber-400 text-xs font-bold mb-4">⚠️ {notice}</p>}

        <label className="theme-label block text-xs uppercase tracking-widest font-semibold mb-2">Clave de licencia</label>
        <input
          autoFocus
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
    </div>
  );
}
