// POST /api/order — приём заказа из магазина и отправка в Telegram.
// Тело — multipart/form-data:
//   cart      — JSON-строка корзины [{ productId, productName, optionId, optionName, quantity, unitPrice, photoCount }, ...]
//   name, phone, comment, delivery, payment — поля
//   photos_<idx>  — файлы для позиции idx (idx — индекс в cart)
import { getSettings, getProducts, getBotConfig, saveOrder, escapeMd, escapeHtml, jsonResp, invalidateOrdersCache, notifyLimitHit, classifyLimitError, saveSettings, sendSms } from '../_utils/shop.js';

// === Защита от spam: одному номеру телефона нельзя слать заказ чаще раза в N секунд ===
const ANTI_SPAM_WINDOW_SEC = 30;

// === Telegram fetch с обработкой rate-limit (429 + retry_after) ===
async function tgFetch(url, options, maxRetries = 4) {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, options);
    let data;
    try { data = await res.json(); } catch { data = { ok: false, description: `HTTP ${res.status}` }; }
    if (data.ok) return data;
    // Rate limit?
    const retryAfter = data.parameters?.retry_after || (res.status === 429 ? 1 : 0);
    if (retryAfter && attempt < maxRetries) {
      const waitMs = Math.min(retryAfter, 30) * 1000 + 200;
      console.log(`[tg] 429, retry after ${waitMs}ms (attempt ${attempt + 1}/${maxRetries})`);
      await new Promise(r => setTimeout(r, waitMs));
      attempt++;
      continue;
    }
    // Не rate-limit или превысили retries
    throw new Error(`Telegram: ${data.description || ('HTTP ' + res.status)}`);
  }
}

// Между сообщениями к одному и тому же чату делаем небольшую паузу — превентивно
async function tgPace() { await new Promise(r => setTimeout(r, 250)); }

