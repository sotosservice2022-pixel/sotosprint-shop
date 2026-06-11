// POST /api/admin/photo-regen — AI-пересоздання фото товару (студійна якість).
// Тіло JSON: {
//   sourceUrl: '/api/storage/<key>'   // вихідне фото (вже завантажене в R2)
//   prompt?: string                    // опис; якщо нема — дефолтний студійний
//   engine?: 'cloudflare' | 'premium'  // безкоштовний Workers AI FLUX або платний (Gemini)
//   width?, height?: number            // розмір (за замовч. 1024)
// }
// Повертає: { ok, url: '/api/storage/<newKey>' }
import { checkAuthAsync, jsonResp, storageUrl } from '../../_utils/shop.js';

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
  const key = `ai/${ts}_${prefix}_${rnd}.${ext}`;
  await env.STORAGE.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { generatedBy: 'photo-regen', createdAt: new Date().toISOString() },
  });
  return storageUrl(key);
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

// --- Безкоштовний рушій: Cloudflare Workers AI — Stable Diffusion XL (img2img) ---
// Стабільна GA-модель (на відміну від beta FLUX, що віддавав 3043). Вхід — байти фото <=1024px.
// Налаштування через env: CF_IMAGE_MODEL, CF_IMG_STRENGTH (0..1), CF_IMG_STEPS (<=20).
async function runCloudflare(env, src, prompt, width, height) {
  if (!env.AI) throw new Error('Workers AI не підключено (binding AI). Додай [ai] binding="AI" у wrangler.toml і задеплой.');
  const model = env.CF_IMAGE_MODEL || '@cf/runwayml/stable-diffusion-v1-5-img2img';
  let strength = env.CF_IMG_STRENGTH ? parseFloat(env.CF_IMG_STRENGTH) : 0.6;
  if (!(strength > 0 && strength <= 1)) strength = 0.6;
  let steps = env.CF_IMG_STEPS ? parseInt(env.CF_IMG_STEPS, 10) : 20;
  if (!(steps >= 1 && steps <= 20)) steps = 20;

  const imageBytes = Array.from(new Uint8Array(src.buf)); // сирі байти файлу (JPEG/PNG)

  const callOnce = async () => {
    const inputs = {
      prompt,
      negative_prompt: 'blurry, low quality, distorted, deformed, watermark, text, logo, extra objects, cropped',
      image: imageBytes,
      strength,
      num_steps: steps,
      guidance: 7.5,
    };
    // SDXL повертає бінарний потік PNG
    const res = await env.AI.run(model, inputs);
    let ab;
    if (res instanceof ArrayBuffer) ab = res;
    else if (res && typeof res.arrayBuffer === 'function') ab = await res.arrayBuffer();
    else if (res && (res.body || typeof res.getReader === 'function')) ab = await new Response(res).arrayBuffer();
    else if (typeof res === 'string') return { bytes: b64ToBytes(res), contentType: 'image/png' };
    else if (res && typeof res.image === 'string') return { bytes: b64ToBytes(res.image), contentType: 'image/png' };
    else ab = await new Response(res).arrayBuffer();
    if (!ab || ab.byteLength === 0) throw new Error('Порожня відповідь від моделі');
    return { bytes: new Uint8Array(ab), contentType: 'image/png' };
  };

  // Ретраї на тимчасові помилки моделі (3043 Internal server error тощо)
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await callOnce();
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message || e);
      // не ретраїмо явно фатальні помилки конфігурації
      if (/binding|no such model|invalid|required propert/i.test(msg)) break;
      if (attempt < 3) await new Promise(r => setTimeout(r, 1200 * attempt));
    }
  }
  throw new Error('Cloudflare Stable Diffusion не зміг обробити фото після кількох спроб: ' + (lastErr && lastErr.message || lastErr) + '. Спробуй ще раз або переключись на Преміум.');
}

