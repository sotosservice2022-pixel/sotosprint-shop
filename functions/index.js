// functions/index.js — серверна підстановка SEO-тегів (title / description / keywords /
// og:* / twitter:*) та og:image з налаштувань (KV).
//
// Навіщо: пошукові системи (Google/Bing) та соцмережі (Telegram/Facebook/Viber) при
// індексації та генерації прев'ю читають СИРИЙ HTML і НЕ виконують JavaScript надійно.
// Тому поля SEO з адмінки (seoTitle, seoDescription, seoKeywords, seoOgImage) підставляємо
// тут, на рівні Cloudflare Pages Function (HTMLRewriter), а не клієнтським JS — щоб Google
// бачив саме те, що задано в адмінці, а не статичні дефолти з index.html.
//
// Якщо відповідне поле порожнє — нічого не чіпаємо, лишається статичний тег з index.html
// (за замовчуванням заголовок "AGPRNT — ..." та https://agprnt.com/og-image.jpg).
import { getSettings, stripTags } from './_utils/shop.js';

export async function onRequest(context) {
  const { request, env } = context;
  const res = await context.next(); // віддає статичний index.html

  // Тільки GET та тільки HTML-відповідь
  if (request.method !== 'GET') return res;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  let s = null;
  try {
    s = await getSettings(env);
  } catch (_) {}
  if (!s) return res;

  const title = s.seoTitle ? stripTags(s.seoTitle) : '';
  const description = s.seoDescription ? stripTags(s.seoDescription) : '';
  const keywords = s.seoKeywords ? String(s.seoKeywords).trim() : '';
  const ogImage = s.seoOgImage ? String(s.seoOgImage).trim() : '';
  // Кастомний фавікон з адмінки (Зовнішній вигляд → Favicon). Підставляємо у сирий HTML,
  // бо Google не виконує JS і не приймає data:-URI — лише реальні URL.
  const favicon = (s.faviconImage && !String(s.faviconImage).startsWith('data:')) ? String(s.faviconImage).trim() : '';

  // Якщо жодне поле не задане — нічого не переписуємо
  if (!title && !description && !keywords && !ogImage && !favicon) return res;

  let rw = new HTMLRewriter();

  if (title) {
    rw = rw
      .on('title', { element(el) { el.setInnerContent(title); } })
      .on('meta[property="og:title"]', { element(el) { el.setAttribute('content', title); } })
      .on('meta[name="twitter:title"]', { element(el) { el.setAttribute('content', title); } });
  }

  if (description) {
    rw = rw
      .on('meta[name="description"]', { element(el) { el.setAttribute('content', description); } })
      .on('meta[property="og:description"]', { element(el) { el.setAttribute('content', description); } })
      .on('meta[name="twitter:description"]', { element(el) { el.setAttribute('content', description); } });
  }

  if (keywords) {
    rw = rw.on('meta[name="keywords"]', { element(el) { el.setAttribute('content', keywords); } });
  }

  if (ogImage) {
    rw = rw
      .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', ogImage); } })
      .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', ogImage); } });
  }

  if (favicon) {
    // ВАЖЛИВО: для пошукових систем НЕ підставляємо пряме посилання на /api/storage/...,
    // бо воно заблоковане в robots.txt (Disallow: /api/) — Googlebot не може його завантажити
    // і показує стару закешовану іконку. Натомість віддаємо стабільний /favicon.ico
    // (functions/favicon.ico.js динамічно віддає поточну іконку з налаштувань, цей шлях
    // дозволений у robots.txt). Стабільний URL також кращий для кешу фавікона Google.
    rw = rw.on('link[rel="icon"]', { element(el) { el.setAttribute('href', '/favicon.ico'); el.removeAttribute('type'); } });
  }

  return rw.transform(res);
}
