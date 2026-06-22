// POST /api/admin/storage/upload — завантаження файлу в R2
// Form-data: { file: File, name?: string }
import { checkAuthAsync, jsonResp, getSettings, storageUrl } from '../../../_utils/shop.js';

function sanitizeName(name) {
  // Прибираємо спецсимволи, залишаємо латиницю/кирилицю/цифри/дефіси
  return String(name || 'file')
    .replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄґҐ._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);
}

// Санітизуємо шлях папки: кожен сегмент чистимо, прибираємо порожні й './..'.
// '' → корінь (плоский ключ). 'misc/чашки' → 'misc/чашки'.
// ВАЖЛИВО: НЕ використовуємо sanitizeName (у нього fallback 'file' для порожнього),
// інакше відсутня папка перетворюється на 'file/'. Тут порожній сегмент → відкидається.
function sanitizeFolderSegment(s) {
  return String(s || '')
    .replace(/[^a-zA-Z0-9а-яА-ЯіІїЇєЄґҐ._-]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 100);
}
function sanitizeFolder(folder) {
  return String(folder || '')
    .split('/')
    .map(s => sanitizeFolderSegment(s.trim()))
    .filter(s => s && s !== '_' && s !== '.' && s !== '..')
    .slice(0, 4) // макс. глибина вкладеності
    .join('/');
}

// Запасна класифікація: якщо клієнт не прислав folder (напр. старий закешований
// _r2-upload.js), визначаємо папку за префіксом імені файлу, який ставить uploadToR2.
// Так файли все одно лягають правильно, незалежно від кешу браузера.
function folderFromName(name) {
  const n = String(name || '');
  if (/^product[_-]/i.test(n)) return 'products';
  if (/^(logo|topbar-bg|banner|hero|hero-extra|favicon|pwaicon|pwaiconmask)[_-]/i.test(n)) return 'branding';
  if (/^(regen|gen|gen-ref|restore|restore-src|restore-rgsrc|restore-out)[_-]/i.test(n)) return 'ai';
  return '';
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);
  if (!env.STORAGE) return jsonResp({ ok: false, error: 'R2 не налаштовано' }, 500);

  let form;
  try { form = await request.formData(); } catch (e) {
    return jsonResp({ ok: false, error: 'Помилка парсингу: ' + e.message }, 400);
  }

  const file = form.get('file');
  if (!file || !(file instanceof File)) {
    return jsonResp({ ok: false, error: 'Файл не отримано' }, 400);
  }

  const settings = await getSettings(env);
  const quotaMB = settings.storageQuotaMB || 200;
  const quotaBytes = quotaMB * 1024 * 1024;

  // Перевіряємо квоту
  let totalBytes = 0;
  let cursor;
  do {
    const list = await env.STORAGE.list({ cursor, limit: 1000 });
    for (const obj of list.objects) totalBytes += obj.size;
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);

  if (totalBytes + file.size > quotaBytes) {
    const usedMB = (totalBytes / 1024 / 1024).toFixed(2);
    return jsonResp({
      ok: false,
      error: `Перевищено квоту сховища: використано ${usedMB} MB з ${quotaMB} MB. Файл (${(file.size/1024/1024).toFixed(2)} MB) не поміститься.`,
    }, 413);
  }

  // Режим відновлення з бекапу: rawKey — записати файл у ТОЧНИЙ ключ, як він був
  // (напр. orders/<id>/1_1_photo.jpg або products/abc_logo.png), без timestamp і без
  // зміни структури. Потрібно, щоб посилання в товарах/замовленнях зійшлися 1-в-1.
  // Тільки для адмінки (auth перевірено вище). Дозволяємо лише безпечні символи у шляху.
  // rawKey приходить URL-кодованим (EscapeDataString) — щоб кирилиця в іменах фото не
  // билась у curl.exe на Windows. Декодуємо назад у справжній ключ.
  let rawKey = (form.get('rawKey') || '').toString().trim();
  if (rawKey) { try { rawKey = decodeURIComponent(rawKey); } catch (_) {} }
  let key;
  if (rawKey) {
    // Захист від виходу за межі: без '..', без початкового '/', лише дозволені символи.
    const cleaned = rawKey.replace(/^\/+/, '');
    if (cleaned.includes('..') || !/^[a-zA-Z0-9а-яА-ЯіІїЇєЄґҐ._\-\/]+$/.test(cleaned)) {
      return jsonResp({ ok: false, error: 'Недопустимий ключ' }, 400);
    }
    key = cleaned;
  } else {
    // Унікальне ім'я: timestamp + оригінальне ім'я; опційно в папці (folder)
    const customName = (form.get('name') || '').toString().trim();
    const baseName = sanitizeName(customName || file.name || 'file');
    const ts = Date.now().toString(36);
    // Папка: явно з форми, інакше — за префіксом імені файлу (запасний варіант для старого кешу клієнта)
    const folder = sanitizeFolder(form.get('folder')) || folderFromName(file.name);
    key = folder ? `${folder}/${ts}_${baseName}` : `${ts}_${baseName}`;
  }

  try {
    await env.STORAGE.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
      customMetadata: { originalName: file.name || '', uploadedAt: new Date().toISOString() },
    });
    return jsonResp({
      ok: true,
      key,
      url: storageUrl(key),
      size: file.size,
      contentType: file.type,
    });
  } catch (e) {
    return jsonResp({ ok: false, error: 'Помилка запису: ' + e.message }, 500);
  }
}
