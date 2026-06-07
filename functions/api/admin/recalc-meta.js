// POST /api/admin/recalc-meta — пересчитать счётчики заказов на основе KV (тяжёлая операция, делает list)
// Использовать редко, например когда счётчик рассинхронизировался.
import { recalcOrderMeta, checkAuthAsync, jsonResp } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  try {
    const meta = await recalcOrderMeta(env);
    return jsonResp({ ok: true, meta });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }
}
