// POST /api/admin/restore — відновлення KV з раніше створеного бекапу
// Тіло: JSON у тому форматі, що повертає /api/admin/backup
// Body: { keys: { settings: '...', products: '...', ... }, options: { wipe: true } }
import { checkAuthAsync, unauthorized, jsonResp } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  if (!env.SHOP_KV) return jsonResp({ ok: false, error: 'KV не доступний' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }
  if (!body || typeof body.keys !== 'object') {
    return jsonResp({ ok: false, error: 'Очікуємо обʼєкт { keys: {...} }' }, 400);
  }

  const wipe = body.options?.wipe === true;
  let written = 0, skipped = 0;

  // Опціонально: спочатку видаляємо всі ключі (повне відновлення стану)
  if (wipe) {
    let cursor;
    do {
      const list = await env.SHOP_KV.list({ cursor });
      for (const k of list.keys) {
        // Не видаляємо record неудалих логінів — щоб не залочити після restore
        if (k.name.startsWith('login_fails_')) continue;
        await env.SHOP_KV.delete(k.name);
      }
      cursor = list.list_complete ? undefined : list.cursor;
    } while (cursor);
  }

  for (const [keyName, value] of Object.entries(body.keys)) {
    // Защита от сломанных ключей
    if (typeof keyName !== 'string' || !keyName.length) { skipped++; continue; }
    if (typeof value !== 'string') { skipped++; continue; }
    await env.SHOP_KV.put(keyName, value);
    written++;
  }

  return jsonResp({ ok: true, written, skipped, wipe });
}
