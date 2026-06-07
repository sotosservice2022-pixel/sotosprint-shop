// POST /api/admin/promo-post — AI-генерація продаючого посту для Telegram-каналу / Instagram.
// Два режими (поле mode):
//   mode:'generate' (за замовч.) — пише підпис + хештеги за обраним товаром.
//     Тіло: { productId, platform?('telegram'|'instagram'), tone?('friendly'|'sale'|'premium'|'short'), extra? }
//     Повертає: { ok, caption, hashtags:[...], imageUrl }
//   mode:'send' — надсилає готовий пост (фото + текст) у Telegram-канал.
//     Тіло: { productId, text, target } (target = @username каналу або chat_id; бот має бути адміном каналу)
//     Повертає: { ok, sent:true }
import { checkAuthAsync, jsonResp, getProducts, getSettings, getBotConfig } from '../../_utils/shop.js';

function firstImageUrl(p) {
  const arr = Array.isArray(p?.images) ? p.images : (p?.image ? [p.image] : []);
  for (const it of arr) {
    const u = typeof it === 'string' ? it : (it && it.url);
    if (u) return u;
  }
  return '';
}
function absUrl(origin, u) {
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  return origin.replace(/\/$/, '') + (u.startsWith('/') ? u : '/' + u);
}

// --- Gemini text generation ---
async function geminiText(env, prompt) {
  let apiKey = env.IMAGE_API_KEY;
  if (!apiKey && env.SHOP_KV) {
    try { apiKey = await env.SHOP_KV.get('ai_image_key'); } catch (_) {}
  }
  if (!apiKey) throw new Error('AI-ключ не налаштовано: введи ключ Google AI Studio на сторінці «AI-обробка фото» (блок «Ключ Gemini») або додай секрет IMAGE_API_KEY.');
  const model = env.TEXT_API_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.9, responseMimeType: 'application/json' },
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Gemini ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
  return text;
}

// --- OpenAI GPT text generation ---
async function gptText(env, prompt) {
  let apiKey = env.OPENAI_API_KEY;
  if (!apiKey && env.SHOP_KV) {
    try { apiKey = await env.SHOP_KV.get('openai_image_key'); } catch (_) {}
  }
  if (!apiKey) throw new Error('GPT-ключ не налаштовано: введи ключ OpenAI на сторінці «AI-обробка фото» (блок «Ключ OpenAI (GPT)») або додай секрет OPENAI_API_KEY.');
  const model = env.TEXT_GPT_MODEL || 'gpt-4o-mini';
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Ти — SMM-копірайтер. Повертай відповідь СТРОГО у форматі JSON.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`GPT ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function generateText(env, engine, prompt) {
  return (engine === 'gpt') ? gptText(env, prompt) : geminiText(env, prompt);
}

function buildPrompt(p, settings, platform, tone, extra) {
  const shopName = settings?.title || 'магазин';
  const price = (p.price != null) ? `${p.price} ${p.currency || '₴'}` : '';
  const toneMap = {
    friendly: 'дружній, теплий, живий',
    sale: 'продаючий, з акцентом на вигоду та заклик купити зараз',
    premium: 'преміальний, лаконічний, з відчуттям якості',
    short: 'дуже короткий і чіпкий (1-2 речення)',
  };
  const plat = platform === 'instagram' ? 'Instagram' : 'Telegram-канал';
  return [
    `Ти — SMM-копірайтер українського онлайн-магазину «${shopName}».`,
    `Напиши пост для ${plat} про товар, щоб зацікавити і підштовхнути до покупки.`,
    `Стиль: ${toneMap[tone] || toneMap.friendly}.`,
    ``,
    `Товар:`,
    `- Назва: ${String(p.name || '').replace(/\s+/g, ' ').trim()}`,
    p.description ? `- Опис: ${String(p.description).replace(/\s+/g, ' ').trim()}` : '',
    price ? `- Ціна: ${price}` : '',
    extra ? `Додаткові побажання від продавця: ${extra}` : '',
    ``,
    `Вимоги:`,
    `- Мова: українська.`,
    `- Підпис (caption): 2-5 коротких рядків, можна з доречними емодзі, без вигаданих фактів і без вигаданих цін/знижок.`,
    `- Додай 5-10 релевантних хештегів українською/латиницею (без пробілів усередині, з #).`,
    `- Не використовуй Markdown-зірочки.`,
    ``,
    `Поверни СТРОГО JSON: {"caption": "текст підпису", "hashtags": ["#тег1", "#тег2"]}`,
  ].filter(Boolean).join('\n');
}

