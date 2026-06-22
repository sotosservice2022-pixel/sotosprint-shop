// GET /og-image.jpg — динамічна картинка прев'ю для соцмереж (Open Graph / Twitter Card).
// Стабільний шлях (дозволений у robots.txt, на відміну від /api/storage/...), щоб краулери
// Facebook/Telegram/Viber могли її завантажити. Бере seoOgImage з налаштувань (R2),
// інакше — статичний фолбек og-image-default.jpg. Зміна в адмінці впливає БЕЗ деплою.
import { getSettings } from './_utils/shop.js';

export async function onRequestGet({ request, env }) {
  // Фолбек на статичний дефолт (іншою назвою, щоб ця функція мала пріоритет над статикою
  // саме для /og-image.jpg і не входила в рекурсію).
  const fallback = async () => {
    try {
      if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
        return await env.ASSETS.fetch(new URL('/og-image-default.jpg', request.url));
      }
    } catch (_) {}
    return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
  };

  try {
    const s = await getSettings(env);
    const raw = (s.seoOgImage || '').trim();
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
            'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
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
