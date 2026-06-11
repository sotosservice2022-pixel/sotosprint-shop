// POST /api/admin/storage/folders — CRUD власних (порожніх) папок сховища.
// Папки з файлами випливають із ключів автоматично (див. list.js). Тут зберігаємо лише
// СТВОРЕНІ порожні папки в KV 'storage_folders' (масив рядків-шляхів), щоб вони не зникали.
// Дії:
//   {action:'list'}                       → { ok, folders:[...] }
//   {action:'create', path:'misc/чашки'}  → створити порожню папку
//   {action:'rename', from, to}           → перейменувати (лише запис у KV; файли рухає move.js)
//   {action:'delete', path}               → прибрати запис порожньої папки
import { checkAuthAsync, jsonResp } from '../../../_utils/shop.js';

const KEY = 'storage_folders';

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

async function loadFolders(env) {
  try {
    const raw = await env.SHOP_KV.get(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s) : [];
  } catch { return []; }
}
async function saveFolders(env, arr) {
  const uniq = Array.from(new Set(arr)).sort();
  await env.SHOP_KV.put(KEY, JSON.stringify(uniq));
  return uniq;
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.SHOP_KV) return jsonResp({ ok: false, error: 'KV не налаштовано' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }
  const action = String(body.action || '').trim();

  if (action === 'list') {
    return jsonResp({ ok: true, folders: await loadFolders(env) });
  }

  if (action === 'create') {
    const path = sanitizeFolder(body.path);
    if (!path) return jsonResp({ ok: false, error: 'Порожня назва папки' }, 400);
    const folders = await loadFolders(env);
    folders.push(path);
    return jsonResp({ ok: true, folders: await saveFolders(env, folders) });
  }

  if (action === 'rename') {
    const from = sanitizeFolder(body.from);
    const to = sanitizeFolder(body.to);
    if (!from || !to) return jsonResp({ ok: false, error: 'Вкажіть from і to' }, 400);
    let folders = await loadFolders(env);
    // Перейменовуємо саму папку та всі вкладені записи (from/x → to/x)
    folders = folders.map(f => (f === from || f.startsWith(from + '/')) ? to + f.slice(from.length) : f);
    return jsonResp({ ok: true, folders: await saveFolders(env, folders) });
  }

  if (action === 'delete') {
    const path = sanitizeFolder(body.path);
    if (!path) return jsonResp({ ok: false, error: 'Вкажіть path' }, 400);
    let folders = await loadFolders(env);
    folders = folders.filter(f => f !== path && !f.startsWith(path + '/'));
    return jsonResp({ ok: true, folders: await saveFolders(env, folders) });
  }

  return jsonResp({ ok: false, error: 'Невідома дія' }, 400);
}
