// functions/index.js — серверна підстановка og:image / twitter:image з налаштувань (KV).
// Навіщо: соцмережі (Telegram/Facebook/Viber) при генерації прев'ю читають СИРИЙ HTML і
// НЕ виконують JavaScript. Тому поле seoOgImage з адмінки підставляємо тут, на рівні
// Cloudflare Pages Function (HTMLRewriter), а не клієнтським JS — щоб воно працювало на 100%.
//
// Якщо seoOgImage порожнє — нічого не чіпаємо, лишається статичний <meta og:image> з index.html
// (за замовчуванням https://agprnt.com/og-image.jpg).
import { getSettings } from './_utils/shop.js';

export async function onRequest(context) {
  const { request, env } = context;
  const res = await context.next(); // віддає статичний index.html

  // Тільки GET та тільки HTML-відповідь
  if (request.method !== 'GET') return res;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  let ogImage = '';
  try {
    const s = await getSettings(env);
    ogImage = s && s.seoOgImage ? String(s.seoOgImage).trim() : '';
  } catch (_) {}

  if (!ogImage) return res; // поле не задане — лишаємо статичний тег

  return new HTMLRewriter()
    .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', ogImage); } })
    .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', ogImage); } })
    .transform(res);
}
