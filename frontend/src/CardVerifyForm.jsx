import React, { useEffect, useRef, useState } from 'react';
import { requestFreeTrial } from './auth';

const MP_SDK_SRC = 'https://sdk.mercadopago.com/js/v2';

// Mismo patrón de "inyectar un <script> externo una vez" que ya usa
// NativeAdBanner.jsx para Adsterra — acá con el SDK de MercadoPago, cargado
// recién cuando alguien elige esta vía (no en cada carga de la app).
function loadMercadoPagoSdk() {
  if (window.MercadoPago) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${MP_SDK_SRC}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = MP_SDK_SRC;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

// Verifica una tarjeta real para desbloquear la prueba gratis sin ver
// anuncios — a propósito NO cobra ni guarda la tarjeta (ver el comentario
// en backend/server.js, ruta /api/free-trial). Usa Secure Fields de
// MercadoPago: número/vencimiento/CVV viven en iframes de MercadoPago que
// nunca tocan nuestro JS ni nuestro backend — por eso los tres campos
// sensibles no se pueden pintar con las clases del sistema de temas (viven
// en otro documento), solo el contenedor y el nombre del titular sí llevan
// theme-input.
//
// Al validar, llama a onResult({ key, token, license }) — el mismo shape
// que ya maneja Login.jsx para el camino de anuncios (trialResult), así la
// pantalla de "guarda tu clave" es una sola, compartida entre las tres vías.
export default function CardVerifyForm({ onResult, onCancel }) {
  const [sdkState, setSdkState] = useState('loading'); // loading | ready | error | no-key
  const [alias, setAlias] = useState('');
  const [cardholderName, setCardholderName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const mpRef = useRef(null);
  const mountedFieldsRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadMercadoPagoSdk()
      .then(() => { if (!cancelled) setSdkState('ready'); })
      .catch(() => { if (!cancelled) setSdkState('error'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (sdkState !== 'ready' || mountedFieldsRef.current) return;
    const publicKey = import.meta.env.VITE_MP_PUBLIC_KEY;
    if (!publicKey) { setSdkState('no-key'); return; }
    mountedFieldsRef.current = true;
    const mp = new window.MercadoPago(publicKey, { locale: 'es-MX' });
    mpRef.current = mp;
    // Color fijo, no un token del tema: estos campos se pintan dentro de un
    // iframe de MercadoPago (otro documento), que no tiene acceso a las
    // variables CSS de esta página.
    const style = { color: '#1f2937', fontSize: '14px', placeholderColor: '#9ca3af' };
    mp.fields.create('cardNumber', { placeholder: 'Número de tarjeta', style }).mount('cvf-card-number');
    mp.fields.create('expirationDate', { placeholder: 'MM/AA', style }).mount('cvf-expiration-date');
    mp.fields.create('securityCode', { placeholder: 'CVV', style }).mount('cvf-security-code');
  }, [sdkState]);

  const submit = async (e) => {
    e.preventDefault();
    if (submitting || !alias.trim() || !cardholderName.trim() || !mpRef.current) return;
    setSubmitting(true);
    setError('');
    try {
      const { id: cardToken } = await mpRef.current.fields.createCardToken({ cardholderName: cardholderName.trim() });
      const result = await requestFreeTrial(alias.trim(), cardToken);
      onResult(result);
    } catch (err) {
      setError(err.message || 'No se pudo verificar la tarjeta. Revisa los datos e intenta de nuevo.');
    } finally {
      setSubmitting(false);
    }
  };

  if (sdkState === 'error' || sdkState === 'no-key') {
    return (
      <div className="flex flex-col gap-3">
        <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">
          {sdkState === 'no-key'
            ? 'Esta opción todavía no está configurada (falta la Public Key de MercadoPago). Prueba con otra vía.'
            : 'No se pudo cargar el formulario de tarjeta. Revisa tu conexión o intenta más tarde.'}
        </p>
        <button type="button" onClick={onCancel} className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all">
          Volver
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <p className="theme-label text-xs uppercase tracking-widest font-semibold">Verificar tarjeta</p>
      <p className="text-[11px] text-gray-500">
        No se te cobra ni se guarda tu tarjeta — solo se verifica que sea real, como alternativa a ver anuncios.
      </p>

      <input
        value={alias}
        onChange={e => setAlias(e.target.value)}
        placeholder="Elige un alias"
        className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-white text-sm"
      />
      <input
        value={cardholderName}
        onChange={e => setCardholderName(e.target.value)}
        placeholder="Nombre del titular"
        className="theme-input w-full p-3 outline-none transition-all placeholder-gray-600 font-bold text-white text-sm"
      />
      <div id="cvf-card-number" className="theme-input w-full p-3 h-11" />
      <div className="flex gap-2">
        <div id="cvf-expiration-date" className="theme-input flex-1 p-3 h-11" />
        <div id="cvf-security-code" className="theme-input flex-1 p-3 h-11" />
      </div>

      {sdkState === 'loading' && <p className="text-[10px] text-gray-500 text-center">Cargando formulario seguro de MercadoPago...</p>}
      {error && <p className="bg-red-500/10 border border-red-500/40 text-red-700 rounded-lg px-3 py-2 text-xs font-bold">{error}</p>}

      <button
        type="submit"
        disabled={submitting || sdkState !== 'ready' || !alias.trim() || !cardholderName.trim()}
        className="theme-btn-secondary w-full py-3 rounded-xl font-black tracking-widest uppercase text-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {submitting ? 'VERIFICANDO...' : 'Verificar y activar prueba gratis'}
      </button>
      <button type="button" onClick={onCancel} className="theme-btn-secondary w-full py-2 rounded-xl font-bold uppercase text-[10px] tracking-widest transition-all">
        Cancelar
      </button>
    </form>
  );
}
