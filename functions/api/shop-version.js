// GET /api/shop-version — мала відповідь з версією магазину.
// Frontend опитує цей endpoint часто, якщо версія змінилась — тягне /api/shop.
// CDN-кеш налаштовується через settings.shopVersionCacheSec (default 2 сек).
import { getShopVersion, getSettings } from '../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  const v = await getShopVersion(env);
  let ttl = 2;
  try {
    const s = await getSettings(env);
    const cfg = parseInt(s.shopVersionCacheSec, 10);
    if (cfg >= 1 && cfg <= 30) ttl = cfg;
  } catch {}
  const body = JSON.stringify({ v });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // max-age=2 для браузера — швидке виявлення версії, s-maxage більше для CDN
      'Cache-Control': `public, max-age=2, s-maxage=${ttl}, must-revalidate`,
    },
  });
}
