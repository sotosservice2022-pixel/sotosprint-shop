// POST /api/admin/storage/delete — видалення файлів з R2
// Body: { key: string } | { keys: string[] } | { action: 'wipe-all', confirm: 'YES' }
import { checkAuthAsync, jsonResp } from '../../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 не налаштовано' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }

  // Повне видалення сховища
  if (body.action === 'wipe-all') {
    if (body.confirm !== 'YES') return jsonResp({ ok: false, error: 'Потрібне підтвердження confirm: "YES"' }, 400);
    let deleted = 0;
    try {
      let cursor;
      do {
        const list = await env.STORAGE.list({ cursor, limit: 1000 });
        for (const obj of list.objects) {
          await env.STORAGE.delete(obj.key);
          deleted++;
        }
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
      return jsonResp({ ok: true, deleted, action: 'wipe-all' });
    } catch (e) {
      return jsonResp({ ok: false, error: 'Помилка видалення: ' + e.message, deleted }, 500);
    }
  }

  // Звичайне видалення (один або кілька ключів)
  const keys = Array.isArray(body.keys) ? body.keys : (body.key ? [body.key] : []);
  if (keys.length === 0) return jsonResp({ ok: false, error: 'Не вказано key' }, 400);

  try {
    let deleted = 0;
    for (const k of keys) {
      if (typeof k === 'string' && k.length > 0) {
        await env.STORAGE.delete(k);
        deleted++;
      }
    }
    return jsonResp({ ok: true, deleted });
  } catch (e) {
    return jsonResp({ ok: false, error: 'Помилка видалення: ' + e.message }, 500);
  }
}
