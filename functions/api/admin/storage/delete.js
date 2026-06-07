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
        const batch = list.objects.map(o => o.key);
        if (batch.length) {
          // R2 підтримує видалення масиву ключів одним викликом (до 1000)
          await env.STORAGE.delete(batch);
          deleted += batch.length;
        }
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
      return jsonResp({ ok: true, deleted, action: 'wipe-all' });
    } catch (e) {
      return jsonResp({ ok: false, error: 'Помилка видалення: ' + e.message, deleted }, 500);
    }
  }

  // Звичайне видалення (один або кілька ключів) — справжнє batch-видалення масивом
  const rawKeys = Array.isArray(body.keys) ? body.keys : (body.key ? [body.key] : []);
  const keys = rawKeys.filter(k => typeof k === 'string' && k.length > 0);
  if (keys.length === 0) return jsonResp({ ok: false, error: 'Не вказано key' }, 400);

  try {
    let deleted = 0;
    // R2 .delete() приймає масив до 1000 ключів за виклик — ділимо на частини
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      await env.STORAGE.delete(chunk);
      deleted += chunk.length;
    }
    return jsonResp({ ok: true, deleted });
  } catch (e) {
    return jsonResp({ ok: false, error: 'Помилка видалення: ' + e.message }, 500);
  }
}
