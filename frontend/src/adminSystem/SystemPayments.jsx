import { useState } from 'react';
import { describePurchase, formatWhen, mxn, providerLabel, reasonLabel } from '../systemFormat';
import { adminRequest, useAdminData } from './api';
import { Badge, EmptyNote, PanelBar } from './ui';

const RANGES = [7, 14, 30];

// ¿Todo lo que se cobró quedó aplicado? Muestra los pagos que el sitio no pudo aplicar a la licencia (con un botón para
// aplicarlos), los cobros de Stripe que el sitio no tiene registrados y un resumen de los pagos de licencias que ya no
// existen. MercadoPago no permite listar sus cobros: solo se ven los que el propio sitio intentó aplicar y falló.
export default function SystemPayments({ onUnauthorized }) {
  const [days, setDays] = useState(7);
  const { data, error, loading, reload } = useAdminData(`/api/admin/payments/reconcile?days=${days}`, { onUnauthorized });
  const [busyId, setBusyId] = useState('');
  const [notice, setNotice] = useState(null);

  const report = data?.report;

  const run = async (id, request, doneText) => {
    setBusyId(id);
    setNotice(null);
    try {
      const result = await request();
      setNotice({ tone: 'success', text: typeof doneText === 'function' ? doneText(result) : doneText });
      await reload();
    } catch (err) {
      setNotice({ tone: 'danger', text: err.message });
    } finally {
      setBusyId('');
    }
  };

  const applyFailure = (failure) => {
    if (!window.confirm(`¿Aplicar este pago a @${failure.license}? Se activará: ${describePurchase(failure)}. Hazlo solo si confirmaste que el cobro se hizo.`)) return;
    run(failure.id, () => adminRequest(`/api/admin/payments/failures/${encodeURIComponent(failure.id)}/apply`, { method: 'POST', onUnauthorized }), 'Pago aplicado a la licencia.');
  };

  const applyStripe = (item) => {
    if (!window.confirm(`¿Registrar y aplicar el cobro de Stripe ${item.paymentIntentId} a @${item.license}? Se activará: ${describePurchase(item)}.`)) return;
    run(
      item.paymentIntentId,
      () => adminRequest('/api/admin/payments/stripe/apply', { method: 'POST', body: { paymentIntentId: item.paymentIntentId }, onUnauthorized }),
      (result) => (result.alreadyProcessed ? 'Ese cobro ya estaba registrado: no se aplicó dos veces.' : 'Cobro registrado y aplicado a la licencia.'),
    );
  };

  return (
    <section className="w-full max-w-3xl flex flex-col gap-5" aria-label="Conciliación de pagos">
      <PanelBar
        title="Conciliación de pagos" onRefresh={reload} loading={loading}
        hint="Revisa que todo lo que se cobró haya quedado aplicado. Solo lee: nada cambia hasta que pulses un botón."
      >
        <div className="flex gap-1.5" role="group" aria-label="Rango de días">
          {RANGES.map((value) => (
            <button
              key={value} type="button" onClick={() => setDays(value)} aria-pressed={days === value}
              className={`${days === value ? 'theme-btn-primary' : 'theme-btn-secondary'} theme-btn-sm font-black uppercase tracking-widest`}
            >
              {value} días
            </button>
          ))}
        </div>
      </PanelBar>

      {error && <p role="alert" className="theme-notice">{error}</p>}
      {notice && <p role="status" className={`theme-notice ${notice.tone === 'success' ? 'theme-notice-success' : ''}`}>{notice.text}</p>}
      {!report && !error && <p className="text-sm text-gray-500 italic">Cargando…</p>}

      {report && (
        <>
          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-black uppercase tracking-widest">Pagos cobrados que no se aplicaron ({report.failures.length})</h3>
            {report.failures.length === 0 && <EmptyNote>Todo al día: no hay pagos pendientes.</EmptyNote>}
            <ul className="flex flex-col gap-2">
              {report.failures.map((failure) => (
                <li key={failure.id} className="theme-surface p-4 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone="warning">{providerLabel(failure.provider)}</Badge>
                    <strong className="text-sm">{failure.license ? `@${failure.license}` : 'Licencia eliminada'}</strong>
                    <span className="text-xs text-gray-400">{describePurchase(failure)}</span>
                    <strong className="text-sm ml-auto">{mxn(failure.amountCents)}</strong>
                  </div>
                  <p className="text-[11px] text-gray-500">{reasonLabel(failure.reason)} · {formatWhen(failure.createdAt)}{failure.error ? ` · ${failure.error}` : ''}</p>
                  <p className="text-[10px] text-gray-500 break-all">ID del pago: {failure.paymentId}</p>
                  {failure.license ? (
                    <button
                      type="button" onClick={() => applyFailure(failure)} disabled={busyId === failure.id}
                      className="theme-btn-primary theme-btn-sm self-start font-black uppercase tracking-widest disabled:opacity-50"
                    >
                      {busyId === failure.id ? 'Aplicando…' : 'Aplicar pago'}
                    </button>
                  ) : (
                    <p className="text-[11px] text-gray-500">No se puede aplicar: la licencia de este pago ya no existe.</p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-black uppercase tracking-widest">Cobros de Stripe sin registrar ({report.stripe.unrecorded.length})</h3>
            {report.stripe.error && <p role="alert" className="theme-notice">{report.stripe.error}. Intenta de nuevo en un momento.</p>}
            {!report.stripe.available && !report.stripe.error && <EmptyNote>Stripe no está configurado en este servidor: no hay con qué comparar.</EmptyNote>}
            {report.stripe.available && report.stripe.unrecorded.length === 0 && (
              <EmptyNote>Stripe y este sitio coinciden en los últimos {report.days} días ({report.stripe.checked} cobros revisados).</EmptyNote>
            )}
            <ul className="flex flex-col gap-2">
              {report.stripe.unrecorded.map((item) => (
                <li key={item.paymentIntentId} className="theme-surface p-4 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Badge tone="danger">Stripe</Badge>
                    <strong className="text-sm">{item.license ? `@${item.license}` : 'Licencia eliminada'}</strong>
                    <span className="text-xs text-gray-400">{describePurchase(item)}</span>
                    <strong className="text-sm ml-auto">{mxn(item.amountCents)}</strong>
                  </div>
                  <p className="text-[11px] text-gray-500">Cobrado {formatWhen(item.createdAt)}. Stripe lo dio por bueno y este sitio no lo tiene registrado.</p>
                  <p className="text-[10px] text-gray-500 break-all">ID del cobro: {item.paymentIntentId}</p>
                  {item.license ? (
                    <button
                      type="button" onClick={() => applyStripe(item)} disabled={busyId === item.paymentIntentId}
                      className="theme-btn-primary theme-btn-sm self-start font-black uppercase tracking-widest disabled:opacity-50"
                    >
                      {busyId === item.paymentIntentId ? 'Aplicando…' : 'Registrar y aplicar'}
                    </button>
                  ) : (
                    <p className="text-[11px] text-gray-500">No se puede aplicar: la licencia de este cobro ya no existe.</p>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="theme-surface p-4 text-xs text-gray-400 leading-relaxed space-y-2">
            <p><span className="font-bold text-white">MercadoPago:</span> no permite listar sus cobros con esta conexión. Aquí solo aparecen los que el sitio intentó aplicar y no pudo.</p>
            <p>
              <span className="font-bold text-white">Pagos de licencias eliminadas:</span>{' '}
              {report.withoutLicense.count === 0
                ? 'ninguno.'
                : `${report.withoutLicense.count} por ${mxn(report.withoutLicense.amountCents)}. Se conservan a propósito: son parte de tus ingresos.`}
            </p>
            {report.withoutLicense.latest.length > 0 && (
              <details>
                <summary className="cursor-pointer font-bold">Ver los más recientes</summary>
                <ul className="mt-2 flex flex-col gap-1">
                  {report.withoutLicense.latest.map((item, index) => (
                    <li key={`${item.licenseId}-${item.createdAt}-${index}`} className="flex flex-wrap justify-between gap-2">
                      <span>{providerLabel(item.provider === 'mercadopago' ? 'mp' : item.provider)} · {describePurchase({ planType: item.planType })}</span>
                      <span>{mxn(item.amountCents)} · {formatWhen(item.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </>
      )}
    </section>
  );
}
