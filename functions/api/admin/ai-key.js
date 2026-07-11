// /api/admin/ai-key — зберігання ключів для преміум-рушіїв обробки фото.
// provider: 'gemini' (за замовч.) -> KV 'ai_image_key' / env IMAGE_API_KEY
//           'openai'              -> KV 'openai_image_key' / env OPENAI_API_KEY
// GET  ?provider=...        -> { ok, provider, hasKey }   // не повертає сам ключ
// POST { key, provider }    -> { ok, hasKey }             // порожній key видаляє
// Ключі зберігаються ТІЛЬКИ в KV і ніколи не повертаються у вітрину/клієнт.
import { checkAuthAsync, jsonResp } from '../../_utils/shop.js';

const PROVIDERS = {
  gemini: { kv: 'ai_image_key', env: 'IMAGE_API_KEY' },
  openai: { kv: 'openai_image_key', env: 'OPENAI_API_KEY' },
  modelscope: { kv: 'modelscope_image_key', env: 'MODELSCOPE_API_KEY' },
};

function resolveProvider(p) {
  return PROVIDERS[(p || 'gemini').toLowerCase()] ? (p || 'gemini').toLowerCase() : 'gemini';
}

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  const provider = resolveProvider(new URL(request.url).searchParams.get('provider'));
  const cfg = PROVIDERS[provider];
  let hasKey = false;
  if (env.SHOP_KV) { try { hasKey = !!(await env.SHOP_KV.get(cfg.kv)); } catch (_) {} }
  if (!hasKey && env[cfg.env]) hasKey = true;
  return jsonResp({ ok: true, provider, hasKey });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.SHOP_KV) return jsonResp({ ok: false, error: 'KV не налаштовано' }, 500);
  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }
  const provider = resolveProvider(body && body.provider);
  const cfg = PROVIDERS[provider];
  const key = (body && typeof body.key === 'string') ? body.key.trim() : '';
  try {
    if (key) await env.SHOP_KV.put(cfg.kv, key);
    else await env.SHOP_KV.delete(cfg.kv);
  } catch (e) {
    return jsonResp({ ok: false, error: 'Не вдалося зберегти: ' + (e.message || e) }, 500);
  }
  return jsonResp({ ok: true, provider, hasKey: !!key });
}
