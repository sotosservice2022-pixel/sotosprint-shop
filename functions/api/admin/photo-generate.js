// POST /api/admin/photo-generate — генерація зображення за текстовим описом.
// Опціонально приймає фото-приклади (референси), щоб AI орієнтувався на стиль/ракурс.
// Тіло JSON: {
//   prompt: string                     // ОБОВ'ЯЗКОВО — опис, що згенерувати
//   refUrls?: string[]                 // 0+ референсних фото (вже в R2, /api/storage/<key>)
//   engine?: 'premium' | 'gpt' | 'cloudflare'  // Gemini, OpenAI GPT або безкоштовний FLUX.2 (Workers AI)
//   cfModel?: '4b' | '9b'              // модель FLUX для engine='cloudflare' (типово 4b)
//   model?, quality?, size?            // для GPT
// }
// Повертає: { ok, url: '/api/storage/<newKey>', engine }
import { checkAuthAsync, jsonResp, storageUrl } from '../../_utils/shop.js';

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
  const key = `ai/${ts}_${prefix}_${rnd}.${ext}`;
  await env.STORAGE.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { generatedBy: 'photo-generate', createdAt: new Date().toISOString() },
  });
  return storageUrl(key);
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

// --- Безкоштовний рушій: Cloudflare Workers AI — FLUX.2 [klein] ---
// Генерація за описом; референси (0..4) передаються як input_image_0..3.
// '4b' — швидка/дешева (сотні фото/день у безкоштовному ліміті), '9b' — якісніша (~7/день).
const CF_FLUX_MODELS = {
  '4b': '@cf/black-forest-labs/flux-2-klein-4b',
  '9b': '@cf/black-forest-labs/flux-2-klein-9b',
};

async function runCloudflareGen(env, prompt, refs, sizeStr, cfModel) {
  if (!env.AI) throw new Error('Workers AI не підключено (binding AI). Додай [ai] binding="AI" у wrangler.toml і задеплой.');
  const model = env.CF_IMAGE_MODEL || CF_FLUX_MODELS[cfModel] || CF_FLUX_MODELS['4b'];
  // Кроки: більше = чіткіше (ціна від кроків не залежить); 25 — з офіційного прикладу для 9B
  const defSteps = model.includes('9b') ? 25 : 15;
  let steps = env.CF_IMG_STEPS ? parseInt(env.CF_IMG_STEPS, 10) : defSteps;
  if (!(steps >= 1 && steps <= 30)) steps = defSteps;
  const m = /^(\d+)x(\d+)$/.exec(String(sizeStr || '1024x1024'));
  const width = m ? parseInt(m[1], 10) : 1024;
  const height = m ? parseInt(m[2], 10) : 1024;

  const callOnce = async () => {
    const form = new FormData();
    form.append('prompt', prompt);
    refs.slice(0, 4).forEach((ref, i) => {
      form.append('input_image_' + i, new Blob([ref.buf], { type: ref.contentType || 'image/jpeg' }), 'ref' + i + '.jpg');
    });
    form.append('steps', String(steps));
    form.append('width', String(width));
    form.append('height', String(height));
    const fr = new Response(form);
    const res = await env.AI.run(model, {
      multipart: { body: fr.body, contentType: fr.headers.get('content-type') },
    });
    if (res && typeof res.image === 'string') return { bytes: b64ToBytes(res.image), contentType: 'image/png' };
    if (typeof res === 'string') return { bytes: b64ToBytes(res), contentType: 'image/png' };
    let ab;
    if (res instanceof ArrayBuffer) ab = res;
    else if (res && typeof res.arrayBuffer === 'function') ab = await res.arrayBuffer();
    else ab = await new Response(res).arrayBuffer();
    if (!ab || ab.byteLength === 0) throw new Error('Порожня відповідь від моделі');
    return { bytes: new Uint8Array(ab), contentType: 'image/png' };
  };

  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await callOnce();
    } catch (e) {
      lastErr = e;
      const msg = String(e && e.message || e);
      if (/binding|no such model|invalid|required propert|allocation|limit/i.test(msg)) break;
      if (attempt < 3) await new Promise(r => setTimeout(r, 1200 * attempt));
    }
  }
  const lastMsg = String(lastErr && lastErr.message || lastErr);
  if (/allocation|limit|quota|429/i.test(lastMsg)) {
    throw new Error('Вичерпано безкоштовний денний ліміт Workers AI (оновлюється о 02:00 за Києвом). Спробуй завтра або переключись на Gemini/GPT.');
  }
  throw new Error('FLUX (Cloudflare) не зміг згенерувати зображення: ' + lastMsg + '. Спробуй ще раз або переключись на Gemini/GPT.');
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

