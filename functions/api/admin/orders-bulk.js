// POST /api/admin/orders-bulk — массовые операции над заказами
// Body: { kvKeys: [...], action: 'delete' | 'read' | 'unread' | 'done' | 'undone' }
// Или { action: 'delete-all', confirm: 'YES' } — удалить ВСЕ заказы
import { listOrders, deleteOrder, updateOrder, checkAuthAsync, jsonResp, invalidateOrdersCache } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидний JSON' }, 400); }
  const action = String(body.action || '').toLowerCase();

  if (action === 'delete-all') {
    if (body.confirm !== 'YES') {
      return jsonResp({ ok: false, error: 'Підтвердження не пройдено. Передайте confirm: "YES" в тілі запиту.' }, 400);
    }
    const orders = await listOrders(env, 1000);
    let deleted = 0;
    for (const o of orders) {
      if (o.kvKey) {
        try { await deleteOrder(env, o.kvKey); deleted++; } catch {}
      }
    }
    await invalidateOrdersCache();
    return jsonResp({ ok: true, deleted });
  }

  const keys = Array.isArray(body.kvKeys) ? body.kvKeys.filter(k => typeof k === 'string' && k.startsWith('order_')) : [];
  if (keys.length === 0) return jsonResp({ ok: false, error: 'Не вибрано жодного замовлення' }, 400);
  if (keys.length > 200) return jsonResp({ ok: false, error: 'Забагато замовлень за раз (макс 200)' }, 400);

  let processed = 0;
  if (action === 'delete') {
    for (const k of keys) {
      try { await deleteOrder(env, k); processed++; } catch {}
    }
  } else {
    let patch = {};
    if (action === 'read') patch.isRead = true;
    else if (action === 'unread') patch.isRead = false;
    else if (action === 'done') { patch.isDone = true; patch.doneAt = new Date().toISOString(); }
    else if (action === 'undone') { patch.isDone = false; patch.doneAt = null; }
    else return jsonResp({ ok: false, error: 'Невідома дія: ' + action }, 400);
    for (const k of keys) {
      try { await updateOrder(env, k, patch); processed++; } catch {}
    }
  }
  await invalidateOrdersCache();
  return jsonResp({ ok: true, processed });
}