function parseResult(text) {
  let caption = '', hashtags = [];
  try {
    const j = JSON.parse(text);
    caption = String(j.caption || '').trim();
    hashtags = Array.isArray(j.hashtags) ? j.hashtags.map(h => String(h).trim()).filter(Boolean) : [];
  } catch (_) {
    // fallback: спробуємо витягнути JSON-фрагмент
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]);
        caption = String(j.caption || '').trim();
        hashtags = Array.isArray(j.hashtags) ? j.hashtags.map(h => String(h).trim()).filter(Boolean) : [];
      } catch (_) {}
    }
    if (!caption) caption = text.trim();
  }
  // нормалізуємо хештеги (мають починатись з #, без пробілів)
  hashtags = hashtags.map(h => h.startsWith('#') ? h : '#' + h).map(h => h.replace(/\s+/g, ''));
  return { caption, hashtags };
}

export async function onRequestPost({ request, env }) {
  try {
    if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

    const body = await request.json().catch(() => ({}));
    const mode = body.mode || 'generate';
    const origin = new URL(request.url).origin;

    const products = await getProducts(env);
    const product = products.find(p => p.id === body.productId);
    if (!product) return jsonResp({ ok: false, error: 'Товар не знайдено' }, 400);

    if (mode === 'send') {
      const text = String(body.text || '').trim();
      if (!text) return jsonResp({ ok: false, error: 'Порожній текст посту' }, 400);
      const target = String(body.target || '').trim();
      const bot = await getBotConfig(env);
      if (!bot.botToken) return jsonResp({ ok: false, error: 'Не налаштовано Telegram-бота (розділ «Безпека»).' }, 400);
      const chatId = target || bot.chatId;
      if (!chatId) return jsonResp({ ok: false, error: 'Вкажи канал (@username) або chat_id для відправки.' }, 400);

      const imgAbs = absUrl(origin, firstImageUrl(product));
      let tgResp;
      if (imgAbs) {
        tgResp = await fetch(`https://api.telegram.org/bot${bot.botToken}/sendPhoto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, photo: imgAbs, caption: text.slice(0, 1024) }),
        });
      } else {
        tgResp = await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: false }),
        });
      }
      const tgData = await tgResp.json().catch(() => ({}));
      if (!tgData.ok) {
        return jsonResp({ ok: false, error: 'Telegram: ' + (tgData.description || ('HTTP ' + tgResp.status) + '. Перевір, що бот доданий у канал як адмін.') }, 400);
      }
      return jsonResp({ ok: true, sent: true });
    }

    // mode === 'generate'
    const settings = await getSettings(env);
    const engine = (body.engine === 'gpt') ? 'gpt' : 'gemini';
    const prompt = buildPrompt(product, settings, body.platform, body.tone, String(body.extra || '').slice(0, 500));
    const raw = await generateText(env, engine, prompt);
    const { caption, hashtags } = parseResult(raw);
    if (!caption) return jsonResp({ ok: false, error: 'AI не повернув текст. Спробуй ще раз.' }, 502);

    return jsonResp({
      ok: true,
      caption,
      hashtags,
      imageUrl: firstImageUrl(product),
      productName: product.name,
      engine,
    });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message || String(e) }, 500);
  }
}
