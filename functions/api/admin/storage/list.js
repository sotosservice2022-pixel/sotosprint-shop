// GET /api/admin/storage/list — список файлів у R2
import { checkAuthAsync, jsonResp, getSettings } from '../../../_utils/shop.js';

function guessContentType(key) {
  const ext = (key.split('.').pop() || '').toLowerCase();
  const map = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', avif: 'image/avif',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    mp3: 'audio/mpeg', wav: 'audio/wav',
    pdf: 'application/pdf', json: 'application/json', txt: 'text/plain',
    zip: 'application/zip',
  };
  return map[ext] || '';
}

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 не налаштовано' }, 500);

  try {
    const settings = await getSettings(env);
    const quotaMB = settings.storageQuotaMB || 200;

    let cursor;
    const files = [];
    let totalBytes = 0;
    do {
      const list = await env.STORAGE.list({ cursor, limit: 1000, include: ['httpMetadata', 'customMetadata'] });
      for (const obj of list.objects) {
        files.push({
          key: obj.key,
          size: obj.size,
          uploaded: obj.uploaded,
          contentType: obj.httpMetadata?.contentType || guessContentType(obj.key),
          url: '/api/storage/' + encodeURIComponent(obj.key),
        });
        totalBytes += obj.size;
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    // Сортуємо за датою (новіші першими)
    files.sort((a, b) => new Date(b.uploaded) - new Date(a.uploaded));

    return jsonResp({
      ok: true,
      files,
      stats: {
        count: files.length,
        totalBytes,
        totalMB: +(totalBytes / 1024 / 1024).toFixed(2),
        quotaMB,
        usedPercent: Math.round((totalBytes / (quotaMB * 1024 * 1024)) * 100),
      },
    });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }
}
