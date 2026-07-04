// GET /sitemap.xml — ДИНАМІЧНА карта сайту для Google/Bing.
// Навіщо: статичний sitemap.xml містив лише 2 адреси (головна + checkout), тож нові товари,
// додані через адмінку, у нього НЕ потрапляли і Google про них не дізнавався. Ця функція
// при кожному запиті бере всі АКТИВНІ товари з бази (enabled !== false) і будує повний список
// URL-ів /product/<id> автоматично — руками нічого редагувати не треба.
//
// Cloudflare Pages: функція за шляхом /sitemap.xml має пріоритет над статичним файлом ЛИШЕ
// якщо статичного public/sitemap.xml немає (його прибрано). robots.txt дозволяє /sitemap.xml.
import { getProducts, getShopVersion } from './_utils/shop.js';

function xmlEscape(s) {
  return String(s || '').replace(/[<>&'"]/g, c => (
    { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]
  ));
}

export async function onRequestGet({ request, env }) {
  const origin = new URL(request.url).origin;

  // lastmod для статичних сторінок — беремо з версії магазину (оновлюється при будь-якій зміні
  // товарів/налаштувань). Версія — timestamp у мс; якщо нема — поточна дата.
  let lastmod = new Date().toISOString().slice(0, 10);
  try {
    const v = parseInt(await getShopVersion(env), 10);
    if (v && v > 0) lastmod = new Date(v).toISOString().slice(0, 10);
  } catch (_) {}

  const urls = [];
  // Головна і checkout — статичні, завжди присутні.
  urls.push({ loc: `${origin}/`, changefreq: 'daily', priority: '1.0', lastmod });
  urls.push({ loc: `${origin}/checkout/`, changefreq: 'monthly', priority: '0.3' });

  // Активні товари → /product/<id>
  try {
    const products = await getProducts(env);
    for (const p of (products || [])) {
      if (!p || !p.id || p.enabled === false) continue;
      urls.push({
        loc: `${origin}/product/${encodeURIComponent(p.id)}`,
        changefreq: 'weekly',
        priority: '0.8',
        lastmod,
      });
    }
  } catch (_) { /* якщо база недоступна — віддамо хоча б статичні URL */ }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url>
    <loc>${xmlEscape(u.loc)}</loc>${u.lastmod ? `
    <lastmod>${u.lastmod}</lastmod>` : ''}
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      // Кеш на годину: Google не тягне sitemap щохвилини, а нові товари підхопляться швидко.
      'Cache-Control': 'public, max-age=3600',
    },
  });
}
