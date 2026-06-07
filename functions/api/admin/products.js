// GET/POST /api/admin/products
import { getProducts, saveProducts, validateProduct, checkAuthAsync, unauthorized, jsonResp } from '../../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  const products = await getProducts(env);
  return jsonResp({ ok: true, products });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  let arr;
  try { arr = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидный JSON' }, 400); }
  if (!Array.isArray(arr)) return jsonResp({ ok: false, error: 'Должен быть массив' }, 400);

  const ids = new Set();
  for (const p of arr) {
    const err = validateProduct(p);
    if (err) return jsonResp({ ok: false, error: err }, 400);
    if (ids.has(p.id)) return jsonResp({ ok: false, error: `Дубль id: ${p.id}` }, 400);
    ids.add(p.id);
  }

  await saveProducts(env, arr);
  return jsonResp({ ok: true, count: arr.length });
}
