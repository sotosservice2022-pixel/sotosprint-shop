// POST /api/admin/photo-describe — БЕЗКОШТОВНЕ авто-описання товару по фото.
// Використовує ТЕКСТОВУ модель Gemini (gemini-2.5-flash) — вона «бачить» фото і повертає
// ТЕКСТ (назву/опис/характеристики). Це НЕ генерація картинок, тому працює на безкоштовній
// квоті Gemini (на відміну від gemini-2.5-flash-image).
//
// Тіло JSON: { imageUrl: '/api/storage/<key>' | 'https://...' , model?: string }
// Повертає: { ok, name, description, attributes: [{label, value}] }
// Нічого не зберігає — рішення застосовувати поля приймає адмін у редакторі товару.
import { checkAuthAsync, jsonResp } from '../../_utils/shop.js';

function bufToB64(buf) {
  let bin = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Завантажуємо фото: спершу з R2 за ключем /api/storage/<key>, інакше — прямим fetch.
async function loadImage(env, request, imageUrl) {
  const m = String(imageUrl || '').match(/\/api\/storage\/(.+)$/);
  if (m && env.STORAGE) {
    try {
      const key = m[1].split('/').map(decodeURIComponent).join('/');
      const obj = await env.STORAGE.get(key);
      if (obj) return { buf: await obj.arrayBuffer(), ct: obj.httpMetadata?.contentType || 'image/jpeg' };
    } catch (_) {}
  }
  const abs = String(imageUrl || '').startsWith('http') ? imageUrl : new URL(request.url).origin + imageUrl;
  const r = await fetch(abs);
  if (!r.ok) throw new Error('Не вдалося завантажити фото (HTTP ' + r.status + ')');
  return { buf: await r.arrayBuffer(), ct: r.headers.get('content-type') || 'image/jpeg' };
}

const PROMPT =
  'Ти — копірайтер інтернет-магазину. Уважно роздивись фото товару (може бути й упаковка з текстом) ' +
  'і склади картку товару УКРАЇНСЬКОЮ мовою. ' +
  'Поверни СТРОГО JSON з полями: ' +
  '"name" — коротка чітка назва товару (до 80 символів, без вигаданих брендів, читай текст із упаковки якщо він видимий), ' +
  '"description" — продаючий опис 2–4 речення (проста мова, без води й без вигаданих характеристик), ' +
  '"attributes" — масив об\'єктів {label, value} з характеристиками, які ВИДНО на фото або впевнено відомі ' +
  '(напр. Матеріал, Колір, Призначення, Сумісність). Якщо характеристику не видно — НЕ вигадуй, пропусти. ' +
  'Не додавай нічого поза цими полями.';

const SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    attributes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { label: { type: 'string' }, value: { type: 'string' } },
        required: ['label', 'value'],
      },
    },
  },
  required: ['name', 'description', 'attributes'],
};

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }
  const imageUrl = body && body.imageUrl;
  if (!imageUrl) return jsonResp({ ok: false, error: 'Немає фото товару. Спершу додай хоча б одне зображення.' }, 400);

  // Ключ Gemini — той самий, що для генерації (KV ai_image_key / env IMAGE_API_KEY)
  let apiKey = env.IMAGE_API_KEY;
  if (!apiKey && env.SHOP_KV) {
    try { apiKey = await env.SHOP_KV.get('ai_image_key'); } catch (_) {}
  }
  if (!apiKey) return jsonResp({ ok: false, error: 'Не задано ключ Gemini (блок «🔑 Ключ Gemini» на сторінці AI-обробки фото).' }, 400);

  // ТЕКСТОВА модель (не -image!): безкоштовна квота є. Можна перевизначити.
  const reqModel = (body.model && String(body.model).trim()) || '';
  const safeModel = /^[a-z0-9][\w.\-:]{1,80}$/i.test(reqModel) ? reqModel : '';
  const model = safeModel || env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';

  try {
    const img = await loadImage(env, request, imageUrl);
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const reqBody = {
      contents: [{
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: img.ct || 'image/jpeg', data: bufToB64(img.buf) } },
        ],
      }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.4 },
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reqBody),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || ('HTTP ' + r.status);
      // 429 = вичерпана квота (безкоштовний текст теж має ліміти RPM/RPD)
      if (r.status === 429) return jsonResp({ ok: false, error: 'Ліміт запитів Gemini вичерпано. Зачекай хвилину і спробуй ще.' }, 429);
      return jsonResp({ ok: false, error: 'Gemini: ' + String(msg).slice(0, 300) }, 500);
    }
    const txt = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
    if (!txt) return jsonResp({ ok: false, error: 'Gemini не повернув відповідь (можливо, запит відхилено).' }, 500);
    let parsed;
    try { parsed = JSON.parse(txt); } catch { return jsonResp({ ok: false, error: 'Не вдалося розібрати відповідь Gemini.' }, 500); }

    const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 200) : '';
    const description = typeof parsed.description === 'string' ? parsed.description.trim().slice(0, 2000) : '';
    const attributes = Array.isArray(parsed.attributes)
      ? parsed.attributes
          .filter(a => a && typeof a.label === 'string' && typeof a.value === 'string')
          .map(a => ({ label: a.label.trim().slice(0, 100), value: a.value.trim().slice(0, 500) }))
          .filter(a => a.label && a.value)
          .slice(0, 30)
      : [];

    return jsonResp({ ok: true, name, description, attributes, model });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message || String(e) }, 500);
  }
}
