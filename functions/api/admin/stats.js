// GET /api/admin/stats — статистика використання сховищ і лімітів
// Не використовує KV list() — економимо ліміт.
// R2 list використовуємо (1 млн/міс — багато).
import { checkAuthAsync, getSettings, getOrderMeta, getProducts, jsonResp } from '../../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

  // Кеш на 5 хв
  const cache = caches.default;
  const cacheKey = new Request('https://cache/admin-stats', { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached && !request.url.includes('?force=1')) {
    return cached;
  }

  const result = {
    ok: true,
    generatedAt: new Date().toISOString(),
    kv: { breakdown: {}, estSizes: {}, total: 0, count: 0, listError: null },
    r2: { total: 0, count: 0, byType: {}, sizesByType: {}, listError: null },
    counters: {},
    limits: {},
  };

  try {
    // === KV — тільки відомі ключі, без list() ===
    const settings = await getSettings(env);
    const products = await getProducts(env);
    const orderMeta = await getOrderMeta(env);
    let orderCounter = 0;
    try { orderCounter = parseInt((await env.SHOP_KV?.get('orderCounter')) || '0', 10); } catch {}

    const settingsBytes = new TextEncoder().encode(JSON.stringify(settings)).length;
    const productsBytes = new TextEncoder().encode(JSON.stringify(products)).length;
    const orderMetaBytes = new TextEncoder().encode(JSON.stringify(orderMeta)).length;

    result.kv.estSizes = {
      settings: settingsBytes,
      products: productsBytes,
      orderMeta: orderMetaBytes,
    };
    result.kv.total = settingsBytes + productsBytes + orderMetaBytes;

    // Розподіл — рахуємо за відомими нам ключами
    result.kv.breakdown = {
      settings: 1,
      products: 1,
      orderCounter: orderCounter > 0 ? 1 : 0,
      order_meta: orderMeta.total > 0 ? 1 : 0,
      orders: orderMeta.total || 0,
    };
    result.kv.count = 2 + (orderCounter > 0 ? 1 : 0) + (orderMeta.total > 0 ? 1 : 0) + (orderMeta.total || 0);

    // === Лічильники ===
    result.counters = {
      orders: orderMeta.total || 0,
      ordersUnread: orderMeta.unread || 0,
      products: products.length,
      productsEnabled: products.filter(p => p.enabled !== false).length,
    };

    // === R2 ===
    if (env.STORAGE) {
      try {
        let cursor;
        let total = 0, count = 0;
        const byType = { image: 0, video: 0, other: 0 };
        const sizesByType = { image: 0, video: 0, other: 0 };
        do {
          const list = await env.STORAGE.list({ cursor, limit: 1000, include: ['httpMetadata'] });
          for (const obj of list.objects) {
            total += obj.size;
            count++;
            const ct = obj.httpMetadata?.contentType || '';
            let t = 'other';
            if (ct.startsWith('image/')) t = 'image';
            else if (ct.startsWith('video/')) t = 'video';
            byType[t]++;
            sizesByType[t] += obj.size;
          }
          cursor = list.truncated ? list.cursor : undefined;
        } while (cursor);
        result.r2.count = count;
        result.r2.total = total;
        result.r2.byType = byType;
        result.r2.sizesByType = sizesByType;
      } catch (e) {
        result.r2.listError = e.message;
      }
    }

    // === Ліміти ===
    result.limits = {
      kv: {
        storageMaxGB: 1,
        readsPerDay: 100000,
        writesPerDay: 1000,
        listsPerDay: 1000,
        deletesPerDay: 1000,
        keyMaxSizeKB: 25600,
      },
      r2: {
        storageMaxGB: 10,
        classAOpsPerMonth: 1000000,
        classBOpsPerMonth: 10000000,
        egress: 'unlimited',
      },
      pages: {
        buildsPerMonth: 500,
        deploymentsPerMonth: 'unlimited',
        functionsPerDay: 100000,
        bandwidthPerMonth: 'unlimited',
      },
    };

    const response = jsonResp(result);
    response.headers.set('Cache-Control', 'public, max-age=300');
    await cache.put(cacheKey, response.clone());
    return response;
  } catch (e) {
    return jsonResp({ ok: false, error: e.message, partial: result }, 500);
  }
}
