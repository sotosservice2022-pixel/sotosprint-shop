// /api/admin/order/[kvKey] — операции над одним заказом.
// kvKey — это order_<paddedTs>_<id> из listOrders
// GET — детали; POST { action: 'read' | 'unread' | 'done' | 'undone' | 'delete' }
import { getOrder, updateOrder, deleteOrder, checkAuthAsync, jsonResp, invalidateOrdersCache } from '../../../_utils/shop.js';

export async function onRequestGet({ request, env, params }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  const key = String(params.kvKey || '');
  if (!key.startsWith('order_')) return jsonResp({ ok: false, error: 'Невалидний ключ' }, 400);
  const order = await getOrder(env, key);
  if (!order) return jsonResp({ ok: false, error: 'Не знайдено' }, 404);
  return jsonResp({ ok: true, order });
}

export async function onRequestPost({ request, env, params }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  const key = String(params.kvKey || '');
  if (!key.startsWith('order_')) return jsonResp({ ok: false, error: 'Невалидний ключ' }, 400);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидний JSON' }, 400); }
  const action = String(body.action || '').toLowerCase();

  if (action === 'delete') {
    await deleteOrder(env, key);
    await invalidateOrdersCache();
    return jsonResp({ ok: true });
  }
  let patch = {};
  if (action === 'read') patch.isRead = true;
  else if (action === 'unread') patch.isRead = false;
  else if (action === 'done') { patch.isDone = true; patch.doneAt = new Date().toISOString(); }
  else if (action === 'undone') { patch.isDone = false; patch.doneAt = null; }
  else return jsonResp({ ok: false, error: 'Невідома дія' }, 400);

  const updated = await updateOrder(env, key, patch);
  if (!updated) return jsonResp({ ok: false, error: 'Не знайдено' }, 404);
  await invalidateOrdersCache();
  return jsonResp({ ok: true, order: updated });
}
