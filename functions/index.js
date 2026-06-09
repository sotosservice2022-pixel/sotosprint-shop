// functions/index.js — серверна підстановка SEO-полів з налаштувань (KV).
// Навіщо: пошуковики (Google) та соцмережі (Telegram/Facebook/Viber) при індексації/генерації
// прев'ю читають СИРИЙ HTML і НЕ виконують JavaScript. Тому SEO-поля з адмінки
// (seoTitle / seoDescription / seoKeywords / seoOgImage) підставляємо тут, на рівні
// Cloudflare Pages Function (HTMLRewriter), а не клієнтським JS — щоб працювало на 100%.
//
// Якщо відповідне поле порожнє — тег не чіпаємо, лишається статичне значення з index.html.
import { getSettings } from './_utils/shop.js';

export async function onRequest(context) {
  const { request, env } = context;
  const res = await context.next(); // віддає статичний index.html

  // Тільки GET та тільки HTML-відповідь
  if (request.method !== 'GET') return res;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  let s = null;
  try { s = await getSettings(env); } catch (_) {}
  if (!s) return res;

  const seoTitle    = s.seoTitle       ? String(s.seoTitle).trim()       : '';
  const seoDesc     = s.seoDescription ? String(s.seoDescription).trim() : '';
  const seoKeywords = s.seoKeywords    ? String(s.seoKeywords).trim()    : '';
  const ogImage     = s.seoOgImage     ? String(s.seoOgImage).trim()     : '';

  // Нічого не задано — лишаємо статичні теги без змін
  if (!seoTitle && !seoDesc && !seoKeywords && !ogImage) return res;

  let rw = new HTMLRewriter();

  if (seoTitle) {
    rw = rw
      .on('title', { element(el) { el.setInnerContent(seoTitle); } })
      .on('meta[property="og:title"]', { element(el) { el.setAttribute('content', seoTitle); } })
      .on('meta[name="twitter:title"]', { element(el) { el.setAttribute('content', seoTitle); } });
  }

  if (seoDesc) {
    rw = rw
      .on('meta[name="description"]', { element(el) { el.setAttribute('content', seoDesc); } })
      .on('meta[property="og:description"]', { element(el) { el.setAttribute('content', seoDesc); } })
      .on('meta[name="twitter:description"]', { element(el) { el.setAttribute('content', seoDesc); } });
  }

  if (seoKeywords) {
    rw = rw.on('meta[name="keywords"]', { element(el) { el.setAttribute('content', seoKeywords); } });
  }

  if (ogImage) {
    rw = rw
      .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', ogImage); } })
      .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', ogImage); } });
  }

  return rw.transform(res);
}
