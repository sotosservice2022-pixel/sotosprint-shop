// POST /api/admin/storage/migrate — разова розкладка існуючих «плоских» файлів по папках.
// Класифікує кожен ключ БЕЗ слешів за типом і переносить у відповідну системну папку
// (з перезаписом посилань через moveStorageKeys). Файли, що вже в папках, не чіпає.
// Тіло: { dryRun?: boolean }  — dryRun:true лише показує план, нічого не переносить.
import { checkAuthAsync, jsonResp, moveStorageKeys } from '../../../_utils/shop.js';

// Визначає цільову папку за іменем ключа. null → лишаємо в корені (не класифіковано).
function classify(key) {
  // Фото клієнта старого формату: order_<id>_<i>_<n>_<name> → orders/<id>
  const mOrder = key.match(/^order_(\d+)_/);
  if (mOrder) return `orders/${mOrder[1]}`;
  // Бекапи вже в backups/ (зі слешем) — сюди не потраплять.
  // Решта — за префіксом імені (його ставить _r2-upload.js: <ts>_<prefix>_<name>)
  if (/_product_/.test(key)) return 'products';
  if (/_(logo|topbar-bg|banner|hero|hero-extra|favicon|pwaicon|pwaiconmask)[_-]/.test(key)) return 'branding';
  if (/_(regen|gen|gen-ref|restore|restore-src|restore-rgsrc|restore-out)[_-]/.test(key)) return 'ai';
  return null;
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 не налаштовано' }, 500);

  let body = {};
  try { body = await request.json(); } catch {}
  const dryRun = body.dryRun === true;

  // Збираємо всі ключі БЕЗ слешів (тобто ще не в папках)
  const renames = [];
  const skipped = [];
  try {
    let cursor;
    do {
      const list = await env.STORAGE.list({ cursor, limit: 1000 });
      for (const obj of list.objects) {
        if (obj.key.includes('/')) continue; // вже в папці
        const folder = classify(obj.key);
        if (!folder) { skipped.push(obj.key); continue; }
        renames.push({ oldKey: obj.key, newKey: `${folder}/${obj.key}` });
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
  } catch (e) {
    return jsonResp({ ok: false, error: 'Помилка листингу: ' + e.message }, 500);
  }

  // План по папках (для звіту/прев'ю)
  const plan = {};
  for (const r of renames) {
    const folder = r.newKey.slice(0, r.newKey.indexOf('/'));
    plan[folder] = (plan[folder] || 0) + 1;
  }

  if (dryRun) {
    return jsonResp({ ok: true, dryRun: true, willMove: renames.length, plan, skipped: skipped.length });
  }

  const res = await moveStorageKeys(env, renames);
  return jsonResp({ ok: true, ...res, plan, skipped: skipped.length });
}
