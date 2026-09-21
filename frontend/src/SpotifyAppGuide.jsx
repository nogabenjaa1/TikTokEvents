import { useState } from 'react';
import { backendUrl, authHeaders } from './auth';

// Guía paso a paso para crear una app propia en el dashboard de Spotify y
// guardar sus credenciales (ver backend/spotify.js, "Quién puede usarlo"): la
// app de la plataforma solo admite unas pocas licencias de clientes, así que quien no
// tiene cupo — o su plan es Anual, o Mensual con el complemento — conecta con
// la suya. Los nombres de los botones van tal cual salen en el dashboard de
// Spotify (en inglés) para que se reconozcan en pantalla.
//
// El Client secret funciona como una contraseña: el backend lo verifica con
// Spotify antes de guardarlo, lo cifra y nunca lo devuelve, así que aquí solo
// vive en el estado mientras se escribe y se borra al guardarse.
//
// `redirectUri` es la dirección EXACTA que Spotify tiene que tener registrada
// (la del callback de este backend, viene de /api/spotify/status). `intro`
// explica por qué le toca a esta licencia crear su app. `onCancel` es
// opcional: sin él no hay a dónde volver (la licencia no tiene otra forma de
// conectar).
function Step({ n, title, children }) {
  return (
    <li className="theme-input px-4 py-3 flex gap-3">
      <span aria-hidden="true" className="theme-chip w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black flex-shrink-0">{n}</span>
      <div className="min-w-0 text-xs text-gray-300 leading-relaxed">
        <p className="font-black text-white mb-1">{title}</p>
        {children}
      </div>
    </li>
  );
}

export default function SpotifyAppGuide({ redirectUri, intro, existingClientId = '', onSaved, onCancel }) {
  const [clientId, setClientId] = useState(existingClientId);
  const [clientSecret, setClientSecret] = useState('');
  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const copyRedirectUri = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* sin permiso de portapapeles: la dirección queda seleccionable para copiarla a mano */ }
  };

  const save = async (event) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`${backendUrl()}/api/spotify/app`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ clientId, clientSecret }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'No se pudo guardar la app.');
      setClientSecret('');
      onSaved?.();
    } catch (err) {
      setError(err.message || 'No se pudo guardar la app.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="theme-heading text-lg font-semibold">Crea tu propia app de Spotify</h2>
        <p className="text-[11px] text-gray-400 mt-1 leading-snug">{intro}</p>
        <p className="text-[11px] text-gray-400 mt-1 leading-snug">
          Es gratis, toma unos 5 minutos y necesitas <span className="font-bold text-white">Spotify Premium</span>. Si un nombre no coincide exactamente con lo que ves, busca el más parecido: Spotify puede mostrarlo en tu idioma.
        </p>
      </div>

      <ol className="flex flex-col gap-2 list-none p-0 m-0">
        <Step n={1} title="Entra al dashboard de Spotify">
          <p>
            Abre{' '}
            <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline font-bold text-white">developer.spotify.com/dashboard</a>
            {' '}con tu cuenta de Spotify Premium y acepta los términos de desarrollador si te los pide.
          </p>
        </Step>
        <Step n={2} title="Crea la app">
          <p>
            Pulsa <span className="font-bold text-white">Create app</span>. Escribe el nombre y la descripción que quieras (por ejemplo, "Pedidos de canciones") y acepta los términos.
            Si te pregunta qué API vas a usar, marca <span className="font-bold text-white">Web API</span>.
          </p>
        </Step>
        <Step n={3} title="Agrega el Redirect URI">
          <p>
            En los ajustes de tu app (<span className="font-bold text-white">Settings</span> o <span className="font-bold text-white">Edit Settings</span>) busca{' '}
            <span className="font-bold text-white">Redirect URIs</span>, pega exactamente esta dirección, pulsa <span className="font-bold text-white">Add</span> y luego{' '}
            <span className="font-bold text-white">Save</span>. Tiene que ser idéntica: sin espacios y sin barra al final.
          </p>
          <div className="flex items-center gap-2 mt-2">
            <code className="theme-input flex-1 px-3 py-2 text-[11px] text-green-300 break-all select-all">{redirectUri}</code>
            <button type="button" onClick={copyRedirectUri} className="theme-btn-primary theme-btn-md font-bold whitespace-nowrap">
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </Step>
        <Step n={4} title="Agrégate como usuario">
          <p>
            En <span className="font-bold text-white">Settings</span> abre <span className="font-bold text-white">User Management</span>, pulsa{' '}
            <span className="font-bold text-white">Add new user</span> y escribe tu nombre y el correo de tu cuenta de Spotify. Una app nueva solo funciona para los usuarios que figuran ahí, incluido tú.
          </p>
        </Step>
        <Step n={5} title="Copia tus credenciales">
          <p>
            En <span className="font-bold text-white">Settings</span> copia el <span className="font-bold text-white">Client ID</span> y pulsa{' '}
            <span className="font-bold text-white">View client secret</span> para copiar el <span className="font-bold text-white">Client secret</span>. Pégalos aquí abajo.
          </p>
        </Step>
      </ol>

      <form onSubmit={save} className="flex flex-col gap-3">
        <div>
          <label htmlFor="spotify-client-id" className="theme-label block text-[10px] mb-2">Client ID</label>
          <input
            id="spotify-client-id"
            value={clientId}
            onChange={(event) => setClientId(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder="Pega tu Client ID"
            className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm"
          />
        </div>
        <div>
          <label htmlFor="spotify-client-secret" className="theme-label block text-[10px] mb-2">Client secret</label>
          <div className="flex items-center gap-2">
            <input
              id="spotify-client-secret"
              type={showSecret ? 'text' : 'password'}
              value={clientSecret}
              onChange={(event) => setClientSecret(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="Pega tu Client secret"
              className="theme-input flex-1 min-w-0 p-3 outline-none transition-all placeholder-gray-600 font-bold text-sm"
            />
            <button
              type="button"
              onClick={() => setShowSecret((visible) => !visible)}
              aria-pressed={showSecret}
              aria-label={showSecret ? 'Ocultar el Client secret' : 'Mostrar el Client secret'}
              className="theme-btn-secondary theme-btn-md font-black uppercase tracking-widest flex-shrink-0"
            >
              {showSecret ? '🙈' : '👁️'}
            </button>
          </div>
        </div>
        <p className="text-[10px] text-gray-500 leading-snug">
          El Client secret funciona como una contraseña de tu app: solo se usa para conectar tu Spotify, se guarda cifrado y nunca se vuelve a mostrar.
        </p>
        {error && <p role="alert" className="theme-notice">{error}</p>}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={saving || !clientId.trim() || !clientSecret.trim()}
            className="theme-btn-primary theme-btn-lg flex-1 font-bold tracking-wide transition-all shadow-lg disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? 'Verificando con Spotify...' : 'Verificar y guardar'}
          </button>
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={saving} className="theme-btn-secondary theme-btn-md font-black uppercase tracking-widest disabled:opacity-40">
              Cancelar
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
