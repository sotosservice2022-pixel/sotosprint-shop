/* AGPRNT Service Worker — кеш оболонки сайту для офлайн-доступу та швидкого старту.
 *
 * ПРИНЦИПИ (щоб НЕ зламати боєвий магазин):
 *  - /api/* та оплата/адмінка — НІКОЛИ не кешуються (завжди свіжі з мережі).
 *  - HTML-навігація — network-first: завжди тягнемо свіжу сторінку, кеш лише як
 *    запасний варіант коли немає інтернету.
 *  - Статика (іконки, шрифти) — stale-while-revalidate.
 *  - При зміні CACHE_VERSION старий кеш повністю видаляється.
 *
 * Вимкнення PWA в адмінці робить unregister цього SW (див. index.html) — кеш чиститься.
 */
const CACHE_VERSION = 'agprnt-v1';
const PRECACHE = ['/', '/pwa-icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Дозволяємо сторінці наказати SW негайно прийняти оновлення
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

function isBypass(url) {
  // Усе, що НЕ можна кешувати: API, оплата, адмінка, telegram, службові шляхи
  return (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/admin') ||
    url.pathname.startsWith('/pay') ||
    url.pathname.startsWith('/checkout') ||
    url.pathname.includes('/__')
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // чужі домени не чіпаємо
  if (isBypass(url)) return;                         // динаміку віддаємо браузеру як є

  // Навігація (HTML) — network-first, кеш як запасний
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put('/', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/').then((r) => r || caches.match(req)))
    );
    return;
  }

  // Статика — stale-while-revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
