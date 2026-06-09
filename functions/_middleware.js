// Server-side (edge) SEO injection for Cloudflare Pages.
//
// Проблема: <title> та <meta> в public/index.html — статичні (хардкод).
// Налаштування SEO з адмінки (seoTitle/seoDescription/...) застосовуються
// лише клієнтським JS у renderShop() ВЖЕ після завантаження сторінки.
// Google / Telegram / Facebook читають СИРИЙ HTML без виконання JS —
// тому бачать старий хардкодний title.
//
// Рішення: на edge (до віддачі клієнту) переписуємо title/meta з налаштувань
// через HTMLRewriter. Тепер пошуковики й соцмережі бачать саме SEO-текст з
// адмінки, без правки коду при кожній зміні.

import { getSettings } from './_utils/shop.js';

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Хендлер для <title> — підміняє текст всередині тегу.
class TitleHandler {
  constructor(title) { this.title = title; }
  element(el) {
    if (this.title) el.setInnerContent(this.title); // text-safe (екранує)
  }
}

// Хендлер для <meta ...> — підміняє атрибут content.
class MetaContentHandler {
  constructor(value) { this.value = value; }
  element(el) {
    if (this.value != null && this.value !== '') {
      el.setAttribute('content', String(this.value));
    }
  }
}

// Хендлер для <head> — додає теги, яких може не бути в розмітці
// (google-site-verification, favicon).
class HeadHandler {
  constructor(extraTags) { this.extraTags = extraTags; }
  element(el) {
    for (const tag of this.extraTags) {
      if (tag) el.append(tag, { html: true });
    }
  }
}

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // Адмінку та API не чіпаємо.
  if (path.startsWith('/admin') || path.startsWith('/api')) {
    return next();
  }

  const response = await next();

  // Переписуємо лише HTML-документи.
  const ctype = response.headers.get('content-type') || '';
  if (!ctype.includes('text/html')) {
    return response;
  }

  let settings;
  try {
    settings = await getSettings(context.env);
  } catch {
    // Якщо налаштування недоступні — віддаємо сторінку як є.
    return response;
  }

  const seoTitle = settings.seoTitle || '';
  const browserTabTitle = settings.browserTabTitle || '';
  const seoDescription = settings.seoDescription || '';
  const seoKeywords = settings.seoKeywords || '';
  const seoOgImage = settings.seoOgImage || '';

  // <title> (те, що показує Google): browserTabTitle > seoTitle.
  // og/twitter title (для соцмереж): seoTitle > browserTabTitle.
  const tabTitle = browserTabTitle || seoTitle;
  const socialTitle = seoTitle || browserTabTitle;

  // Додаткові теги в <head>, яких немає в статиці.
  const extraTags = [];
  if (settings.seoGoogleVerification) {
    const v = String(settings.seoGoogleVerification)
      .replace(/^google-site-verification=?/, '')
      .trim();
    if (v) {
      extraTags.push(
        `<meta name="google-site-verification" content="${escapeAttr(v)}">`
      );
    }
  }
  if (settings.faviconImage) {
    extraTags.push(
      `<link rel="icon" href="${escapeAttr(settings.faviconImage)}">`
    );
  }

  let rewriter = new HTMLRewriter()
    .on('title', new TitleHandler(tabTitle))
    .on('meta[name="description"]', new MetaContentHandler(seoDescription))
    .on('meta[name="keywords"]', new MetaContentHandler(seoKeywords))
    .on('meta[property="og:title"]', new MetaContentHandler(socialTitle))
    .on('meta[property="og:description"]', new MetaContentHandler(seoDescription))
    .on('meta[name="twitter:title"]', new MetaContentHandler(socialTitle))
    .on('meta[name="twitter:description"]', new MetaContentHandler(seoDescription));

  // Картинку підміняємо лише якщо вона задана в налаштуваннях
  // (інакше лишаємо хардкодну og-image.jpg).
  if (seoOgImage) {
    rewriter = rewriter
      .on('meta[property="og:image"]', new MetaContentHandler(seoOgImage))
      .on('meta[name="twitter:image"]', new MetaContentHandler(seoOgImage));
  }

  if (extraTags.length) {
    rewriter = rewriter.on('head', new HeadHandler(extraTags));
  }

  return rewriter.transform(response);
}
