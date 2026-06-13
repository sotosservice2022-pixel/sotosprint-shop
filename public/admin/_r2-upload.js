// _r2-upload.js — спільна функція для завантаження файлів в R2 з адмінки.
// Використання:
//   const url = await uploadToR2(file, { compress: true, maxSide: 1200, quality: 0.85, prefix: 'logo' });
// Повертає URL виду `/api/storage/<ts>_<name>` або кидає помилку.

// Видаляє файл з R2 за URL (тихо ігнорує помилки і non-R2 URL)
window.deleteFromR2 = async function(url) {
  if (!url || typeof url !== 'string') return;
  // Витягаємо key з URL виду /api/storage/<key>
  const m = url.match(/\/api\/storage\/(.+)$/);
  if (!m) return; // Не R2 URL (можливо data: або зовнішній)
  const key = decodeURIComponent(m[1]);
  try {
    await fetch('/api/admin/storage/delete', {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    });
  } catch {}
};

window.uploadToR2 = async function(file, opts = {}) {  if (!file) throw new Error('Файл не передано');
  let toUpload = file;

  // Опціональне стиснення (тільки для зображень, окрім SVG/GIF)
  if (opts.compress && file.type.startsWith('image/') && !file.type.includes('svg') && !file.type.includes('gif')) {
    try {
      const maxSide = opts.maxSide || 1200;
      const quality = opts.quality || 0.85;
      toUpload = await compressR2Image(file, maxSide, quality, opts.keepType === true);
    } catch (e) {
      console.warn('Compress failed, uploading original:', e.message);
      toUpload = file;
    }
  }

  // Префікс імені (logo_, banner_, product_) для зручності розрізнення
  const fd = new FormData();
  const prefix = opts.prefix ? `${opts.prefix}_` : '';
  fd.append('file', toUpload, prefix + (file.name || 'upload'));
  // Папка призначення в R2 (products/, branding/, ai/, misc/чашки …). Порожньо → корінь.
  if (opts.folder) fd.append('folder', opts.folder);

  const r = await fetch('/api/admin/storage/upload', {
    method: 'POST', credentials: 'include', body: fd,
  });
  // При таймауті/помилці шлюзу Cloudflare віддає HTML (не JSON) — r.json() падає з
  // «Unexpected token '<'». Читаємо як текст і даємо зрозуміле пояснення.
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); }
  catch {
    if (r.status === 413) throw new Error('Файл завеликий для завантаження');
    if (r.status === 524 || r.status === 504) throw new Error('Час очікування вичерпано — файл завеликий або мережа повільна. Спробуй менше фото.');
    throw new Error('Не вдалося завантажити (HTTP ' + r.status + '). Спробуй ще раз або менший файл.');
  }
  if (!data.ok) throw new Error(data.error || 'Помилка завантаження');
  return data.url; // /api/storage/<key>
};

async function compressR2Image(file, maxSide, quality, keepType) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = URL.createObjectURL(file);
    });
  }
  const w = src.width, h = src.height;
  const ratio = Math.min(1, maxSide / Math.max(w, h));
  const nw = Math.round(w * ratio), nh = Math.round(h * ratio);
  const canvas = document.createElement('canvas');
  canvas.width = nw; canvas.height = nh;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, nw, nh);
  try { src.close?.(); } catch {}
  // PNG → JPEG (мельче), АЛЕ якщо в картинці є прозорість — лишаємо PNG,
  // інакше прозорий фон стане суцільним (JPEG не має альфа-каналу).
  let hasAlpha = false;
  if (file.type === 'image/png' && !keepType) {
    try {
      const data = ctx.getImageData(0, 0, nw, nh).data;
      for (let i = 3; i < data.length; i += 16) { // кожен 4-й піксель — швидко і достатньо
        if (data[i] < 250) { hasAlpha = true; break; }
      }
    } catch { hasAlpha = true; } // не змогли перевірити — безпечніше лишити PNG
  }
  const outType = (keepType || hasAlpha || file.type !== 'image/png') ? file.type : 'image/jpeg';
  return new Promise(res =>
    canvas.toBlob(b => res(new File([b], file.name, { type: outType })), outType, quality)
  );
}
