// GET /product/<id> — повна сторінка товару (режим productPageMode === 'page').
// Віддає той самий index.html (SPA сам відрендерить товар за шляхом), але з підставленими
// SEO-тегами КОНКРЕТНОГО товару (title / description / og:* / twitter:*), щоб пошук і соцмережі
// бачили правильне прев'ю. Якщо щось піде не так — м'який фолбек на /?product=<id>.
import { getProducts, getSettings, storageUrl, stripTags } from '../_utils/shop.js';

// Перше фото товару → абсолютний URL для og:image
function firstImageUrl(p, origin) {
  const raw = (p.images && p.images.length) ? p.images[0] : (p.image || '');
  let u = typeof raw === 'object' ? (raw && raw.url) : raw;
  if (!u) return '';
  u = String(u);
  if (u.startsWith('http')) return u;
  return origin + (u.startsWith('/') ? u : '/' + u);
}

export async function onRequestGet(context) {
  const { request, env, params } = context;
  const id = decodeURIComponent(params.id || '');
  const origin = new URL(request.url).origin;

  // Фолбек, якщо немає доступу до статичних ассетів
  const fallback = () => Response.redirect(origin + '/?product=' + encodeURIComponent(id), 302);

  let product = null;
  try {
    const products = await getProducts(env);
    product = products.find(p => p.id === id && p.enabled !== false) || null;
  } catch (_) {}

  // Невідомий товар → на головну
  if (!product) return Response.redirect(origin + '/', 302);

  // Беремо статичний index.html
  let res;
  try {
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      res = await env.ASSETS.fetch(new URL('/', request.url));
    } else if (typeof context.next === 'function') {
      res = await context.next();
    } else {
      return fallback();
    }
  } catch (_) {
    return fallback();
  }
  const ct = res.headers.get('content-type') || '';
  if (!res.ok || !ct.includes('text/html')) return fallback();

  // Дані для мета-тегів
  let s = {};
  try { s = await getSettings(env); } catch (_) {}
  const shopTitle = s.seoTitle || s.title || '';
  const title = product.name ? `${String(product.name).replace(/\s+/g, ' ').trim()}${shopTitle ? ' — ' + shopTitle : ''}` : shopTitle;
  const desc = (product.description ? stripTags(product.description) : (s.seoDescription || ''))
    .replace(/\s+/g, ' ').trim().slice(0, 300);
  const img = firstImageUrl(product, origin) || (s.seoOgImage ? String(s.seoOgImage).trim() : '');

  let rw = new HTMLRewriter();
  if (title) {
    rw = rw
      .on('title', { element(el) { el.setInnerContent(title); } })
      .on('meta[property="og:title"]', { element(el) { el.setAttribute('content', title); } })
      .on('meta[name="twitter:title"]', { element(el) { el.setAttribute('content', title); } });
  }
  if (desc) {
    rw = rw
      .on('meta[name="description"]', { element(el) { el.setAttribute('content', desc); } })
      .on('meta[property="og:description"]', { element(el) { el.setAttribute('content', desc); } })
      .on('meta[name="twitter:description"]', { element(el) { el.setAttribute('content', desc); } });
  }
  if (img) {
    rw = rw
      .on('meta[property="og:image"]', { element(el) { el.setAttribute('content', img); } })
      .on('meta[name="twitter:image"]', { element(el) { el.setAttribute('content', img); } });
  }
  // og:url — канонічна адреса сторінки товару
  rw = rw.on('meta[property="og:url"]', { element(el) { el.setAttribute('content', origin + '/product/' + encodeURIComponent(id)); } });

  const out = rw.transform(res);
  // Невеликий кеш: контент залежить від товару, але змінюється рідко
  const headers = new Headers(out.headers);
  headers.set('Cache-Control', 'public, max-age=0, s-maxage=60, must-revalidate');
  return new Response(out.body, { status: 200, headers });
}
