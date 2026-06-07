// POST /api/admin/photo-generate — генерація зображення за текстовим описом.
// Опціонально приймає фото-приклади (референси), щоб AI орієнтувався на стиль/ракурс.
// Тіло JSON: {
//   prompt: string                     // ОБОВ'ЯЗКОВО — опис, що згенерувати
//   refUrls?: string[]                 // 0+ референсних фото (вже в R2, /api/storage/<key>)
//   engine?: 'premium' | 'gpt'         // Gemini (премиум) або OpenAI GPT
//   model?, quality?, size?            // для GPT
// }
// Повертає: { ok, url: '/api/storage/<newKey>', engine }
import { checkAuthAsync, jsonResp } from '../../_utils/shop.js';

function b64ToBytes(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
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
    customMetadata: { generatedBy: 'photo-generate', createdAt: new Date().toISOString() },
  });
  return '/api/storage/' + encodeURIComponent(key);
}

// Дістаємо референсне фото з R2 за url виду /api/storage/<key>
async function loadRef(env, url) {
  const m = String(url || '').match(/\/api\/storage\/(.+)$/);
  if (!m) return null;
  const key = decodeURIComponent(m[1]);
  const obj = await env.STORAGE.get(key);
  if (!obj) return null;
  const buf = await obj.arrayBuffer();
  const contentType = obj.httpMetadata?.contentType || 'image/jpeg';
  return { buf, contentType };
}

// --- Gemini: генерація (текст + опціональні референси) ---
async function runPremium(env, prompt, refs, aspectRatio) {
  let apiKey = env.IMAGE_API_KEY;
  if (!apiKey && env.SHOP_KV) {
    try { apiKey = await env.SHOP_KV.get('ai_image_key'); } catch (_) {}
  }
  if (!apiKey) throw new Error('Преміум-рушій не налаштовано: введи ключ Google AI Studio на сторінці (блок «Ключ Gemini») або додай секрет IMAGE_API_KEY.');
  const model = env.IMAGE_API_MODEL || 'gemini-2.5-flash-image';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const parts = [{ text: prompt }];
  for (const ref of refs) {
    parts.push({ inline_data: { mime_type: ref.contentType || 'image/jpeg', data: bufToB64(ref.buf) } });
  }
  const baseBody = { contents: [{ parts }] };

  const callGemini = async (withAspect) => {
    const body = withAspect
      ? { ...baseBody, generationConfig: { imageConfig: { aspectRatio: withAspect } } }
      : baseBody;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  };

  // Пробуємо із заданим співвідношенням (A4 → 3:4 / 4:3). Якщо модель не підтримує параметр — повтор без нього.
  let r = await callGemini(aspectRatio && aspectRatio !== '1:1' ? aspectRatio : null);
  if (!r.ok && aspectRatio && aspectRatio !== '1:1') {
    r = await callGemini(null);
  }
  if (!r.ok) {
    const txt = await r.text();
    throw new Error('Gemini API помилка ' + r.status + ': ' + txt.slice(0, 300));
  }
  const data = await r.json();
  const cparts = data?.candidates?.[0]?.content?.parts || [];
  const imgPart = cparts.find(p => p.inline_data?.data || p.inlineData?.data);
  const b64 = imgPart?.inline_data?.data || imgPart?.inlineData?.data;
  if (!b64) throw new Error('Gemini не повернув зображення (можливо, запит відхилено політикою). Спробуй інакший опис.');
  const mime = imgPart?.inline_data?.mime_type || imgPart?.inlineData?.mimeType || 'image/png';
  return { bytes: b64ToBytes(b64), contentType: mime };
}

