// /api/admin/backup — управління бекапами KV (зберігаються в R2 під префіксом backups/)
// Дії:
//  - list:    POST {action:'list'} → список усіх бекапів
//  - create:  POST {action:'create'} → створити новий бекап (зберігає всі KV ключі в JSON у R2)
//  - delete:  POST {action:'delete', file:'backups/...'}
//  - restore: POST {action:'restore', file:'backups/...'} → відновити KV з бекапу
//  - download:POST {action:'download', file:'backups/...'} → завантажити JSON

import { checkAuthAsync, jsonResp } from '../../_utils/shop.js';

const BACKUP_PREFIX = 'backups/';

async function listAllKvKeys(env) {
  const keys = [];
  let cursor = undefined;
  while (true) {
    const list = await env.SHOP_KV.list({ cursor, limit: 1000 });
    keys.push(...list.keys.map(k => k.name));
    if (list.list_complete) break;
    cursor = list.cursor;
    if (!cursor) break;
  }
  return keys;
}

// GET /api/admin/backup — миттєве завантаження повного дампу KV у JSON (без збереження в R2).
// Використовує кнопка «📥 Завантажити бекап» на головній адмінки. У дамп входять ВСІ ключі KV,
// включно із замовленнями клієнтів (order_<ts>_<id>), налаштуваннями та товарами.
// Формат сумісний із /api/admin/restore ({ keys: {...} }).
export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.SHOP_KV) return jsonResp({ ok: false, error: 'KV не доступний' }, 500);
  try {
    const keys = await listAllKvKeys(env);
    const data = { version: 1, created: new Date().toISOString(), keys: {} };
    for (const key of keys) {
      if (key.startsWith('visit_seen_')) continue; // тимчасові ключі — не роздуваємо бекап
      data.keys[key] = await env.SHOP_KV.get(key);
    }
    const json = JSON.stringify(data);
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    return new Response(json, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="agprnt-backup-${ts}.json"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидний JSON' }, 400); }

  const action = String(body.action || '').trim();

  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 не налаштовано' }, 500);

  // === LIST ===
  if (action === 'list') {
    try {
      const list = await env.STORAGE.list({ prefix: BACKUP_PREFIX, limit: 1000 });
      const items = (list.objects || []).map(o => ({
        key: o.key,
        size: o.size,
        uploaded: o.uploaded,
        // витягуємо timestamp з імені файла
        date: o.key.replace(BACKUP_PREFIX, '').replace('.json', ''),
      })).sort((a, b) => (b.uploaded > a.uploaded ? 1 : -1));
      return jsonResp({ ok: true, items });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // === CREATE ===
  if (action === 'create') {
    try {
      const keys = await listAllKvKeys(env);
      const data = { version: 1, created: new Date().toISOString(), keys: {} };
      // Читаємо ВСІ ключі (із метаданими)
      for (const key of keys) {
        // Пропускаємо тимчасові ключі (visit_seen_*) щоб не роздувати бекап
        if (key.startsWith('visit_seen_')) continue;
        const v = await env.SHOP_KV.get(key);
        data.keys[key] = v;
      }
      const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      const fileName = `${BACKUP_PREFIX}backup_${ts}.json`;
      const json = JSON.stringify(data);
      await env.STORAGE.put(fileName, json, {
        httpMetadata: { contentType: 'application/json' },
      });
      return jsonResp({
        ok: true,
        file: fileName,
        keysCount: Object.keys(data.keys).length,
        size: json.length,
      });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // === DELETE ===
  if (action === 'delete') {
    const file = String(body.file || '').trim();
    if (!file.startsWith(BACKUP_PREFIX)) return jsonResp({ ok: false, error: 'Невалидний файл' }, 400);
    try {
      await env.STORAGE.delete(file);
      return jsonResp({ ok: true, message: 'Видалено' });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // === DOWNLOAD ===
  if (action === 'download') {
    const file = String(body.file || '').trim();
    if (!file.startsWith(BACKUP_PREFIX)) return jsonResp({ ok: false, error: 'Невалидний файл' }, 400);
    try {
      const obj = await env.STORAGE.get(file);
      if (!obj) return jsonResp({ ok: false, error: 'Файл не знайдено' }, 404);
      const text = await obj.text();
      return new Response(text, {
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${file.replace(BACKUP_PREFIX, '')}"`,
        },
      });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // === RESTORE ===
  if (action === 'restore') {
    const file = String(body.file || '').trim();
    if (!file.startsWith(BACKUP_PREFIX)) return jsonResp({ ok: false, error: 'Невалидний файл' }, 400);
    try {
      const obj = await env.STORAGE.get(file);
      if (!obj) return jsonResp({ ok: false, error: 'Файл не знайдено' }, 404);
      const data = await obj.json();
      if (!data.keys || typeof data.keys !== 'object') {
        return jsonResp({ ok: false, error: 'Невалидний формат бекапу' }, 400);
      }
      let restored = 0;
      let errors = 0;
      for (const [key, value] of Object.entries(data.keys)) {
        try {
          if (value === null || value === undefined) continue;
          await env.SHOP_KV.put(key, value);
          restored++;
        } catch (e) {
          errors++;
        }
      }
      return jsonResp({
        ok: true,
        message: `Відновлено ${restored} ключів${errors ? `, помилок: ${errors}` : ''}`,
        restored,
        errors,
      });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  return jsonResp({ ok: false, error: 'Невідома дія' }, 400);
}
