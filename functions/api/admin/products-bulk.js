// POST /api/admin/products-bulk { productIds[], action: 'delete' | 'enable' | 'disable' }
// Или { action: 'delete-disabled', confirm: 'YES' } — удалить все скрытые
// Или { action: 'delete-all', confirm: 'YES' } — удалить ВСЕ товары
import { getProducts, saveProducts, checkAuthAsync, jsonResp } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидний JSON' }, 400); }
  const action = String(body.action || '').toLowerCase();

  let products = await getProducts(env);
  let processed = 0;

  if (action === 'delete-all') {
    if (body.confirm !== 'YES') return jsonResp({ ok: false, error: 'Необхідне підтвердження confirm: "YES"' }, 400);
    processed = products.length;
    products = [];
  } else if (action === 'delete-disabled') {
    if (body.confirm !== 'YES') return jsonResp({ ok: false, error: 'Необхідне підтвердження confirm: "YES"' }, 400);
    const before = products.length;
    products = products.filter(p => p.enabled !== false);
    processed = before - products.length;
  } else {
    const ids = Array.isArray(body.productIds) ? body.productIds.filter(i => typeof i === 'string') : [];
    if (ids.length === 0) return jsonResp({ ok: false, error: 'Не вибрано жодного товару' }, 400);
    const idsSet = new Set(ids);
    if (action === 'delete') {
      const before = products.length;
      products = products.filter(p => !idsSet.has(p.id));
      processed = before - products.length;
    } else if (action === 'enable' || action === 'disable') {
      const newEnabled = action === 'enable';
      for (const p of products) {
        if (idsSet.has(p.id)) { p.enabled = newEnabled; processed++; }
      }
    } else {
      return jsonResp({ ok: false, error: 'Невідома дія: ' + action }, 400);
    }
  }

  await saveProducts(env, products);
  return jsonResp({ ok: true, processed });
}
