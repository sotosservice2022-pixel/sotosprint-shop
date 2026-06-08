// /api/admin/ui-layout — серверне (синхронізоване між ПК) збереження розкладки адмінки:
//   tiles    -> порядок плиток на дашборді, за шляхом сторінки
//   cards    -> порядок карток-секцій усередині сторінки
//   collapse -> згорнутий/розгорнутий стан карток
// Зберігається в KV ('admin_ui_layout') і застосовується на будь-якому комп'ютері/браузері,
// де ти заходиш в адмінку. Браузерний localStorage лишається як миттєвий кеш.
//
// GET                                  -> { ok, layout:{ tiles:{}, cards:{}, collapse:{} } }
// POST { kind, path, value }           -> { ok, layout }   // value=[] або {} порожнє видаляє запис
//   kind: 'tiles' | 'cards' | 'collapse'
import { checkAuthAsync, jsonResp } from '../../_utils/shop.js';

const KV_KEY = 'admin_ui_layout';
const KINDS = ['tiles', 'cards', 'collapse'];

function emptyLayout() {
  return { tiles: {}, cards: {}, collapse: {} };
}

async function loadLayout(env) {
  const base = emptyLayout();
  if (!env.SHOP_KV) return base;
  try {
    const raw = await env.SHOP_KV.get(KV_KEY);
    if (!raw) return base;
    const obj = JSON.parse(raw);
    for (const k of KINDS) {
      if (obj && obj[k] && typeof obj[k] === 'object') base[k] = obj[k];
    }
  } catch (_) {}
  return base;
}

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  const layout = await loadLayout(env);
  return jsonResp({ ok: true, layout });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.SHOP_KV) return jsonResp({ ok: false, error: 'KV не налаштовано' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }

  const kind = body && typeof body.kind === 'string' ? body.kind : '';
  const path = body && typeof body.path === 'string' ? body.path : '';
  if (!KINDS.includes(kind)) return jsonResp({ ok: false, error: 'Невідомий kind' }, 400);
  if (!path) return jsonResp({ ok: false, error: 'Відсутній path' }, 400);

  const value = body ? body.value : undefined;
  // read-modify-write: чіпаємо ТІЛЬКИ цей kind+path, решту лишаємо як є
  const layout = await loadLayout(env);

  let isEmpty = false;
  if (Array.isArray(value)) isEmpty = value.length === 0;
  else if (value && typeof value === 'object') isEmpty = Object.keys(value).length === 0;
  else isEmpty = true; // null/undefined/інше -> видалити запис

  if (isEmpty) delete layout[kind][path];
  else layout[kind][path] = value;

  try {
    await env.SHOP_KV.put(KV_KEY, JSON.stringify(layout));
  } catch (e) {
    return jsonResp({ ok: false, error: 'Не вдалося зберегти: ' + (e.message || e) }, 500);
  }
  return jsonResp({ ok: true, layout });
}
