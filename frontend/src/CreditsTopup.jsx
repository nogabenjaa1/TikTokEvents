import { useState, useRef } from 'react';
import StripePaymentForm from './StripePaymentForm';
import {
  topupPresets, CURRENCY_STORAGE_KEY, creditsForMxnCents, toMxnCents, fromMxnCents, parseAmountInput, topupAmountError,
  formatMoney, convertInput, formatCredits,
} from './credits';

const CURRENCIES = [
  { id: 'mxn', label: 'MXN' },
  { id: 'usd', label: 'USD' },
];
const other = (currency) => (currency === 'usd' ? 'mxn' : 'usd');

// La moneda en que el comprador prefiere ver el monto (solo una comodidad de
// este navegador; puede no haber almacenamiento).
function loadCurrency() {
  try {
    return window.localStorage.getItem(CURRENCY_STORAGE_KEY) === 'usd' ? 'usd' : 'mxn';
  } catch {
    return 'mxn';
  }
}
function saveCurrency(currency) {
  try { window.localStorage.setItem(CURRENCY_STORAGE_KEY, currency); } catch { /* sin almacenamiento */ }
}

// Recarga de créditos en Membresía (ver backend/lib/credits.js): pago único,
// no membresía. Se cobra SIEMPRE en pesos; el comprador elige si escribe y ve
// el monto en pesos (lo predeterminado) o en dólares, con la otra moneda
// abajo como conversión. `rate` = centavos de MXN por dólar (del panel de
// Licencias, vía /api/pricing). Los créditos los suma el servidor.
// `onOpenPolicy` abre la política de reembolsos (el modal vive en Membresía).
// `onPaying(true|false)` avisa cuando el formulario está abierto, para que
// Membresía esconda lo demás como con la compra de un plan.
export default function CreditsTopup({ balance, rate, onPaid, onOpenPolicy, onPaying }) {
  const [currency, setCurrency] = useState(loadCurrency);
  // Arranca en US$5 (100 créditos), en la moneda elegida.
  const [amountText, setAmountText] = useState(() => String(topupPresets(loadCurrency(), rate)[1]));
  const [paying, setPaying] = useState(false);
  const [policyAcceptedAt, setPolicyAcceptedAt] = useState(null);
  const [policyError, setPolicyError] = useState('');
  const [amountError, setAmountError] = useState('');
  const [done, setDone] = useState(null);
  const policyRef = useRef(null);
  const amountRef = useRef(null);

  const amountCents = parseAmountInput(amountText);
  const validationError = topupAmountError(amountCents, currency, rate);
  const mxnCents = validationError ? null : toMxnCents(amountCents, currency, rate);
  const previewCredits = mxnCents === null ? null : creditsForMxnCents(mxnCents, rate);
  // El monto en la moneda elegida (grande) y su conversión (abajo).
  const mainText = mxnCents === null ? '' : formatMoney(fromMxnCents(mxnCents, currency, rate), currency);
  const otherText = mxnCents === null ? '' : `≈ ${formatMoney(fromMxnCents(mxnCents, other(currency), rate), other(currency))}`;
  const chargedText = mxnCents === null ? '' : formatMoney(mxnCents, 'mxn');

  const changeCurrency = (next) => {
    if (next === currency) return;
    setAmountText((text) => convertInput(text, currency, next, rate));
    setCurrency(next);
    saveCurrency(next);
    setAmountError('');
  };

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
    setDone({ credits: previewCredits, mainText, chargedText });
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
            <p className="text-sm font-black truncate">{formatCredits(previewCredits)} créditos · {mainText} (pago único)</p>
            <p className="tkc-hint truncate">{otherText}</p>
          </div>
          <button type="button" onClick={() => setPaymentOpen(false)} className="theme-btn-secondary theme-btn-sm font-black uppercase tracking-widest flex-shrink-0">
            Cambiar monto
          </button>
        </div>

        <p className="theme-notice theme-notice-warning">
          Se cobra {chargedText} una sola vez, en pesos mexicanos{currency === 'usd' ? ` (tus ${mainText} al tipo de cambio de hoy)` : ''}. No es una suscripción: no se vuelve a cobrar.
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
            credits={{ amountCents, currency }}
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

  const presets = topupPresets(currency, rate);
  const fiveUsdInMxn = formatMoney(toMxnCents(500, 'usd', rate), 'mxn');

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
            Recarga lo que quieras: cada {currency === 'usd' ? `US$5 (${fiveUsdInMxn})` : `${fiveUsdInMxn} (US$5)`} son 100 créditos. Pronto podrás usarlos dentro de la plataforma.
          </p>
        </div>

        {done && (
          <p role="status" className="theme-notice">
            Listo: se sumaron {formatCredits(done.credits)} créditos por {done.mainText}.
          </p>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <label htmlFor="credits-amount" className="theme-label tkc-label">Monto a recargar</label>
            {/* Solo cambia cómo se ve y se escribe el monto: el cobro es en pesos. */}
            <div className="inline-flex rounded-full theme-chip p-0.5" role="group" aria-label="Moneda para ver el monto">
              {CURRENCIES.map((c) => (
                <button key={c.id} type="button" onClick={() => changeCurrency(c.id)} aria-pressed={currency === c.id}
                  className={`px-3 py-1 rounded-full text-[11px] font-black tracking-widest transition-colors ${currency === c.id ? 'theme-btn-primary' : 'text-gray-400 hover:text-white'}`}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Montos rápidos">
            {presets.map((value) => (
              <button key={value} type="button"
                onClick={() => { setAmountText(String(value)); setAmountError(''); }}
                aria-pressed={amountCents === value * 100}
                className={`${amountCents === value * 100 ? 'theme-btn-primary' : 'theme-btn-secondary'} theme-btn-sm font-black tabular-nums`}>
                {formatMoney(value * 100, currency)}
              </button>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative sm:w-48">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-gray-500" aria-hidden="true">{currency === 'usd' ? 'US$' : 'MX$'}</span>
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
            <div id="credits-preview" aria-live="polite">
              {previewCredits !== null ? (
                <>
                  <p className="text-sm font-bold tabular-nums">Recibes {formatCredits(previewCredits)} créditos</p>
                  <p className="tkc-hint tabular-nums">{otherText}</p>
                </>
              ) : (
                <p className="text-sm font-bold">{validationError}</p>
              )}
            </div>
          </div>
          {amountError && <p role="alert" className="text-xs font-bold text-red-500">{amountError}</p>}
          <p className="tkc-hint">
            Pago único. Se cobra en pesos mexicanos{currency === 'usd' ? `; el dólar se convierte a MX$${(rate / 100).toLocaleString('es-MX')}` : ''}. Los créditos se redondean al número entero más cercano.
          </p>
        </div>

        <button type="button" onClick={startPayment}
          className="theme-btn-primary theme-btn-md self-start font-black uppercase tracking-widest">
          Recargar créditos
        </button>
      </div>
    </section>
  );
}
