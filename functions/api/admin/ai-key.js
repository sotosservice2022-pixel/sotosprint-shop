// /api/admin/ai-key — зберігання ключа Gemini (Google AI Studio) для преміум-режиму фото.
// GET  -> { ok, hasKey }            // не повертає сам ключ, лише чи він заданий
// POST { key } -> { ok }            // зберігає ключ у KV (ai_image_key); порожній key видаляє
// Ключ зберігається ТІЛЬКИ в KV і ніколи не повертається у вітрину/клієнт.
import { checkAuthAsync, jsonResp } from '../../_utils/shop.js';

const KV_KEY = 'ai_image_key';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.SHOP_KV) return jsonResp({ ok: true, hasKey: false, kv: false });
  let hasKey = false;
  try { hasKey = !!(await env.SHOP_KV.get(KV_KEY)); } catch (_) {}
  // якщо є секрет середовища — теж вважаємо що ключ заданий
  if (!hasKey && env.IMAGE_API_KEY) hasKey = true;
  return jsonResp({ ok: true, hasKey });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.SHOP_KV) return jsonResp({ ok: false, error: 'KV не налаштовано' }, 500);
  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }
  const key = (body && typeof body.key === 'string') ? body.key.trim() : '';
  try {
    if (key) await env.SHOP_KV.put(KV_KEY, key);
    else await env.SHOP_KV.delete(KV_KEY);
  } catch (e) {
    return jsonResp({ ok: false, error: 'Не вдалося зберегти: ' + (e.message || e) }, 500);
  }
  return jsonResp({ ok: true, hasKey: !!key });
}
