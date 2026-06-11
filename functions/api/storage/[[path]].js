// GET /api/storage/<key> — публічна віддача файлу з R2.
// Catch-all ([[path]]): ключ може містити слеші (папки products/..., orders/<id>/...).
// Старі плоскі ключі (один сегмент, без слешів) працюють так само.
// URL шарінг: https://agprnt.com/api/storage/products/abc123_logo.png
export async function onRequestGet({ request, env, params }) {
  if (!env.STORAGE) return new Response('Storage not configured', { status: 500 });

  // params.path — масив сегментів (catch-all). Реконструюємо ключ зі слешами.
  const segs = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const key = segs.map(decodeURIComponent).join('/');
  if (!key) return new Response('Not found', { status: 404 });

  try {
    const obj = await env.STORAGE.get(key);
    if (!obj) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    if (obj.httpMetadata?.contentType) headers.set('Content-Type', obj.httpMetadata.contentType);
    headers.set('Cache-Control', 'public, max-age=31536000, immutable'); // 1 рік для статики
    headers.set('ETag', obj.httpEtag);

    // Перевірка If-None-Match для 304
    const ifNoneMatch = request.headers.get('If-None-Match');
    if (ifNoneMatch && ifNoneMatch === obj.httpEtag) {
      return new Response(null, { status: 304, headers });
    }

    return new Response(obj.body, { status: 200, headers });
  } catch (e) {
    return new Response('Error: ' + e.message, { status: 500 });
  }
}