// --- Платний рушій: Gemini image (якість як у Nano Banana) ---
async function runPremium(env, { buf, contentType }, prompt) {
  // Ключ: спочатку секрет IMAGE_API_KEY, інакше — збережений в адмінці (KV ai_image_key)
  let apiKey = env.IMAGE_API_KEY;
  if (!apiKey && env.SHOP_KV) {
    try { apiKey = await env.SHOP_KV.get('ai_image_key'); } catch (_) {}
  }
  if (!apiKey) throw new Error('Преміум-рушій не налаштовано: введи ключ Google AI Studio на сторінці (блок «Ключ Gemini») або додай секрет IMAGE_API_KEY.');
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

// --- Платний рушій: OpenAI GPT Image (gpt-image-1, edits) ---
async function runGPT(env, { buf, contentType }, prompt, modelOverride, quality, size) {
  // Ключ: спочатку секрет OPENAI_API_KEY, інакше — збережений в адмінці (KV openai_image_key)
  let apiKey = env.OPENAI_API_KEY;
  if (!apiKey && env.SHOP_KV) {
    try { apiKey = await env.SHOP_KV.get('openai_image_key'); } catch (_) {}
  }
  if (!apiKey) throw new Error('GPT-рушій не налаштовано: введи ключ OpenAI на сторінці (блок «Ключ OpenAI (GPT)») або додай секрет OPENAI_API_KEY.');

  // модель можна перевизначити з фронту (поле «Модель GPT»), але лише безпечний формат
  let model = env.GPT_IMAGE_MODEL || 'gpt-image-1';
  if (modelOverride && /^(gpt-image|dall-e)[\w.\-]*$/i.test(modelOverride)) model = modelOverride;

  // якість і розмір можна задати з фронту (дешевше/швидше = low + менший розмір)
  const ALLOWED_QUALITY = ['low', 'medium', 'high', 'auto'];
  const ALLOWED_SIZE = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
  let q = (quality || env.GPT_IMAGE_QUALITY || 'medium').toLowerCase();
  if (!ALLOWED_QUALITY.includes(q)) q = 'medium';
  let s = (size || env.GPT_IMAGE_SIZE || '1024x1024').toLowerCase();
  if (!ALLOWED_SIZE.includes(s)) s = '1024x1024';

  const form = new FormData();
  form.append('model', model);
  form.append('image', new Blob([buf], { type: contentType || 'image/png' }), 'src.png');
  form.append('prompt', prompt);
  form.append('size', s);
  form.append('quality', q);
  form.append('n', '1');

  const r = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey },
    body: form,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const m = (data && data.error && data.error.message) || ('HTTP ' + r.status);
    throw new Error('OpenAI: ' + m);
  }
  const b64 = data?.data?.[0]?.b64_json;
  if (!b64) throw new Error('OpenAI не повернув зображення');
  return { bytes: b64ToBytes(b64), contentType: 'image/png' };
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 сховище не налаштовано' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }

  const sourceUrl = body.sourceUrl;
  const prompt = (body.prompt && String(body.prompt).trim()) || DEFAULT_PROMPT;
  const allowed = ['premium', 'gpt', 'cloudflare'];
  const engine = allowed.includes(body.engine) ? body.engine : 'premium';
  let width = parseInt(body.width, 10); if (!(width >= 256 && width <= 2048)) width = 1024;
  let height = parseInt(body.height, 10); if (!(height >= 256 && height <= 2048)) height = 1024;
  const prefixMap = { premium: 'regen-pro', gpt: 'regen-gpt', cloudflare: 'regen-cf' };

  try {
    const src = await loadSource(env, sourceUrl);
    const modelOverride = (body.model && String(body.model).trim()) || '';
    const gptQuality = (body.quality && String(body.quality).trim()) || '';
    const gptSize = (body.size && String(body.size).trim()) || '';
    let out;
    if (engine === 'gpt') out = await runGPT(env, src, prompt, modelOverride, gptQuality, gptSize);
    else if (engine === 'premium') out = await runPremium(env, src, prompt);
    else out = await runCloudflare(env, src, prompt, width, height);
    const url = await putToR2(env, out.bytes, out.contentType, prefixMap[engine]);
    return jsonResp({ ok: true, url, engine });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message || String(e) }, 500);
  }
}
