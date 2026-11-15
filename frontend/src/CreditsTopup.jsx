import { useState, useRef } from 'react';
import StripePaymentForm from './StripePaymentForm';
import {
  CREDITS_PER_USD, TOPUP_PRESETS_USD, creditsForUsdCents, parseUsdInput, topupAmountError, formatUsd, formatCredits,
} from './credits';

// Recarga de créditos en Membresía (ver backend/lib/credits.js): pago único,
// no membresía. El comprador elige cuántos dólares; el formulario de Stripe
// cobra en USD y a la cuenta le llegan pesos (Stripe convierte solo). Los
// créditos los suma el servidor con lo que Stripe cobró.
// `onOpenPolicy` abre la política de reembolsos (el modal vive en Membresía).
// `onPaying(true|false)` avisa cuando el formulario está abierto, para que
// Membresía esconda lo demás como con la compra de un plan.
export default function CreditsTopup({ balance, onPaid, onOpenPolicy, onPaying }) {
  const [amountText, setAmountText] = useState('5');
  const [paying, setPaying] = useState(false);
  const [policyAcceptedAt, setPolicyAcceptedAt] = useState(null);
  const [policyError, setPolicyError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [done, setDone] = useState(null);
  const policyRef = useRef(null);
  const amountRef = useRef(null);

  const usdCents = parseUsdInput(amountText);
  const validationError = topupAmountError(usdCents);
  const previewCredits = validationError ? null : creditsForUsdCents(usdCents);

  const setPaymentOpen = (open) => {
    setPaying(open);
    onPaying?.(open);
  };

  const startPayment = () => {
    setDone(null);
    if (validationError) {
      setAmountError(validationError);
      amountRef.current?.focus();
      return;
    }
    setPaymentOpen(true);
  };

  const handleSuccess = async () => {
    setDone({ credits: previewCredits, usdCents });
    setPaymentOpen(false);
    setPolicyAcceptedAt(null);
    await onPaid?.();
  };

  if (paying) {
    return (
      <section className="w-full max-w-3xl flex flex-col gap-3" aria-labelledby="credits-paying-title">
        <div className="sticky top-0 z-20 theme-surface-featured px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p id="credits-paying-title" className="theme-label tkc-label">Recarga de créditos</p>
            <p className="text-sm font-black truncate">{formatCredits(previewCredits)} créditos · {formatUsd(usdCents)} (pago único)</p>
          </div>
          <button type="button" onClick={() => setPaymentOpen(false)} className="theme-btn-secondary theme-btn-sm font-black uppercase tracking-widest flex-shrink-0">
            Cambiar monto
          </button>
        </div>

        <p className="theme-notice theme-notice-warning">
          Se cobra {formatUsd(usdCents)} una sola vez, en dólares. Si tu tarjeta es en pesos, tu banco hace la conversión. No es una suscripción: no se vuelve a cobrar.
        </p>

        <div>
          <label className="flex items-start gap-2 text-xs text-gray-400 cursor-pointer">
            <input
              ref={policyRef}
              type="checkbox"
              checked={!!policyAcceptedAt}
              onChange={(e) => {
                setPolicyAcceptedAt(e.target.checked ? new Date().toISOString() : null);
                if (policyError) setPolicyError('');
              }}
              className="mt-0.5 flex-shrink-0"
            />
            <span>
              Acepto la{' '}
              <button type="button" onClick={(e) => { e.preventDefault(); onOpenPolicy?.(); }} className="underline font-bold text-gray-300 hover:text-white">
                política de reembolsos
              </button>
              {' '}(todas las ventas son finales: los créditos no se devuelven ni se cambian por dinero).
            </span>
          </label>
          {policyError && <p className="text-xs font-bold text-red-500 mt-1">{policyError}</p>}
        </div>

        {policyAcceptedAt ? (
          <StripePaymentForm
            creditsUsdCents={usdCents}
            policyAcceptedAt={policyAcceptedAt}
            onSuccess={handleSuccess}
            onCancel={() => setPaymentOpen(false)}
          />
        ) : (
          <button type="button"
            onClick={() => { setPolicyError('Acepta la política de reembolsos para continuar.'); policyRef.current?.focus(); }}
            className="theme-btn-primary theme-btn-md w-full font-black tracking-widest uppercase transition-all">
            Continuar con el pago
          </button>
        )}
      </section>
    );
  }

  return (
    <section className="w-full max-w-3xl" aria-labelledby="credits-title">
      <h2 id="credits-title" className="tkc-label theme-label mb-2">Créditos</h2>
      <div className="theme-surface p-4 flex flex-col gap-4">
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <p className="tkc-label">Tu saldo</p>
            <p className="text-2xl font-black tabular-nums mt-0.5">{formatCredits(balance)} créditos</p>
          </div>
          <p className="tkc-hint max-w-xs">
            Recarga lo que quieras: cada US$5 son 100 créditos ({CREDITS_PER_USD} por dólar). Pronto podrás usarlos dentro de la plataforma.
          </p>
        </div>

        {done && (
          <p role="status" className="theme-notice">
            Listo: se sumaron {formatCredits(done.credits)} créditos por {formatUsd(done.usdCents)}.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <label htmlFor="credits-amount" className="theme-label tkc-label">Monto a recargar (USD)</label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Montos rápidos">
            {TOPUP_PRESETS_USD.map((usd) => (
              <button key={usd} type="button"
                onClick={() => { setAmountText(String(usd)); setAmountError(''); }}
                aria-pressed={usdCents === usd * 100}
                className={`${usdCents === usd * 100 ? 'theme-btn-primary' : 'theme-btn-secondary'} theme-btn-sm font-black tabular-nums`}>
                US${usd}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative sm:w-48">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-500" aria-hidden="true">US$</span>
              <input
                ref={amountRef}
                id="credits-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amountText}
                onChange={(e) => { setAmountText(e.target.value); setAmountError(''); }}
                aria-invalid={!!amountError}
                aria-describedby="credits-preview"
                className="theme-input w-full p-3 pl-12 outline-none font-bold text-sm tabular-nums"
              />
            </div>
            <p id="credits-preview" className="text-sm font-bold tabular-nums" aria-live="polite">
              {previewCredits !== null ? `Recibes ${formatCredits(previewCredits)} créditos` : 'Escribe un monto entre US$1 y US$500'}
            </p>
          </div>
          {amountError && <p role="alert" className="text-xs font-bold text-red-500">{amountError}</p>}
          <p className="tkc-hint">Pago único en dólares. Los créditos se redondean al número entero más cercano.</p>
        </div>

        <button type="button" onClick={startPayment}
          className="theme-btn-primary theme-btn-md self-start font-black uppercase tracking-widest">
          Recargar créditos
        </button>
      </div>
    </section>
  );
}
