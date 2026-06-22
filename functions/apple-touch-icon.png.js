// GET /apple-touch-icon.png — динамічна іконка застосунку/сайту.
// Саме її Google найчастіше бере для іконки сайту у видачі, а iOS — для ярлика на робочому столі.
// Тому віддаємо її з налаштувань (pwaIconImage → faviconImage), щоб зміна в адмінці впливала
// і на Google, і на iOS БЕЗ редеплою. Якщо нічого не задано — статичний файл-фолбек.
import { getSettings } from './_utils/shop.js';

export async function onRequestGet({ request, env }) {
  // Фолбек на статичний дефолтний файл (іншою назвою, щоб ця функція мала пріоритет над статикою
  // саме для /apple-touch-icon.png і не входила в рекурсію).
  const fallback = async () => {
    try {
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        return await env.ASSETS.fetch(new URL('/apple-touch-icon-default.png', request.url));
      }
    } catch (_) {}
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  };

  try {
    const s = await getSettings(env);
    // Пріоритет: окрема іконка застосунку (PWA), потім favicon. data:-URL не віддаємо файлом.
    const raw = (s.pwaIconImage || s.faviconImage || '').trim();
    if (!raw || raw.startsWith('data:')) return fallback();

    // Файл із нашого R2 — віддаємо напряму (без редіректу)
    const m = raw.match(/^\/api\/storage\/(.+)$/);
    if (m && env.STORAGE) {
      const key = decodeURIComponent(m[1]);
      const obj = await env.STORAGE.get(key);
      if (obj) {
        return new Response(obj.body, {
          status: 200,
          headers: {
            'Content-Type': obj.httpMetadata?.contentType || 'image/png',
            'Cache-Control': 'public, max-age=3600', // 1 година — швидко підхоплює заміну
          },
        });
      }
      return fallback(); // ключ зник — краще статика, ніж 404
    }

    // Зовнішній URL — редірект
    return Response.redirect(raw.startsWith('http') ? raw : new URL(raw, new URL(request.url).origin).toString(), 302);
  } catch (_) {
    return fallback();
  }
}
