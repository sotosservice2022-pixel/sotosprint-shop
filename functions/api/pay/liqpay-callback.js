// POST /api/pay/liqpay-callback — server_url для LiqPay.
// LiqPay шле form-data { data, signature }. Перевіряємо підпис, декодуємо статус, позначаємо оплату.
import { getSettings } from '../../_utils/shop.js';
import { liqpayVerify, liqpayDecode, markOrderPaid } from '../../_utils/payments.js';

export async function onRequestPost({ request, env }) {
  try {
    const form = await request.formData();
    const data = (form.get('data') || '').toString();
    const signature = (form.get('signature') || '').toString();
    if (!data || !signature) return new Response('bad request', { status: 400 });

    const settings = await getSettings(env);
    if (!settings.payLiqpayPrivateKey) return new Response('not configured', { status: 400 });

    // Перевірка підпису — захист від підробки
    const valid = await liqpayVerify(settings.payLiqpayPrivateKey, data, signature);
    if (!valid) return new Response('invalid signature', { status: 403 });

    const payload = liqpayDecode(data);
    if (!payload) return new Response('bad data', { status: 400 });

    const orderId = payload.order_id;
    const status = payload.status;
    // success — реальна оплата; sandbox — тестова. Обидва вважаємо оплаченими.
    if (orderId && (status === 'success' || status === 'sandbox')) {
      await markOrderPaid(env, orderId, {
        provider: 'liqpay',
        test: status === 'sandbox',
        detail: { status, payment_id: payload.payment_id },
      });
    }
    return new Response('ok', { status: 200 });
  } catch (e) {
    // 500 — LiqPay повторить спробу пізніше
    return new Response('error: ' + e.message, { status: 500 });
  }
}
