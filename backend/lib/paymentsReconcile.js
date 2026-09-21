// Conciliación de pagos: ¿todo lo que se cobró quedó registrado y aplicado?
// Solo lee y compara; nunca cambia nada por su cuenta (aplicar un pago pendiente
// lo decide el admin con un botón). Dos fuentes de problemas:
//   1. Pagos que este sitio intentó aplicar y no pudo (tabla payment_failures).
//   2. Cobros que Stripe da por buenos y el sitio no tiene registrados (por
//      ejemplo si el navegador se cerró y el aviso de Stripe nunca llegó).
// MercadoPago no permite listar sus órdenes con este tipo de credencial, así que
// para esa vía solo están los pagos fallidos que el propio sitio registró.

// Cobros de Stripe con éxito desde `sinceSec` que traen el id de una licencia de
// este sitio (metadata.licenseId), con paginación acotada.
async function listSucceededStripeIntents(stripe, { sinceSec, maxPages = 5 }) {
    const found = [];
    let startingAfter;
    for (let page = 0; page < maxPages; page++) {
        const res = await stripe.paymentIntents.list({
            limit: 100,
            created: { gte: sinceSec },
            ...(startingAfter ? { starting_after: startingAfter } : {}),
        });
        for (const intent of res.data || []) {
            if (intent.status === 'succeeded' && intent.metadata?.licenseId) found.push(intent);
        }
        if (!res.has_more || !res.data || res.data.length === 0) break;
        startingAfter = res.data[res.data.length - 1].id;
    }
    return found;
}

// Los cobros de Stripe que la tabla de pagos no tiene.
function findUnrecordedStripe(intents, knownIds) {
    return intents
        .filter((intent) => !knownIds.has(intent.id))
        .map((intent) => ({
            paymentIntentId: intent.id,
            licenseId: intent.metadata.licenseId,
            planType: intent.metadata.planType || null,
            diceTier: intent.metadata.diceTier || null,
            spotifyAddon: intent.metadata.spotifyAddon === 'true',
            amountCents: Number(intent.amount_received ?? intent.amount) || 0,
            createdAt: (Number(intent.created) || 0) * 1000,
        }));
}

// Resumen de pagos cuya licencia ya no existe (se eliminó): solo informativo,
// el historial de ingresos se conserva a propósito.
function summarizeWithoutLicense(rows) {
    return {
        count: rows.length,
        amountCents: rows.reduce((sum, row) => sum + (Number(row.amount_cents) || 0), 0),
        latest: rows.slice(0, 20).map((row) => ({
            provider: row.provider || 'mercadopago',
            licenseId: row.license_id,
            planType: row.plan_type,
            amountCents: Number(row.amount_cents) || 0,
            createdAt: Number(row.created_at) || 0,
        })),
    };
}

module.exports = { listSucceededStripeIntents, findUnrecordedStripe, summarizeWithoutLicense };