export async function onRequestPost({ request, env }) {
  const t0 = Date.now();
  const reqId = Math.random().toString(36).slice(2, 8);
  console.log(`[${reqId}] /order start`);

  const botCfg = await getBotConfig(env);
  const settings = await getSettings(env);

  if (settings.shopEnabled === false) {
    return jsonResp({ ok: false, error: settings.shopDisabledMessage || 'Магазин временно закрыт.' }, 503);
  }

  // Перевірка налаштувань Telegram бота
  const botConfigured = !!(botCfg.botToken && botCfg.chatId);
  if (!botConfigured && !settings.allowOrdersWithoutBot) {
    return jsonResp({ ok: false, error: 'Сервер не настроен (нет токена/chat_id бота)' }, 500);
  }

  const TG = botConfigured ? `https://api.telegram.org/bot${botCfg.botToken}` : null;
  const CHAT = botCfg.chatId || '';
  const MAX_TOTAL_PHOTOS = parseInt(env.MAX_TOTAL_PHOTOS || '50', 10);
  const MAX_PHOTO_SIZE = parseInt(env.MAX_PHOTO_SIZE_MB || '20', 10) * 1024 * 1024;

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return jsonResp({ ok: false, error: 'Не удалось прочитать форму: ' + e.message }, 400);
  }

  // Парсим корзину
  let cart;
  try {
    cart = JSON.parse(form.get('cart') || '[]');
    if (!Array.isArray(cart) || cart.length === 0) throw new Error('Пустая корзина');
  } catch (e) {
    return jsonResp({ ok: false, error: 'Корзина невалидна: ' + e.message }, 400);
  }

  // Валидируем по каталогу: цены и доступность берём с сервера, не доверяя клиенту
  const products = await getProducts(env);
  const productById = new Map(products.map(p => [p.id, p]));
  let totalPrice = 0;
  const enrichedCart = [];
  for (let i = 0; i < cart.length; i++) {
    const item = cart[i];
    const product = productById.get(item.productId);
    if (!product || product.enabled === false) {
      return jsonResp({ ok: false, error: `Товар "${item.productName || item.productId}" недоступен` }, 400);
    }
    const qty = Math.max(1, Math.min(parseInt(item.quantity, 10) || 1, 1000));
    let unitPrice = product.price;
    let optionLabel = null;
    if (item.optionId && Array.isArray(product.options)) {
      const opt = product.options.find(o => o.id === item.optionId);
      if (opt) {
        unitPrice += (opt.priceDelta || 0);
        optionLabel = opt.name;
      }
    }
    const lineTotal = unitPrice * qty;
    totalPrice += lineTotal;
    enrichedCart.push({
      product, qty, unitPrice, lineTotal, optionLabel,
    });
  }

  // === Промокод ===
  let promoApplied = null;
  let promoDiscount = 0;
  let freeShipping = false;
  const subtotalBeforePromo = totalPrice;
  const promoCodeRaw = String(form.get('promo_code') || '').trim().toUpperCase();
  if (promoCodeRaw && Array.isArray(settings.promoCodes)) {
    const promo = settings.promoCodes.find(p => (p.code || '').toUpperCase() === promoCodeRaw && p.enabled !== false);
    if (promo) {
      const now = new Date();
      const expired = promo.validUntil && new Date(promo.validUntil) < now;
      const notYet = promo.validFrom && new Date(promo.validFrom) > now;
      const overUsed = promo.maxUses && promo.maxUses > 0 && (promo.used || 0) >= promo.maxUses;
      const minOk = !promo.minOrder || totalPrice >= promo.minOrder;

      // === Прив'язка промокоду до категорій/товарів (scope) ===
      // scope: 'all' (за замовч.) — діє на весь кошик; 'categories' — лише товари вказаних категорій;
      // 'products' — лише вказані товари. Знижка рахується ЛИШЕ з підходящих позицій.
      const scope = promo.scope || 'all';
      const catIds = Array.isArray(promo.categoryIds) ? promo.categoryIds : [];
      const prodIds = Array.isArray(promo.productIds) ? promo.productIds : [];
      const isEligibleItem = (it) => {
        if (scope === 'categories') return catIds.includes(it.product.categoryId);
        if (scope === 'products') return prodIds.includes(it.product.id);
        return true; // 'all'
      };
      // Сума підходящих позицій
      const eligibleSubtotal = enrichedCart.reduce((s, it) => s + (isEligibleItem(it) ? it.lineTotal : 0), 0);
      const hasEligible = eligibleSubtotal > 0;
      const scopeOk = scope === 'all' || hasEligible;

      if (!expired && !notYet && !overUsed && minOk && scopeOk) {
        // База для знижки: вся сума (для 'all') або лише підходящі позиції
        const discountBase = scope === 'all' ? totalPrice : eligibleSubtotal;
        if (promo.type === 'percent') {
          promoDiscount = Math.round(discountBase * ((promo.value || 0) / 100));
          totalPrice -= promoDiscount;
        } else if (promo.type === 'fixed') {
          promoDiscount = Math.min(promo.value || 0, discountBase);
          totalPrice -= promoDiscount;
        } else if (promo.type === 'shipping') {
          freeShipping = true;
        }
        promoApplied = {
          code: promo.code,
          type: promo.type,
          value: promo.value,
          discount: promoDiscount,
          freeShipping,
        };
        // Інкрементуємо used (best effort)
        try {
          promo.used = (promo.used || 0) + 1;
          await saveSettings(env, settings);
        } catch (e) { console.log('promo save err:', e.message); }
      } else {
        // Невалідний промокод — відхиляємо замовлення з понятним повідомленням
        let reason = 'Промокод не діє';
        if (expired) reason = 'Промокод протерміновано';
        else if (notYet) reason = 'Промокод ще не активний';
        else if (overUsed) reason = 'Ліміт використань вичерпано';
        else if (!minOk) reason = `Мінімальна сума замовлення: ${promo.minOrder}₴`;
        else if (!scopeOk) reason = 'Промокод не діє на товари у кошику';
        return jsonResp({ ok: false, error: `Промокод "${promoCodeRaw}": ${reason}` }, 400);
      }
    } else {
      return jsonResp({ ok: false, error: `Промокод "${promoCodeRaw}" не знайдено` }, 400);
    }
  }

  // Собираем фото по позициям
  const photoFiles = []; // { itemIndex, file }
  let totalPhotos = 0;
  for (let i = 0; i < enrichedCart.length; i++) {
    const files = form.getAll(`photos_${i}`).filter(v => v instanceof File);
    enrichedCart[i].photoCount = files.length;
    for (const f of files) {
      if (f.size > MAX_PHOTO_SIZE) {
        return jsonResp({ ok: false, error: `Файл «${f.name}» больше ${env.MAX_PHOTO_SIZE_MB || 20} МБ` }, 400);
      }
      if (!f.type || !f.type.startsWith('image/')) {
        return jsonResp({ ok: false, error: `«${f.name}» не является изображением` }, 400);
      }
      totalPhotos++;
      photoFiles.push({ itemIndex: i, file: f });
    }
    if (enrichedCart[i].product.requiresPhoto && files.length === 0) {
      return jsonResp({ ok: false, error: `Для "${enrichedCart[i].product.name}" нужно прикрепить фото` }, 400);
    }
  }
  if (totalPhotos > MAX_TOTAL_PHOTOS) {
    return jsonResp({ ok: false, error: `Слишком много фото (макс. ${MAX_TOTAL_PHOTOS})` }, 400);
  }

  console.log(`[${reqId}] cart items=${enrichedCart.length}, photos=${totalPhotos}, total=${totalPrice}₴`);

  const orderId = await getNextOrderId(env);
  const name = (form.get('name') || '').toString().trim();
  const phone = (form.get('phone') || '').toString().trim();
  const comment = (form.get('comment') || '').toString().trim();
  const delivery = (form.get('delivery') || '').toString().trim();
  const payment = (form.get('payment') || '').toString().trim();
  // Email клієнта (надсилається завжди коли включено + є валідний email)
  const customerEmail = (form.get('email') || '').toString().trim();

  // Анти-спам: один телефон не может слать заказы чаще раза в N секунд
  if (phone && env.SHOP_KV) {
    const phoneKey = 'lastOrder_' + phone.replace(/\D/g, '');
    try {
      const last = await env.SHOP_KV.get(phoneKey);
      if (last) {
        const elapsed = (Date.now() - parseInt(last, 10)) / 1000;
        if (elapsed < ANTI_SPAM_WINDOW_SEC) {
          const wait = Math.ceil(ANTI_SPAM_WINDOW_SEC - elapsed);
          return jsonResp({
            ok: false,
            error: `Зачекайте ${wait} сек перед наступним замовленням. Попереднє вже надіслано.`,
          }, 429);
        }
      }
      // Записываем timestamp с TTL
      await env.SHOP_KV.put(phoneKey, String(Date.now()), { expirationTtl: 600 }); // 10 min TTL — больше чем нужно
    } catch (e) {
      console.log(`[${reqId}] anti-spam check failed: ${e.message}`);
    }
  }

  // Формируем красивое сообщение
  const lines = [];
  lines.push(`🛍 *НОВЫЙ ЗАКАЗ* \`#${orderId}\``);
  lines.push('');

  // Контакты
  lines.push(`👤 *Имя:* ${escapeMd(name) || '—'}`);
  if (phone) {
    const digits = phone.replace(/\D/g, '');
    lines.push(`📞 *Телефон:* [${escapeMd(phone)}](tel:+${digits})`);
  } else {
    lines.push(`📞 *Телефон:* —`);
  }
  if (delivery) lines.push(`🚚 *Доставка:* ${escapeMd(delivery)}`);
  const npCity = (form.get('npCity') || '').toString().trim();
  const npWarehouse = (form.get('npWarehouse') || '').toString().trim();
  if (npCity) lines.push(`📍 *Город НП:* ${escapeMd(npCity)}`);
  if (npWarehouse) lines.push(`🏪 *Отделение:* ${escapeMd(npWarehouse)}`);
  if (payment) lines.push(`💳 *Оплата:* ${escapeMd(payment)}`);
  if (comment) {
    if (comment.includes('\n')) {
      lines.push(`💬 *Комментарий:*`);
      comment.split('\n').forEach(l => lines.push(`   ${escapeMd(l)}`));
    } else {
      lines.push(`💬 *Комментарий:* ${escapeMd(comment)}`);
    }
  }

  // Состав заказа
  lines.push('');
  lines.push('📦 *Состав заказа:*');
  for (let i = 0; i < enrichedCart.length; i++) {
    const it = enrichedCart[i];
    let line = `${i + 1}. ${escapeMd(it.product.name)}`;
    if (it.optionLabel) line += ` _(${escapeMd(it.optionLabel)})_`;
    line += ` × *${it.qty}* = *${it.lineTotal} ${escapeMd(it.product.currency || '₴')}*`;
    if (it.photoCount > 0) line += ` · ${it.photoCount} фото`;
    lines.push(line);
  }
  lines.push('');
  if (promoApplied) {
    if (promoApplied.type === 'shipping') {
      lines.push(`🎟 *Промокод:* ${escapeMd(promoApplied.code)} (безкоштовна доставка)`);
      lines.push(`💰 *Итого: ${totalPrice} ₴*`);
    } else {
      lines.push(`💵 Підсумок: ${subtotalBeforePromo} ₴`);
      lines.push(`🎟 *Промокод:* ${escapeMd(promoApplied.code)} (-${promoApplied.discount} ₴)`);
      lines.push(`💰 *Итого: ${totalPrice} ₴*`);
    }
  } else {
    lines.push(`💰 *Итого: ${totalPrice} ₴*`);
  }
  lines.push(`🕒 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Kyiv' })}`);

  const text = lines.join('\n');

  try {
    if (botConfigured) {
      const t1 = Date.now();
      await tgSendMessage(TG, CHAT, text);
      console.log(`[${reqId}] sendMessage in ${Date.now() - t1}ms`);

      // Шлём фото — группируем по позициям корзины, каждая позиция → подзаголовок + альбом документов
      if (photoFiles.length > 0) {
        const t2 = Date.now();
        // Группируем фото по itemIndex
        const byItem = new Map();
        for (const pf of photoFiles) {
          if (!byItem.has(pf.itemIndex)) byItem.set(pf.itemIndex, []);
          byItem.get(pf.itemIndex).push(pf.file);
        }

        for (const [itemIdx, files] of byItem.entries()) {
          const it = enrichedCart[itemIdx];
          const header = `📎 *#${orderId}* — ${escapeMd(it.product.name)}${it.optionLabel ? ` (${escapeMd(it.optionLabel)})` : ''} · *${files.length} фото*`;
          await tgPace();
          await tgSendMessage(TG, CHAT, header);

          if (files.length === 1) {
            const fd = new FormData();
            fd.append('chat_id', CHAT);
            fd.append('document', files[0], files[0].name || 'photo.jpg');
            await tgPace();
            await tgFetch(`${TG}/sendDocument`, { method: 'POST', body: fd });
          } else {
            // sendMediaGroup до 10 документов за раз
            const chunks = [];
            for (let i = 0; i < files.length; i += 10) chunks.push(files.slice(i, i + 10));
            for (const chunk of chunks) {
              const fd = new FormData();
              fd.append('chat_id', CHAT);
              const media = chunk.map((_, j) => ({
                type: 'document',
                media: `attach://photo${j}`,
              }));
              fd.append('media', JSON.stringify(media));
              chunk.forEach((file, j) => {
                fd.append(`photo${j}`, file, file.name || `photo_${j}.jpg`);
              });
              await tgPace();
              await tgFetch(`${TG}/sendMediaGroup`, { method: 'POST', body: fd });
            }
          }
        }
        console.log(`[${reqId}] photos in ${Date.now() - t2}ms`);
      }
    } else {
      console.log(`[${reqId}] Bot not configured — skipping Telegram, saving to KV only`);
    }

    console.log(`[${reqId}] OK total ${Date.now() - t0}ms`);

    // Сохраняем заказ в KV для админ-раздела
    try {
      await saveOrder(env, {
        id: orderId,
        createdAt: new Date().toISOString(),
        customerName: name,
        phone,
        comment,
        delivery,
        payment,
        npCity,
        npWarehouse,
        items: enrichedCart.map(it => ({
          productId: it.product.id,
          productName: it.product.name,
          optionLabel: it.optionLabel,
          quantity: it.qty,
          unitPrice: it.unitPrice,
          lineTotal: it.lineTotal,
          photoCount: it.photoCount,
          currency: it.product.currency || '₴',
        })),
        totalPrice,
        subtotalBeforePromo: promoApplied ? subtotalBeforePromo : undefined,
        promo: promoApplied,
        totalPhotos,
        isRead: false,
        isDone: false,
      });
      await invalidateOrdersCache();
    } catch (e) {
      console.log(`[${reqId}] saveOrder failed: ${e.message}`);
      const limitKind = classifyLimitError(e);
      if (limitKind) await notifyLimitHit(env, limitKind, e.message);
    }

    // === Email клієнту (Resend) — надсилається коли увімкнено + клієнт вказав email ===
    if (settings.customerEmailEnabled && customerEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      try {
        const apiKey = (settings.emailApiKey || '').trim();
        const fromEmail = (settings.emailFrom || 'onboarding@resend.dev').trim();
        if (!apiKey) {
          console.log(`[${reqId}] customer email: no apiKey`);
        } else {
          const fromName = (settings.customerEmailFromName || settings.title || 'Магазин').replace(/[<>"]/g, '');
          const subjectTpl = settings.customerEmailSubject || 'Замовлення #{orderId} прийнято';
          const subject = subjectTpl
            .replaceAll('{orderId}', orderId)
            .replaceAll('{shopTitle}', settings.title || '')
            .replaceAll('{customerName}', name)
            .replaceAll('{total}', String(totalPrice));
          // HTML тіла
          const itemsHtml = enrichedCart.map(it => `
            <tr>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;">${escapeHtml(it.product.name)}${it.optionLabel ? ' (' + escapeHtml(it.optionLabel) + ')' : ''}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center;">${it.qty}</td>
              <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right;">${it.lineTotal} ${it.product.currency || '₴'}</td>
            </tr>
          `).join('');
          const promoLine = promoApplied
            ? `<tr><td colspan="2" style="padding: 6px 8px; color:#16a34a;">🎟 Промокод ${escapeHtml(promoApplied.code)}</td><td style="padding: 6px 8px; text-align: right; color:#16a34a;">-${promoApplied.discount} ₴</td></tr>`
            : '';
          const npLine = (delivery && delivery.includes('Нова Пошта')) && form.get('npCity') ? `
            <tr><td colspan="3" style="padding: 6px 8px; font-size: 13px; color: #6b7280;">📦 ${escapeHtml(String(form.get('npCity') || ''))}, відділення ${escapeHtml(String(form.get('npWarehouse') || ''))}</td></tr>
          ` : '';
          const html = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
              <div style="background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.05);">
                <h1 style="color: #0b8aff; margin: 0 0 8px; font-size: 24px;">✅ Замовлення прийнято!</h1>
                <p style="color: #6b7280; margin: 0 0 20px;">Номер: <strong>#${orderId}</strong></p>
                <p style="margin: 0 0 16px;">Доброго дня, <strong>${escapeHtml(name)}</strong>!</p>
                <p style="margin: 0 0 20px;">Ми отримали ваше замовлення і скоро з вами звʼяжемося для уточнення деталей.</p>

                <h3 style="margin: 20px 0 8px; font-size: 16px; color: #374151;">📦 Склад замовлення</h3>
                <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                  <thead>
                    <tr style="background: #f3f4f6;">
                      <th style="padding: 8px; text-align: left;">Товар</th>
                      <th style="padding: 8px; text-align: center;">К-сть</th>
                      <th style="padding: 8px; text-align: right;">Сума</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${itemsHtml}
                    ${promoLine}
                    ${npLine}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colspan="2" style="padding: 12px 8px; font-weight: 700; font-size: 16px;">До сплати:</td>
                      <td style="padding: 12px 8px; text-align: right; font-weight: 700; font-size: 18px; color: #0b8aff;">${totalPrice} ₴</td>
                    </tr>
                  </tfoot>
                </table>

                <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; margin-top: 16px; font-size: 13px;">
                  <div><strong>📞 Телефон:</strong> ${escapeHtml(phone)}</div>
                  ${delivery ? `<div><strong>🚚 Доставка:</strong> ${escapeHtml(delivery)}</div>` : ''}
                  ${payment ? `<div><strong>💳 Оплата:</strong> ${escapeHtml(payment)}</div>` : ''}
                </div>

                <p style="margin: 20px 0 0; color: #6b7280; font-size: 13px; text-align: center;">
                  ${escapeHtml(settings.customerEmailFooter || 'Дякуємо за замовлення!')}
                </p>
              </div>
              <p style="text-align: center; color: #9ca3af; font-size: 11px; margin: 16px 0 0;">
                Це автоматичне повідомлення. Не відповідайте на цей лист.
              </p>
            </div>
          `;
          const t3 = Date.now();
          const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: `${fromName} <${fromEmail}>`,
              to: customerEmail,
              subject,
              html,
            }),
          });
          if (r.ok) {
            console.log(`[${reqId}] customer email sent to ${customerEmail} in ${Date.now() - t3}ms`);
          } else {
            const txt = await r.text();
            console.log(`[${reqId}] customer email failed: ${r.status} ${txt}`);
          }
        }
      } catch (e) {
        console.log(`[${reqId}] customer email error: ${e.message}`);
      }
    }

    // === SMS клієнту (TurboSMS) — надсилається коли увімкнено + є номер ===
    if (settings.smsEnabled && phone) {
      try {
        const smsText = (settings.smsTemplate || 'Замовлення #{orderId} прийнято.')
          .replaceAll('{orderId}', orderId)
          .replaceAll('{shopTitle}', settings.title || '')
          .replaceAll('{customerName}', name)
          .replaceAll('{total}', String(totalPrice));
        const sres = await sendSms(settings, phone, smsText);
        console.log(`[${reqId}] sms ${sres.ok ? 'sent: ' + sres.id : 'failed: ' + sres.error}`);
      } catch (e) {
        console.log(`[${reqId}] sms error: ${e.message}`);
      }
    }

    // Инкрементируем счётчик продаж по каждому товару
    try {
      const productsList = await getProducts(env);
      let productsChanged = false;
      for (const it of enrichedCart) {
        const p = productsList.find(p => p.id === it.product.id);
        if (p) {
          p.soldCount = (parseInt(p.soldCount) || 0) + (it.qty || 1);
          // #2: авто-списання залишку на складі (тільки якщо облік увімкнено)
          if (p.showStock) {
            const cur = Number.isFinite(p.stock) ? p.stock : 0;
            p.stock = Math.max(0, cur - (it.qty || 1));
          }
          productsChanged = true;
        }
      }
      if (productsChanged) {
        await env.SHOP_KV.put('products', JSON.stringify(productsList));
      }
    } catch (e) {
      console.log(`[${reqId}] soldCount update failed: ${e.message}`);
    }

    return jsonResp({ ok: true, orderId, total: totalPrice });
  } catch (err) {
    console.log(`[${reqId}] ERROR: ${err.message}`);
    return jsonResp({ ok: false, error: 'Не удалось отправить заказ. Попробуйте ещё раз.' }, 500);
  }
}

async function tgSendMessage(TG, chatId, text) {
  await tgFetch(`${TG}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

async function getNextOrderId(env) {
  const KEY = 'orderCounter';
  if (!env.SHOP_KV) return String(Date.now()).slice(-6);
  try {
    const cur = parseInt((await env.SHOP_KV.get(KEY)) || '0', 10);
    const next = cur + 1;
    await env.SHOP_KV.put(KEY, String(next));
    return String(next);
  } catch {
    return String(Date.now()).slice(-6);
  }
}
