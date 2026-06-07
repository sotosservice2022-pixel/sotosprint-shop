// POST /api/admin/photo-regen — AI-пересоздання фото товару (студійна якість).
// Тіло JSON: {
//   sourceUrl: '/api/storage/<key>'   // вихідне фото (вже завантажене в R2)
//   prompt?: string                    // опис; якщо нема — дефолтний студійний
//   engine?: 'cloudflare' | 'premium'  // безкоштовний Workers AI FLUX або платний (Gemini)
//   width?, height?: number            // розмір (за замовч. 1024)
// }
// Повертає: { ok, url: '/api/storage/<newKey>' }
import { checkAuthAsync, jsonResp } from '../../_utils/shop.js';

const DEFAULT_PROMPT =
  'Professional e-commerce product photograph of this exact item. ' +
  'Keep the product shape, colors and any printed design EXACTLY as in the source image, unchanged. ' +
  'Place it on a pure white seamless studio background with a soft, subtle, realistic shadow beneath. ' +
  'Bright even studio lighting, sharp focus, high-resolution clean catalog product shot, centered.';

// base64 -> Uint8Array
function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
// ArrayBuffer -> base64
function bufToB64(buf) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function putToR2(env, bytes, contentType, prefix) {
  const ts = Date.now().toString(36);
  const rnd = Math.random().toString(36).slice(2, 7);
  const ext = contentType.includes('png') ? 'png' : (contentType.includes('webp') ? 'webp' : 'jpg');
  const key = `${ts}_${prefix}_${rnd}.${ext}`;
  await env.STORAGE.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { generatedBy: 'photo-regen', createdAt: new Date().toISOString() },
  });
  return '/api/storage/' + encodeURIComponent(key);
}

// Дістаємо вихідне фото з R2 за url виду /api/storage/<key>
async function loadSource(env, sourceUrl) {
  const m = String(sourceUrl || '').match(/\/api\/storage\/(.+)$/);
  if (!m) throw new Error('sourceUrl має бути виду /api/storage/<key>');
  const key = decodeURIComponent(m[1]);
  const obj = await env.STORAGE.get(key);
  if (!obj) throw new Error('Вихідне фото не знайдено в сховищі');
  const buf = await obj.arrayBuffer();
  const contentType = obj.httpMetadata?.contentType || 'image/jpeg';
  return { buf, contentType };
}

// --- Безкоштовний рушій: Cloudflare Workers AI FLUX (img2img) ---
async function runCloudflare(env, { buf, contentType }, prompt, width, height) {
  if (!env.AI) throw new Error('Workers AI не підключено (binding AI). Додай [ai] binding="AI" у wrangler.toml і задеплой.');
  const form = new FormData();
  form.append('input_image_0', new Blob([buf], { type: contentType || 'image/jpeg' }), 'src');
  form.append('prompt', prompt);
  form.append('width', String(width));
  form.append('height', String(height));
  form.append('steps', '25');
  // FLUX.2 на Workers AI приймає вхідні зображення лише через multipart-обгортку.
  const res = await env.AI.run('@cf/black-forest-labs/flux-2-dev', {
    multipart: { body: form, contentType: 'multipart/form-data' },
  });
  // Відповідь: base64 у полі image (різні версії можуть віддавати по-різному)
  let b64 = null;
  if (typeof res === 'string') b64 = res;
  else if (res && typeof res.image === 'string') b64 = res.image;
  else if (res && res.result && typeof res.result.image === 'string') b64 = res.result.image;
  if (!b64) throw new Error('FLUX не повернув зображення (несподіваний формат відповіді)');
  return { bytes: b64ToBytes(b64), contentType: 'image/png' };
}

// --- Платний рушій: Gemini image (якість як у Nano Banana) ---
async function runPremium(env, { buf, contentType }, prompt) {
  const apiKey = env.IMAGE_API_KEY;
  if (!apiKey) throw new Error('Преміум-рушій не налаштовано: додай секрет IMAGE_API_KEY (ключ Google AI Studio).');
  const model = env.IMAGE_API_MODEL || 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: contentType || 'image/jpeg', data: bufToB64(buf) } },
      ],
    }],
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Gemini API помилка ' + r.status + ': ' + txt.slice(0, 300));
  }
  const data = await r.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find(p => p.inline_data?.data || p.inlineData?.data);
  const b64 = imgPart?.inline_data?.data || imgPart?.inlineData?.data;
  if (!b64) throw new Error('Gemini не повернув зображення');
  const mime = imgPart?.inline_data?.mime_type || imgPart?.inlineData?.mimeType || 'image/png';
  return { bytes: b64ToBytes(b64), contentType: mime };
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 сховище не налаштовано' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }

  const sourceUrl = body.sourceUrl;
  const prompt = (body.prompt && String(body.prompt).trim()) || DEFAULT_PROMPT;
  const engine = body.engine === 'premium' ? 'premium' : 'cloudflare';
  let width = parseInt(body.width, 10); if (!(width >= 256 && width <= 2048)) width = 1024;
  let height = parseInt(body.height, 10); if (!(height >= 256 && height <= 2048)) height = 1024;

  try {
    const src = await loadSource(env, sourceUrl);
    const out = engine === 'premium'
      ? await runPremium(env, src, prompt)
      : await runCloudflare(env, src, prompt, width, height);
    const url = await putToR2(env, out.bytes, out.contentType, engine === 'premium' ? 'regen-pro' : 'regen-cf');
    return jsonResp({ ok: true, url, engine });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message || String(e) }, 500);
  }
}
