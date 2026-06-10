// POST /api/track  { orderId, phone } — публічне відстеження замовлення клієнтом.
// Безпека: щоб дізнатись статус, треба знати І номер замовлення, І телефон (останні 4 цифри
// мають збігтися). Це блокує перебір чужих замовлень. Віддаємо лише безпечні поля
// (без фото, без повного телефону, без коментарів — мінімум для статусу).
//
// Якщо в адмінці вписано ТТН Нова Пошта — додатково тягнемо реальний статус посилки
// через TrackingDocument API НП.
import { getSettings, listOrders, jsonResp } from '../_utils/shop.js';

// Мапа статусів замовлення (наша внутрішня) → текст для клієнта
function orderStatusText(o) {
  if (o.isDone) return { code: 'done', label: '✅ Готове / відправлено' };
  return { code: 'processing', label: '⏳ В обробці' };
}

// Запит статусу посилки в Нова Пошта по ТТН
async function fetchNpStatus(apiKey, ttn, phone) {
  try {
    const r = await fetch('https://api.novaposhta.ua/v2.0/json/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiKey,
        modelName: 'TrackingDocument',
        calledMethod: 'getStatusDocuments',
        methodProperties: { Documents: [{ DocumentNumber: ttn, Phone: phone || '' }] },
      }),
    });
    const data = await r.json();
    if (!data.success || !Array.isArray(data.data) || !data.data[0]) return null;
    const d = data.data[0];
    return {
      status: d.Status || '',
      statusCode: d.StatusCode || '',
      city: d.CityRecipient || d.WarehouseRecipient || '',
      warehouse: d.WarehouseRecipient || '',
      // дата фактичної доставки/прибуття якщо є
      actualDelivery: d.ActualDeliveryDate || d.RecipientDateTime || '',
    };
  } catch (_) {
    return null;
  }
}

export async function onRequestPost({ request, env }) {
  let s;
  try { s = await getSettings(env); } catch { return jsonResp({ ok: false, error: 'Помилка налаштувань' }, 500); }

  // Фіча вимкнена в адмінці — ендпоінт ніби не існує
  if (!s || s.orderTrackingEnabled !== true) {
    return jsonResp({ ok: false, error: 'Not found' }, 404);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний запит' }, 400); }

  const orderId = String(body.orderId || '').replace(/\D/g, '');
  const phoneDigits = String(body.phone || '').replace(/\D/g, '');

  if (!orderId) return jsonResp({ ok: false, error: 'Вкажіть номер замовлення' }, 400);
  if (phoneDigits.length < 4) return jsonResp({ ok: false, error: 'Вкажіть номер телефону' }, 400);

  // Шукаємо замовлення за id (id у нас — інкрементне число-рядок)
  const orders = await listOrders(env, 1000);
  const order = orders.find(o => String(o.id) === orderId);

  // Єдине повідомлення і коли не знайдено, і коли телефон не збігся —
  // щоб не можна було вгадати, які номери замовлень існують.
  const notFound = () => jsonResp({ ok: false, error: 'Замовлення не знайдено. Перевірте номер замовлення і телефон.' }, 404);
  if (!order) return notFound();

  const orderPhoneDigits = String(order.phone || '').replace(/\D/g, '');
  // Звіряємо останні 4 цифри (клієнт міг ввести з кодом країни або без)
  if (!orderPhoneDigits || orderPhoneDigits.slice(-4) !== phoneDigits.slice(-4)) {
    return notFound();
  }

  const status = orderStatusText(order);

  // Безпечна відповідь — мінімум даних
  const safe = {
    id: order.id,
    createdAt: order.createdAt || null,
    status: status.code,
    statusLabel: status.label,
    totalPrice: order.totalPrice ?? null,
    delivery: order.delivery || '',
    itemsCount: Array.isArray(order.items) ? order.items.reduce((n, it) => n + (parseInt(it.quantity, 10) || 1), 0) : null,
    hasTtn: !!order.ttn,
  };

  // Якщо є ТТН і налаштована НП — додаємо статус посилки
  if (order.ttn && s.npApiKey) {
    const np = await fetchNpStatus(String(s.npApiKey).trim(), String(order.ttn), order.phone || '');
    if (np) {
      safe.np = np;
      safe.ttn = String(order.ttn);
    }
  }

  return jsonResp({ ok: true, order: safe });
}
