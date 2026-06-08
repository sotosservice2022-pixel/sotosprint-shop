// POST /api/pay/mono-callback — webHookUrl для Monobank Acquiring.
// Monobank шле JSON { invoiceId, status, reference, ... }. Для безпеки не довіряємо тілу —
// перезапитуємо реальний статус invoice через API за нашим токеном.
import { getSettings } from '../../_utils/shop.js';
import { monoInvoiceStatus, markOrderPaid } from '../../_utils/payments.js';

export async function onRequestPost({ request, env }) {
  try {
    let body = {};
    try { body = await request.json(); } catch {}
    const invoiceId = body.invoiceId;
    if (!invoiceId) return new Response('bad request', { status: 400 });

    const settings = await getSettings(env);
    if (!settings.payMonoToken) return new Response('not configured', { status: 400 });

    // Перевіряємо реальний статус (захист від підробних webhook)
    const st = await monoInvoiceStatus(settings, invoiceId);
    const reference = body.reference || st.reference;

    if (reference && st.status === 'success') {
      await markOrderPaid(env, reference, {
        provider: 'monobank',
        test: !!settings.payTestMode,
        detail: { invoiceId, status: st.status },
      });
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    return new Response('error: ' + e.message, { status: 500 });
  }
}
