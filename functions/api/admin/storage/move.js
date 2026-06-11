// POST /api/admin/storage/move — перемістити файли між папками R2.
// Тіло: { keys: string[], toFolder: string }  (toFolder '' → корінь)
// Для кожного ключа: copy під новим ключем (toFolder/<basename>) → delete старого →
// переписати посилання у products, settings, замовленнях (бо файли «прив'язані»).
// R2 не має move — лише put+delete. Best-effort: повертає скільки перенесено й посилань оновлено.
import {
  checkAuthAsync, jsonResp,
  getProducts, saveProducts, getSettings, saveSettings,
  storageUrl, keyFromStorageUrl, invalidateOrdersCache,
} from '../../../_utils/shop.js';

function sanitizeName(name) {
  return String(name || '')
    .replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄґҐ._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);
}
function sanitizeFolder(folder) {
  return String(folder || '')
    .split('/')
    .map(s => sanitizeName(s.trim()))
    .filter(s => s && s !== '_' && s !== '.' && s !== '..')
    .slice(0, 4)
    .join('/');
}
function basename(key) {
  const i = key.lastIndexOf('/');
  return i === -1 ? key : key.slice(i + 1);
}

// Рекурсивно замінити рядок oldUrl→newUrl у будь-якій JSON-структурі. Повертає [нова_структура, лічильник].
function replaceInTree(node, oldUrl, newUrl) {
  let n = 0;
  if (typeof node === 'string') {
    if (node === oldUrl) return [newUrl, 1];
    // Поле може містити URL у складі рядка (рідко) — заміна підрядка
    if (node.includes(oldUrl)) return [node.split(oldUrl).join(newUrl), 1];
    return [node, 0];
  }
  if (Array.isArray(node)) {
    const out = node.map(v => { const [nv, c] = replaceInTree(v, oldUrl, newUrl); n += c; return nv; });
    return [out, n];
  }
  if (node && typeof node === 'object') {
    const out = {};
    for (const k of Object.keys(node)) { const [nv, c] = replaceInTree(node[k], oldUrl, newUrl); n += c; out[k] = nv; }
    return [out, n];
  }
  return [node, 0];
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 не налаштовано' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }

  const toFolder = sanitizeFolder(body.toFolder);
  const keys = (Array.isArray(body.keys) ? body.keys : [])
    .filter(k => typeof k === 'string' && k.length > 0);
  if (keys.length === 0) return jsonResp({ ok: false, error: 'Не вказано keys' }, 400);

  // 1) Фізично копіюємо + видаляємо в R2; будуємо мапу oldKey→newKey для тих, що реально перенеслись
  const renames = []; // { oldKey, newKey }
  const errors = [];
  for (const oldKey of keys) {
    const newKey = toFolder ? `${toFolder}/${basename(oldKey)}` : basename(oldKey);
    if (newKey === oldKey) continue; // вже в цій папці
    try {
      const obj = await env.STORAGE.get(oldKey);
      if (!obj) { errors.push(`${oldKey}: не знайдено`); continue; }
      await env.STORAGE.put(newKey, obj.body, {
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
      });
      await env.STORAGE.delete(oldKey);
      renames.push({ oldKey, newKey });
    } catch (e) {
      errors.push(`${oldKey}: ${e.message}`);
    }
  }

  if (renames.length === 0) {
    return jsonResp({ ok: true, moved: 0, refsUpdated: 0, errors });
  }

  let refsUpdated = 0;

  // 2) Переписати посилання у products (поля image/images[].url містять storageUrl)
  try {
    let products = await getProducts(env);
    let changed = 0;
    for (const { oldKey, newKey } of renames) {
      const [np, c] = replaceInTree(products, storageUrl(oldKey), storageUrl(newKey));
      products = np; changed += c;
    }
    if (changed) { await saveProducts(env, products); refsUpdated += changed; }
  } catch (e) { errors.push('products: ' + e.message); }

  // 3) Переписати посилання у settings (logo/favicon/banner/hero/og/pwa …)
  try {
    let settings = await getSettings(env);
    let changed = 0;
    for (const { oldKey, newKey } of renames) {
      const [ns, c] = replaceInTree(settings, storageUrl(oldKey), storageUrl(newKey));
      settings = ns; changed += c;
    }
    if (changed) { await saveSettings(env, settings); refsUpdated += changed; }
  } catch (e) { errors.push('settings: ' + e.message); }

  // 4) Переписати ключі фото у замовленнях (order.photos[].key — сирий ключ, не URL)
  try {
    const oldToNew = new Map(renames.map(r => [r.oldKey, r.newKey]));
    let cursor;
    do {
      const list = await env.SHOP_KV.list({ prefix: 'order_', cursor, limit: 1000 });
      for (const k of list.keys) {
        if (!/^order_\d/.test(k.name)) continue;
        let order;
        try { order = await env.SHOP_KV.get(k.name, 'json'); } catch { continue; }
        if (!order || !Array.isArray(order.photos) || !order.photos.length) continue;
        let touched = false;
        for (const ph of order.photos) {
          if (ph && ph.key && oldToNew.has(ph.key)) { ph.key = oldToNew.get(ph.key); touched = true; refsUpdated++; }
        }
        if (touched) {
          try { await env.SHOP_KV.put(k.name, JSON.stringify(order), { expirationTtl: 365 * 24 * 60 * 60 }); } catch (e) { errors.push('order ' + k.name + ': ' + e.message); }
        }
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
    await invalidateOrdersCache();
  } catch (e) { errors.push('orders: ' + e.message); }

  return jsonResp({ ok: true, moved: renames.length, refsUpdated, errors });
}
