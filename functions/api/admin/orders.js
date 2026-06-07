// GET /api/admin/orders — список заказов с метриками
// Без кеша — щоб список завжди був свіжим. KV.list() = 1 операція за виклик.
import { listOrders, checkAuthAsync, jsonResp, notifyLimitHit, classifyLimitError } from '../../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  try {
    if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

    const orders = await listOrders(env, 500);
    const today = new Date().toISOString().slice(0, 10);
    const stats = {
      total: orders.length,
      unread: orders.filter(o => !o.isRead).length,
      today: orders.filter(o => (o.createdAt || '').startsWith(today)).length,
      done: orders.filter(o => o.isDone).length,
      pending: orders.filter(o => !o.isDone).length,
    };
    return jsonResp({ ok: true, orders, stats });
  } catch (e) {
    const limitKind = classifyLimitError(e);
    if (limitKind) await notifyLimitHit(env, limitKind, e.message);
    return jsonResp({ ok: false, error: 'Server error: ' + (e.message || String(e)) }, 500);
  }
}
