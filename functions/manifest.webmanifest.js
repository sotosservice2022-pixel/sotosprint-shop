// GET /manifest.webmanifest — динамічний маніфест PWA з налаштувань (KV).
// Назва/кольори беруться з адмінки (pwaAppName, pwaShortName, pwaThemeColor...).
// Якщо PWA вимкнено в адмінці — повертаємо 404, щоб браузер не вважав сайт встановлюваним.
import { getSettings } from './_utils/shop.js';

export async function onRequestGet({ env }) {
  let s = null;
  try { s = await getSettings(env); } catch (_) {}

  // PWA вимкнено — маніфесту немає (фіча повністю прихована)
  if (!s || s.pwaEnabled !== true) {
    return new Response('Not found', { status: 404 });
  }

  const name = (s.pwaAppName && String(s.pwaAppName).trim()) || s.seoTitle || 'AGPRNT';
  const shortName = (s.pwaShortName && String(s.pwaShortName).trim()) || 'AGPRNT';
  const themeColor = (s.pwaThemeColor && String(s.pwaThemeColor).trim()) || '#0b8aff';
  const bgColor = (s.pwaBackgroundColor && String(s.pwaBackgroundColor).trim()) || '#0b8aff';

  const manifest = {
    name,
    short_name: shortName,
    description: s.seoDescription || '',
    start_url: '/?source=pwa',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: themeColor,
    background_color: bgColor,
    lang: 'uk',
    // ВАЖЛИВО: Chrome на Android вимагає PNG 192 та 512 для критерію «встановлюваності»
    // (кнопка «Встановити застосунок»). SVG він показує, але не зараховує. Тому PNG — головні.
    // Якщо в адмінці завантажено власну іконку (pwaIconImage, PNG ≥512) — використовуємо її.
    icons: (s.pwaIconImage && String(s.pwaIconImage).trim())
      ? [
          { src: String(s.pwaIconImage).trim(), sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: String(s.pwaIconImage).trim(), sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: String(s.pwaIconImage).trim(), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ]
      : [
          { src: '/pwa-icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/pwa-icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
  };

  return new Response(JSON.stringify(manifest), {
    status: 200,
    headers: {
      'Content-Type': 'application/manifest+json; charset=utf-8',
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
  });
}
