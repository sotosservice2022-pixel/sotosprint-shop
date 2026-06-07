// GET/POST /api/admin/counter
import { checkAuthAsync, unauthorized, jsonResp } from '../../_utils/shop.js';

const KEY = 'orderCounter';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  const cur = parseInt((await env.SHOP_KV?.get(KEY)) || '0', 10);
  return jsonResp({ ok: true, current: cur, next: cur + 1 });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидный JSON' }, 400); }
  const v = parseInt(body.value, 10);
  if (!Number.isFinite(v) || v < 0 || v > 99999999) {
    return jsonResp({ ok: false, error: 'Значение от 0 до 99 999 999' }, 400);
  }
  await env.SHOP_KV.put(KEY, String(v));
  return jsonResp({ ok: true, current: v, next: v + 1 });
}
