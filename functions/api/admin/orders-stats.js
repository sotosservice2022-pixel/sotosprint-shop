// GET /api/admin/orders-stats — лёгкий polling-эндпоинт. Читает только order_meta.
// Никаких list() операций — экономим квоту KV.
import { getOrderMeta, checkAuthAsync, jsonResp } from '../../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  try {
    const meta = await getOrderMeta(env);
    const stats = {
      total: meta.total || 0,
      unread: meta.unread || 0,
      latestUnread: meta.latestUnread || null,
    };
    return jsonResp({ ok: true, stats });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }
}
