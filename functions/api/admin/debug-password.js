// GET /api/admin/debug-password — діагностика стану пароля адмінки
// Показує все що бачить getEffectivePassword: Cache API, KV, env, revocation timestamp.
// Примітка: ключі Cache API містять "sotosprint.store" — це лише унікальні ідентифікатори,
// не реальні URL запитів (Cache API per-colo). При зміні домену не критично.
import { checkAuthAsync, jsonResp } from '../../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) {
    return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  }

  const result = {
    ok: true,
    timestamp: new Date().toISOString(),
    sources: {},
  };

  // 1. Cache API password-override
  try {
    const cache = caches.default;
    const cached = await cache.match(new Request('https://sotosprint.store/__internal/password-override'));
    if (cached) {
      const text = await cached.text();
      result.sources.cacheApi_password = {
        found: true,
        length: text.length,
        preview: text.slice(0, 3) + '***',
      };
    } else {
      result.sources.cacheApi_password = { found: false };
    }
  } catch (e) {
    result.sources.cacheApi_password = { error: e.message };
  }

  // 2. KV admin_password_override
  try {
    const stored = await env.SHOP_KV?.get('admin_password_override');
    result.sources.kv_password = stored
      ? { found: true, length: stored.length, preview: stored.slice(0, 3) + '***' }
      : { found: false };
  } catch (e) {
    result.sources.kv_password = { error: e.message };
  }

  // 3. Cache API password-revocation
  try {
    const cache = caches.default;
    const cached = await cache.match(new Request('https://sotosprint.store/__internal/password-revocation'));
    if (cached) {
      const text = await cached.text();
      const ts = parseInt(text, 10);
      result.sources.cacheApi_revocation = {
        found: true,
        timestamp: ts,
        date: ts ? new Date(ts).toISOString() : null,
      };
    } else {
      result.sources.cacheApi_revocation = { found: false };
    }
  } catch (e) {
    result.sources.cacheApi_revocation = { error: e.message };
  }

  // 4. KV admin_password_revoked_at
  try {
    const stored = await env.SHOP_KV?.get('admin_password_revoked_at');
    if (stored) {
      const ts = parseInt(stored, 10);
      result.sources.kv_revocation = {
        found: true,
        timestamp: ts,
        date: ts ? new Date(ts).toISOString() : null,
      };
    } else {
      result.sources.kv_revocation = { found: false };
    }
  } catch (e) {
    result.sources.kv_revocation = { error: e.message };
  }

  // 5. env.ADMIN_PASSWORD
  result.sources.env_password = env.ADMIN_PASSWORD
    ? { found: true, length: env.ADMIN_PASSWORD.length, preview: env.ADMIN_PASSWORD.slice(0, 3) + '***' }
    : { found: false };

  // 6. Що поверне getEffectivePassword у поточній колонці
  try {
    const { getEffectivePassword } = await import('../../_utils/shop.js');
    const effective = await getEffectivePassword(env);
    result.effectivePassword = {
      length: effective.length,
      preview: effective ? (effective.slice(0, 3) + '***') : '(empty)',
      isEnv: effective === (env.ADMIN_PASSWORD || '').trim(),
    };
  } catch (e) {
    result.effectivePassword = { error: e.message };
  }

  return jsonResp(result);
}
