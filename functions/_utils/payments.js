// functions/_utils/payments.js
// Онлайн-оплата: LiqPay + Monobank Acquiring.
// LiqPay  — формуємо data+signature, клієнт POST-form на checkout, статус приходить на server_url (webhook).
// Monobank — створюємо invoice через API, редіректимо на pageUrl, статус підтверджуємо re-fetch'ем.

// ---- base64 helpers (utf-8 safe) ----
function b64encodeStr(str) {
  // btoa працює з latin1 — кодуємо utf-8 вручну
  return btoa(unescape(encodeURIComponent(str)));
}
function b64decodeStr(b64) {
  return decodeURIComponent(escape(atob(b64)));
}
function b64fromBytes(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

// ====================== LiqPay ======================
// signature = base64( sha1( private_key + data + private_key ) ), data — base64(JSON params)
export async function liqpaySign(privateKey, dataB64) {
  const buf = new TextEncoder().encode(privateKey + dataB64 + privateKey);
  const hash = await crypto.subtle.digest('SHA-1', buf);
  return b64fromBytes(new Uint8Array(hash));
}

// Будуємо параметри для checkout-форми
export async function liqpayBuildCheckout(settings, { orderId, amount, description, resultUrl, serverUrl }) {
  const params = {
    public_key: settings.payLiqpayPublicKey,
    version: '3',
    action: 'pay',
    amount: Number(amount).toFixed(2),
    currency: 'UAH',
    description: description || ('Замовлення #' + orderId),
    order_id: String(orderId),
    result_url: resultUrl,
    server_url: serverUrl,
    sandbox: settings.payTestMode ? '1' : '0',
  };
  const data = b64encodeStr(JSON.stringify(params));
  const signature = await liqpaySign(settings.payLiqpayPrivateKey, data);
  return {
    type: 'form',
    action: 'https://www.liqpay.ua/api/3/checkout',
    fields: { data, signature },
  };
}

export function liqpayDecode(dataB64) {
  try { return JSON.parse(b64decodeStr(dataB64)); } catch { return null; }
}

// Перевірка підпису callback'а від LiqPay
export async function liqpayVerify(privateKey, dataB64, signature) {
  const expected = await liqpaySign(privateKey, dataB64);
  return expected === signature;
}

// ====================== Monobank ======================
// Створюємо invoice: amount у копійках (ціле), ccy 980 (UAH), reference = orderId
export async function monoCreateInvoice(settings, { orderId, amount, description, redirectUrl, webHookUrl }) {
  const body = {
    amount: Math.round(Number(amount) * 100),
    ccy: 980,
    merchantPaymInfo: {
      reference: String(orderId),
      destination: description || ('Замовлення #' + orderId),
    },
    redirectUrl,
    webHookUrl,
    validity: 3600,
  };
  const res = await fetch('https://api.monobank.ua/api/merchant/invoice/create', {
    method: 'POST',
    headers: { 'X-Token': settings.payMonoToken, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let d = {};
  try { d = await res.json(); } catch {}
  if (!res.ok || !d.invoiceId) {
    throw new Error(d.errText || d.errorDescription || ('Monobank HTTP ' + res.status));
  }
  return { type: 'redirect', url: d.pageUrl, invoiceId: d.invoiceId };
}

// Перевірка реального статусу invoice (безпечніше за webhook-підпис)
export async function monoInvoiceStatus(settings, invoiceId) {
  const res = await fetch(
    'https://api.monobank.ua/api/merchant/invoice/status?invoiceId=' + encodeURIComponent(invoiceId),
    { headers: { 'X-Token': settings.payMonoToken } },
  );
  let d = {};
  try { d = await res.json(); } catch {}
  return d; // { invoiceId, status, amount, ccy, reference, ... }
}

// ====================== Спільне: позначити замовлення оплаченим ======================
import { getOrder, updateOrder, getProducts, getBotConfig, escapeMd } from './shop.js';

// Знаходить замовлення за orderId (через індекс payidx_<id>), ідемпотентно позначає оплаченим,
// списує склад/лічильник продажів і шле підтвердження в Telegram.
// Повертає { ok, already, order } або { ok:false, reason }.
export async function markOrderPaid(env, orderId, info = {}) {
  if (!env.SHOP_KV) return { ok: false, reason: 'no_kv' };
  let kvKey = null;
  try { kvKey = await env.SHOP_KV.get('payidx_' + orderId); } catch {}
  if (!kvKey) return { ok: false, reason: 'order_not_found' };
  const order = await getOrder(env, kvKey);
  if (!order) return { ok: false, reason: 'order_missing' };
  if (order.paid || order.paymentStatus === 'paid') {
    return { ok: true, already: true, order };
  }

  // Списуємо склад / лічильник продажів (робимо тут, бо при створенні онлайн-замовлення пропустили)
  try {
    const products = await getProducts(env);
    let changed = false;
    for (const it of (order.items || [])) {
      const p = products.find(p => p.id === it.productId);
      if (p) {
        p.soldCount = (parseInt(p.soldCount) || 0) + (it.quantity || 1);
        if (p.showStock) {
          const cur = Number.isFinite(p.stock) ? p.stock : 0;
          p.stock = Math.max(0, cur - (it.quantity || 1));
        }
        changed = true;
      }
    }
    if (changed) await env.SHOP_KV.put('products', JSON.stringify(products));
  } catch (e) { /* не критично */ }

  const updated = await updateOrder(env, kvKey, {
    paid: true,
    paymentStatus: 'paid',
    paidAt: new Date().toISOString(),
    paymentProvider: info.provider || order.paymentProvider || '',
    paymentInfo: info.detail || undefined,
  });

  // Підтвердження в Telegram
  try {
    const botCfg = await getBotConfig(env);
    if (botCfg.botToken && botCfg.chatId) {
      const prov = (info.provider || order.paymentProvider) === 'monobank' ? 'Monobank' : 'LiqPay';
      const text = `✅ *ОПЛАЧЕНО* \`#${orderId}\`\n💳 ${escapeMd(prov)}${info.test ? ' _(тест)_' : ''}\n💰 *${order.totalPrice} ₴*\n👤 ${escapeMd(order.customerName || '—')}`;
      await fetch(`https://api.telegram.org/bot${botCfg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: botCfg.chatId, text, parse_mode: 'Markdown' }),
      });
    }
  } catch (e) { /* не критично */ }

  return { ok: true, already: false, order: updated };
}
