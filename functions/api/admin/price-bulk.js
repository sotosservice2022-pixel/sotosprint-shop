// POST /api/admin/price-bulk — групова зміна цін товарів з бекапом для відкату.
//
// Дії (body.action):
//  - 'preview'  → порахувати нові ціни за параметрами, нічого не зберігати.
//                 Повертає { items:[{id,name,old,new,changed}], count, affected }
//  - 'apply'    → зробити бекап поточних товарів у KV (price_bulk_backup),
//                 застосувати нові ціни і зберегти. Повертає { applied, backup:{created} }
//  - 'rollback' → відновити товари з останнього бекапу. Повертає { restored, created }
//  - 'info'     → інформація про наявний бекап { hasBackup, created, count, params }
//
// Параметри розрахунку (для preview/apply):
//   scope:     'all' | 'selected' | 'category'
//   productIds:[...]      (для scope='selected')
//   categoryId:'...'      (для scope='category')
//   mode:      'uah' | 'percent'
//   direction: 'inc' | 'dec'
//   value:     число > 0
//   rounding:  'none' | 'int' | 'half' | 'tenth'
//   minPrice:  число (нижня межа, за замовч. 0)

import { getProducts, saveProducts, validateProduct, checkAuthAsync, jsonResp } from '../../_utils/shop.js';

const BACKUP_KEY = 'price_bulk_backup';

function round2(x) { return Math.round(x * 100) / 100; }

function applyRounding(x, mode) {
  switch (mode) {
    case 'int':   return Math.round(x);
    case 'half':  return Math.round(x * 2) / 2;
    case 'tenth': return Math.round(x * 10) / 10;
    case 'none':
    default:      return round2(x);
  }
}

// Чи входить товар у вибрану область
function inScope(p, params) {
  if (params.scope === 'selected') return params.idsSet.has(p.id);
  if (params.scope === 'category') return (p.categoryId || '') === params.categoryId;
  return true; // 'all'
}

// Порахувати нову ціну для одного товару
function computeNewPrice(oldPrice, params) {
  const base = Number(oldPrice) || 0;
  const delta = params.mode === 'percent' ? base * (params.value / 100) : params.value;
  let next = params.direction === 'dec' ? base - delta : base + delta;
  next = applyRounding(next, params.rounding);
  if (next < params.minPrice) next = params.minPrice;
  if (next < 0) next = 0;
  if (next > 1000000) next = 1000000;
  return round2(next);
}

function parseParams(body) {
  const scope = ['all', 'selected', 'category'].includes(body.scope) ? body.scope : 'all';
  const mode = body.mode === 'percent' ? 'percent' : 'uah';
  const direction = body.direction === 'dec' ? 'dec' : 'inc';
  const rounding = ['none', 'int', 'half', 'tenth'].includes(body.rounding) ? body.rounding : 'int';
  const value = Number(body.value);
  const minPrice = Number.isFinite(Number(body.minPrice)) ? Math.max(0, Number(body.minPrice)) : 0;
  const ids = Array.isArray(body.productIds) ? body.productIds.filter(i => typeof i === 'string') : [];
  return {
    scope, mode, direction, rounding, value, minPrice,
    categoryId: String(body.categoryId || ''),
    idsSet: new Set(ids),
    ids,
  };
}

function validateCalcParams(params) {
  if (!Number.isFinite(params.value) || params.value <= 0) return 'Вкажіть число більше нуля';
  if (params.mode === 'percent' && params.value > 100 && params.direction === 'dec') {
    return 'Знижка у % не може бути більшою за 100%';
  }
  if (params.scope === 'selected' && params.idsSet.size === 0) return 'Не вибрано жодного товару (постав галочки у списку)';
  if (params.scope === 'category' && !params.categoryId) return 'Не вибрано категорію';
  return null;
}

// Порахувати список змін для набору товарів
function buildChanges(products, params) {
  const items = [];
  let affected = 0;
  for (const p of products) {
    if (!inScope(p, params)) continue;
    const oldP = Number(p.price) || 0;
    const newP = computeNewPrice(oldP, params);
    const changed = newP !== oldP;
    if (changed) affected++;
    items.push({ id: p.id, name: p.name || p.id, old: oldP, new: newP, changed, currency: p.currency || '₴' });
  }
  return { items, affected };
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.SHOP_KV) return jsonResp({ ok: false, error: 'KV не доступний' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }
  const action = String(body.action || '').toLowerCase();

  // === INFO про бекап ===
  if (action === 'info') {
    try {
      const raw = await env.SHOP_KV.get(BACKUP_KEY);
      if (!raw) return jsonResp({ ok: true, hasBackup: false });
      const data = JSON.parse(raw);
      return jsonResp({
        ok: true,
        hasBackup: true,
        created: data.created || null,
        count: Array.isArray(data.products) ? data.products.length : 0,
        params: data.params || null,
      });
    } catch (e) {
      return jsonResp({ ok: true, hasBackup: false });
    }
  }

  // === ROLLBACK ===
  if (action === 'rollback') {
    const raw = await env.SHOP_KV.get(BACKUP_KEY);
    if (!raw) return jsonResp({ ok: false, error: 'Бекап не знайдено — нема що відкочувати' }, 404);
    let data;
    try { data = JSON.parse(raw); } catch { return jsonResp({ ok: false, error: 'Бекап пошкоджено' }, 500); }
    const restoreArr = data.products;
    if (!Array.isArray(restoreArr)) return jsonResp({ ok: false, error: 'Невалідний бекап' }, 500);
    for (const p of restoreArr) {
      const err = validateProduct(p);
      if (err) return jsonResp({ ok: false, error: 'Бекап містить некоректний товар: ' + err }, 400);
    }
    await saveProducts(env, restoreArr);
    return jsonResp({ ok: true, restored: restoreArr.length, created: data.created || null });
  }

  // === PREVIEW / APPLY ===
  if (action === 'preview' || action === 'apply') {
    const params = parseParams(body);
    const verr = validateCalcParams(params);
    if (verr) return jsonResp({ ok: false, error: verr }, 400);

    const products = await getProducts(env);
    const { items, affected } = buildChanges(products, params);

    if (action === 'preview') {
      return jsonResp({ ok: true, items, count: items.length, affected });
    }

    // APPLY
    if (affected === 0) return jsonResp({ ok: false, error: 'Жодна ціна не змінюється (нічого застосовувати)' }, 400);

    // 1) Бекап поточного стану (для відкату)
    const backup = {
      created: new Date().toISOString(),
      params: { scope: params.scope, mode: params.mode, direction: params.direction, value: params.value, rounding: params.rounding, minPrice: params.minPrice },
      products,
    };
    await env.SHOP_KV.put(BACKUP_KEY, JSON.stringify(backup));

    // 2) Застосовуємо нові ціни
    const priceMap = new Map(items.map(it => [it.id, it.new]));
    const updated = products.map(p => {
      if (priceMap.has(p.id)) return { ...p, price: priceMap.get(p.id) };
      return p;
    });
    for (const p of updated) {
      const err = validateProduct(p);
      if (err) return jsonResp({ ok: false, error: 'Помилка валідації після зміни: ' + err }, 400);
    }
    await saveProducts(env, updated);
    return jsonResp({ ok: true, applied: affected, total: updated.length, backup: { created: backup.created } });
  }

  return jsonResp({ ok: false, error: 'Невідома дія: ' + action }, 400);
}
