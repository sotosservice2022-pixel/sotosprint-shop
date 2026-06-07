// GET /api/shop — публичные данные магазина: настройки + товары
// Полагається лише на CDN edge cache через Cache-Control header.
// Інвалідація відбувається через CF Cache Purge API при змінах в адмінці.
import { getSettings, getProducts } from '../_utils/shop.js';

const SECRET_FIELDS = ['npApiKey', 'emailApiKey', 'emailFrom', 'emailTo', 'twoFactorChatId', 'cfApiToken', 'smsApiToken', 'smsAccountSid'];

export async function onRequestGet({ request, env }) {
  const [settings, products] = await Promise.all([getSettings(env), getProducts(env)]);
  const visibleProducts = products.filter(p => p.enabled !== false);
  const publicSettings = { ...settings };
  for (const f of SECRET_FIELDS) delete publicSettings[f];
  publicSettings.npAvailable = !!(settings.npApiKey && settings.npEnabled);

  const ttl = Math.max(5, Math.min(300, parseInt(settings.shopFullCacheSec, 10) || 30));
  const body = JSON.stringify({
    ...publicSettings,
    products: visibleProducts,
    limits: {
      maxPhotosPerItem: parseInt(env.MAX_PHOTOS_PER_ITEM || '20', 10),
      maxPhotoSizeMB: parseInt(env.MAX_PHOTO_SIZE_MB || '20', 10),
      maxTotalPhotos: parseInt(env.MAX_TOTAL_PHOTOS || '50', 10),
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // max-age=5 — браузер кешує лише 5 сек (швидко реагує на зміни)
      // s-maxage=ttl — CDN тримає довше, але інвалідується через purge при змінах
      'Cache-Control': `public, max-age=5, s-maxage=${ttl}, must-revalidate`,
    },
  });
}