// Дістати OpenAI-ключ (env або KV)
async function getOpenAIKey(env) {
  let apiKey = env.OPENAI_API_KEY;
  if (!apiKey && env.SHOP_KV) {
    try { apiKey = await env.SHOP_KV.get('openai_image_key'); } catch (_) {}
  }
  return apiKey;
}

// Нормалізація якості/розміру (спільна для всіх GPT-шляхів)
function normGptQS(quality, size, env) {
  const ALLOWED_QUALITY = ['low', 'medium', 'high', 'auto'];
  const ALLOWED_SIZE = ['1024x1024', '1024x1536', '1536x1024', 'auto'];
  // Дефолт якості — 'high', щоб результат був як у браузерному ChatGPT (раніше було 'medium' → гірше)
  let q = (quality || env.GPT_IMAGE_QUALITY || 'high').toLowerCase();
  if (!ALLOWED_QUALITY.includes(q)) q = 'high';
  let s = (size || env.GPT_IMAGE_SIZE || '1024x1024').toLowerCase();
  if (!ALLOWED_SIZE.includes(s)) s = '1024x1024';
  return { q, s };
}

// Витягти base64-зображення з відповіді Responses API (image_generation_call.result)
function imageFromResponses(data) {
  const out = Array.isArray(data?.output) ? data.output : [];
  for (const o of out) {
    if (o && (o.type === 'image_generation_call') && o.result) {
      return { bytes: b64ToBytes(o.result), contentType: 'image/png' };
    }
  }
  return null;
}

// --- OpenAI GPT: СТАРТ фонової генерації (Responses API + background mode) ---
// background:true → запит одразу повертає id зі статусом queued, не чекаючи картинку.
// Так HTTP-запит короткий і не впирається в таймаут шлюзу Cloudflare (~100с).
// GPT-4o «бачить» фото-приклад очима (vision) і генерує НОВЕ зображення «за мотивами»
// через інструмент image_generation — як браузерний ChatGPT, а не механічний /images/edits.
// Працює і з референсом (vision), і без (чиста генерація за текстом) — однаково.
async function startGPTBackground(env, prompt, refs, quality, size, modelOverride) {
  const apiKey = await getOpenAIKey(env);
  if (!apiKey) throw new Error('GPT-рушій не налаштовано: введи ключ OpenAI на сторінці (блок «Ключ OpenAI (GPT)») або додай секрет OPENAI_API_KEY.');
  const { q, s } = normGptQS(quality, size, env);
  // Модель-оркестратор — чат з vision (НЕ gpt-image-1, то модель інструмента).
  // Можна перевизначити з фронту (випадний список моделей) — лише безпечний формат id.
  const safeModel = modelOverride && /^[a-z0-9][\w.\-]{1,60}$/i.test(modelOverride) ? modelOverride : '';
  const orchModel = safeModel || env.GPT_ORCHESTRATOR_MODEL || 'gpt-5.4-mini';
  // Модель інструмента малювання (можна перевизначити секретом). За замовч. — найновіша gpt-image-2.
  const imgModel = env.GPT_IMAGE_MODEL || 'gpt-image-2';

  const content = [{ type: 'input_text', text: prompt }];
  for (const ref of refs) {
    const dataUrl = `data:${ref.contentType || 'image/png'};base64,${bufToB64(ref.buf)}`;
    content.push({ type: 'input_image', image_url: dataUrl });
  }
  const body = {
    model: orchModel,
    input: [{ role: 'user', content }],
    tools: [{ type: 'image_generation', model: imgModel, quality: q, size: s }],
    tool_choice: { type: 'image_generation' },
    background: true,
  };
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('OpenAI Responses: ' + ((data && data.error && data.error.message) || ('HTTP ' + r.status)));
  if (!data.id) throw new Error('OpenAI не повернув ідентифікатор завдання');
  return data.id;
}

