// POST /api/admin/storage/move — перемістити файли між папками R2.
// Тіло: { keys: string[], toFolder: string }  (toFolder '' → корінь)
// Copy під новим ключем (toFolder/<basename>) → delete старого → перепис посилань.
// Логіка переносу спільна з міграцією (moveStorageKeys у _utils/shop.js).
import { checkAuthAsync, jsonResp, moveStorageKeys } from '../../../_utils/shop.js';

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

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 не налаштовано' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }

  const toFolder = sanitizeFolder(body.toFolder);
  const keys = (Array.isArray(body.keys) ? body.keys : [])
    .filter(k => typeof k === 'string' && k.length > 0);
  if (keys.length === 0) return jsonResp({ ok: false, error: 'Не вказано keys' }, 400);

  const renames = keys
    .map(oldKey => ({ oldKey, newKey: toFolder ? `${toFolder}/${basename(oldKey)}` : basename(oldKey) }))
    .filter(r => r.newKey !== r.oldKey);

  const res = await moveStorageKeys(env, renames);
  return jsonResp({ ok: true, ...res });
}
