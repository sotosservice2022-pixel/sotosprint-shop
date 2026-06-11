// GET /favicon.ico — динамічна іконка вкладки.
// Потрібно для сторінок БЕЗ власного HTML (наприклад, фото з R2 відкрите в новій вкладці):
// браузер у таких випадках сам запитує /favicon.ico. Віддаємо іконку з налаштувань
// (faviconImage), щоб скрізь була актуальна, а не стара закешована.
import { getSettings } from './_utils/shop.js';

export async function onRequestGet({ request, env }) {
  try {
    const s = await getSettings(env);
    const fav = (s.faviconImage || '').trim();
    if (!fav || fav.startsWith('data:')) {
      return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'public, max-age=300' } });
    }

    // Файл із нашого сховища — віддаємо напряму з R2 (без зайвого редіректу)
    const m = fav.match(/^\/api\/storage\/(.+)$/);
    if (m && env.STORAGE) {
      const key = decodeURIComponent(m[1]);
      const obj = await env.STORAGE.get(key);
      if (obj) {
        return new Response(obj.body, {
          status: 200,
          headers: {
            'Content-Type': obj.httpMetadata?.contentType || 'image/png',
            'Cache-Control': 'public, max-age=3600', // 1 година — щоб заміна іконки підхоплювалась швидко
          },
        });
      }
    }

    // Зовнішній URL — редірект
    return Response.redirect(fav.startsWith('http') ? fav : new URL(fav, new URL(request.url).origin).toString(), 302);
  } catch (e) {
    return new Response('Error', { status: 500 });
  }
}