// --- OpenAI GPT: ОПИТУВАННЯ фонового завдання ---
// Повертає { status: 'completed', img } | { status: 'pending' }; кидає при failed/cancelled.
async function pollGPTBackground(env, jobId) {
  const apiKey = await getOpenAIKey(env);
  if (!apiKey) throw new Error('GPT-рушій не налаштовано: введи ключ OpenAI.');
  const r = await fetch('https://api.openai.com/v1/responses/' + encodeURIComponent(jobId), {
    method: 'GET', headers: { 'Authorization': 'Bearer ' + apiKey },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('OpenAI Responses: ' + ((data && data.error && data.error.message) || ('HTTP ' + r.status)));
  const status = data.status; // queued | in_progress | completed | failed | incomplete | cancelled
  if (status === 'completed') {
    const img = imageFromResponses(data);
    if (!img) throw new Error('OpenAI не повернув зображення (можливо, запит відхилено політикою). Спробуй інакший опис.');
    return { status: 'completed', img };
  }
  if (status === 'failed' || status === 'incomplete' || status === 'cancelled') {
    const msg = (data && data.error && data.error.message)
      || (data && data.incomplete_details && data.incomplete_details.reason)
      || ('статус: ' + status);
    throw new Error('Генерація не вдалась: ' + msg);
  }
  return { status: 'pending' }; // queued / in_progress
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 сховище не налаштовано' }, 500);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалідний JSON' }, 400); }

  const prefixMap = { premium: 'gen-pro', gpt: 'gen-gpt', cloudflare: 'gen-cf' };

  // === ОПИТУВАННЯ фонового GPT-завдання (action:'poll', jobId) ===
  // Кожен запит короткий → не впирається в таймаут шлюзу. Коли completed — зберігаємо
  // картинку в R2 і повертаємо url. Поки pending — клієнт опитує далі.
  if (body.action === 'poll') {
    const jobId = (body.jobId && String(body.jobId).trim()) || '';
    if (!jobId) return jsonResp({ ok: false, error: 'Немає jobId' }, 400);
    try {
      const res = await pollGPTBackground(env, jobId);
      if (res.status === 'completed') {
        const url = await putToR2(env, res.img.bytes, res.img.contentType, prefixMap.gpt);
        return jsonResp({ ok: true, status: 'completed', url, engine: 'gpt' });
      }
      return jsonResp({ ok: true, status: 'pending' });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message || String(e) }, 500);
    }
  }

  const prompt = (body.prompt && String(body.prompt).trim()) || '';
  if (!prompt) return jsonResp({ ok: false, error: 'Вкажи опис зображення (поле «Опис»)' }, 400);

  const engine = ['gpt', 'cloudflare'].includes(body.engine) ? body.engine : 'premium';
  const refUrls = Array.isArray(body.refUrls) ? body.refUrls.slice(0, 4) : [];

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
    const gptQuality = (body.quality && String(body.quality).trim()) || '';
    const gptModel = (body.model && String(body.model).trim()) || '';
    const gptSize = FORMAT_TO_SIZE[format];

    // GPT → запускаємо фонове завдання, одразу повертаємо jobId (клієнт опитує poll)
    if (engine === 'gpt') {
      const jobId = await startGPTBackground(env, prompt, refs, gptQuality, gptSize, gptModel);
      return jsonResp({ ok: true, status: 'pending', jobId, engine: 'gpt' });
    }
    // Безкоштовний FLUX.2 (Workers AI) → синхронно (klein швидка, у таймаут вкладається)
    if (engine === 'cloudflare') {
      const cfModel = (body.cfModel === '9b') ? '9b' : '4b';
      const out = await runCloudflareGen(env, prompt, refs, FORMAT_TO_SIZE[format], cfModel);
      const url = await putToR2(env, out.bytes, out.contentType, prefixMap.cloudflare);
      return jsonResp({ ok: true, status: 'completed', url, engine: 'cloudflare' });
    }
    // Gemini → синхронно (швидкий, у таймаут вкладається)
    const out = await runPremium(env, prompt, refs, FORMAT_TO_AR[format]);
    const url = await putToR2(env, out.bytes, out.contentType, prefixMap.premium);
    return jsonResp({ ok: true, status: 'completed', url, engine: 'premium' });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message || String(e) }, 500);
  }
}