// --- OpenAI GPT: генерація (generations) або з референсом (edits) ---
async function runGPT(env, prompt, refs, modelOverride, quality, size) {
  let apiKey = env.OPENAI_API_KEY;
  if (!apiKey && env.SHOP_KV) {
    try { apiKey = await env.SHOP_KV.get('openai_image_key'); } catch (_) {}
  }
  if (!apiKey) throw new Error('GPT-рушій не налаштовано: введи ключ OpenAI на сторінці (блок «Ключ OpenAI (GPT)») або додай секрет OPENAI_API_KEY.');

  let model = env.GPT_IMAGE_MODEL || 'gpt-image-1';
  if (modelOverride && /^(gpt-image|dall-e)[\w.\-]*$/i.test(modelOverride)) model = modelOverride;

  const ALLOWED_QUALITY = ['low', 'medium', 'high', 'auto'];
  const ALLOWED_SIZE = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
  let q = (quality || env.GPT_IMAGE_QUALITY || 'medium').toLowerCase();
  if (!ALLOWED_QUALITY.includes(q)) q = 'medium';
  let s = (size || env.GPT_IMAGE_SIZE || '1024x1024').toLowerCase();
  if (!ALLOWED_SIZE.includes(s)) s = '1024x1024';

  let data;
  if (refs.length) {
    // з референсом — endpoint edits (перший приклад як основа)
    const form = new FormData();
    form.append('model', model);
    form.append('image', new Blob([refs[0].buf], { type: refs[0].contentType || 'image/png' }), 'ref.png');
    form.append('prompt', prompt);
    form.append('size', s);
    form.append('quality', q);
    form.append('n', '1');
    const r = await fetch('https://api.openai.com/v1/images/edits', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + apiKey }, body: form,
    });
    data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('OpenAI: ' + ((data && data.error && data.error.message) || ('HTTP ' + r.status)));
  } else {
    // чиста генерація за текстом — endpoint generations
    const r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, size: s, quality: q, n: 1 }),
    });
    data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('OpenAI: ' + ((data && data.error && data.error.message) || ('HTTP ' + r.status)));
  }
  const item0 = data?.data?.[0] || {};
  if (item0.b64_json) return { bytes: b64ToBytes(item0.b64_json), contentType: 'image/png' };
  if (item0.url) {
    // деякі моделі повертають url замість b64 — підвантажуємо
    const ir = await fetch(item0.url);
    if (!ir.ok) throw new Error('Не вдалося завантажити згенероване зображення');
    const ab = await ir.arrayBuffer();
    const ct = ir.headers.get('content-type') || 'image/png';
    return { bytes: new Uint8Array(ab), contentType: ct };
  }
  throw new Error('OpenAI не повернув зображення');
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 сховище не налаштовано' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }

  const prompt = (body.prompt && String(body.prompt).trim()) || '';
  if (!prompt) return jsonResp({ ok: false, error: 'Вкажи опис зображення (поле «Опис»)' }, 400);

  const engine = (body.engine === 'gpt') ? 'gpt' : 'premium';
  const refUrls = Array.isArray(body.refUrls) ? body.refUrls.slice(0, 4) : [];
  const prefixMap = { premium: 'gen-pro', gpt: 'gen-gpt' };

  // Формат/орієнтація: квадрат | A4 книжкова (вертикальна) | A4 альбомна (горизонтальна)
  const FORMAT_TO_SIZE = { square: '1024x1024', a4p: '1024x1536', a4l: '1536x1024' };
  const FORMAT_TO_AR = { square: '1:1', a4p: '3:4', a4l: '4:3' };
  const format = ['square', 'a4p', 'a4l'].includes(body.format) ? body.format : 'square';

  try {
    const refs = [];
    for (const u of refUrls) {
      const ref = await loadRef(env, u);
      if (ref) refs.push(ref);
    }
    const modelOverride = (body.model && String(body.model).trim()) || '';
    const gptQuality = (body.quality && String(body.quality).trim()) || '';
    // Розмір беремо з формату (єдине джерело правди для режиму «Створення»)
    const gptSize = FORMAT_TO_SIZE[format];
    let out;
    if (engine === 'gpt') out = await runGPT(env, prompt, refs, modelOverride, gptQuality, gptSize);
    else out = await runPremium(env, prompt, refs, FORMAT_TO_AR[format]);
    const url = await putToR2(env, out.bytes, out.contentType, prefixMap[engine]);
    return jsonResp({ ok: true, url, engine });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message || String(e) }, 500);
  }
}
