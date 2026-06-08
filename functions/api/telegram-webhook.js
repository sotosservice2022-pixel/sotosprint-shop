// POST /api/telegram-webhook — обробка повідомлень від Telegram-бота.
// Дозволяє відновити пароль адмінки навіть якщо втратив доступ до сайту.
// Бот реагує на команди ТІЛЬКИ від chat_id який збережено в налаштуваннях.
import { getSettings, getBotConfig, setPasswordOverride, invalidateShopCache, getPrimaryDomain } from '../_utils/shop.js';

function generateStrongPassword(length = 14) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const buf = crypto.getRandomValues(new Uint8Array(length));
  let pwd = '';
  for (let i = 0; i < length; i++) pwd += chars[buf[i] % chars.length];
  return pwd;
}

// Команди, які показуються в меню бота (кнопка «Меню» в Telegram).
// Імена — лише малі латинські літери/цифри/_ (вимога Telegram).
const BOT_MENU_COMMANDS = [
  { command: 'status', description: '📊 Стан магазину' },
  { command: 'shop_off', description: '🛑 Вимкнути магазин' },
  { command: 'shop_on', description: '✅ Увімкнути магазин' },
  { command: 'reset_admin_password', description: '🚨 Скинути пароль адмінки' },
];

// Реєструє меню команд бота через Bot API. Повертає { ok, error? }.
async function setupBotMenu(botToken) {
  try {
    const r = await fetch(`https://api.telegram.org/bot${botToken}/setMyCommands`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commands: BOT_MENU_COMMANDS }),
    });
    const d = await r.json().catch(() => ({}));
    if (d.ok) return { ok: true };
    return { ok: false, error: d.description || ('HTTP ' + r.status) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function sendMsg(botToken, chatId, text, parseMode = 'Markdown') {
  const body = { chat_id: chatId, text };
  if (parseMode) body.parse_mode = parseMode;
  return fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// Перевіряє що публічний /api/shop віддає очікуваний стан shopEnabled
// (підтверджує що purge кешу спрацював і нові дані вже доступні).
// Повертає true якщо стан співпадає, false — якщо ще старі дані.
async function verifyShopState(expectedEnabled) {
  // Чекаємо 1 секунду щоб дати CF час прокачати purge
  await new Promise(r => setTimeout(r, 1000));
  try {
    // Запит з cache-busting query — щоб точно отримати свіже
    const url = `https://agprnt.com/api/shop?_t=${Date.now()}`;
    const r = await fetch(url, { headers: { 'Cache-Control': 'no-cache' } });
    if (!r.ok) return false;
    const data = await r.json();
    return (data.shopEnabled !== false) === expectedEnabled;
  } catch {
    return false;
  }
}

export async function onRequestPost({ request, env }) {
  // Cloudflare передає Telegram secret token в заголовку (якщо встановлено)
  // Це додатковий захист від випадкових POST на цей endpoint
  const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET || '';
  const gotSecret = request.headers.get('x-telegram-bot-api-secret-token') || '';
  if (expectedSecret && gotSecret !== expectedSecret) {
    return new Response('forbidden', { status: 403 });
  }

  let update;
  try { update = await request.json(); } catch { return new Response('ok'); }

  const msg = update.message || update.edited_message;
  if (!msg || !msg.text) return new Response('ok');

  const fromChatId = String(msg.chat?.id || '');
  const text = String(msg.text || '').trim();

  const bot = await getBotConfig(env);
  if (!bot.botToken) return new Response('ok');

  // Перевірка авторизації — тільки повідомлення від збереженого chatId оброблюються
  const authorizedChatId = String(bot.chatId || '').trim();
  if (!authorizedChatId || fromChatId !== authorizedChatId) {
    // Невідомий chat — мовчки ігноруємо щоб не палити що бот існує
    return new Response('ok');
  }

  // === Команди ===
  if (text === '/start' || text === '/help') {
    // Автоматично оновлюємо меню команд (щоб у Telegram завжди було 4 пункти)
    await setupBotMenu(bot.botToken);
    const helpText = `🤖 *Команди бота:*\n\n` +
      `🚨 \`/reset_admin_password\` — скинути пароль адмінки\n` +
      `🛒 \`/shop_off\` — вимкнути магазин (зайдіть на сайт — побачите повідомлення)\n` +
      `✅ \`/shop_on\` — увімкнути магазин назад\n` +
      `📊 \`/status\` — поточний стан магазину`;
    await sendMsg(bot.botToken, fromChatId, helpText);
    return new Response('ok');
  }

  if (text === '/setup_menu') {
    const res = await setupBotMenu(bot.botToken);
    const reply = res.ok
      ? `✅ Меню бота оновлено — 4 команди.\nНатисни на «Меню» біля поля вводу (можливо доведеться перезайти в чат).`
      : `❌ Не вдалося оновити меню: ${res.error}`;
    await sendMsg(bot.botToken, fromChatId, reply);
    return new Response('ok');
  }

  if (text === '/reset_admin_password' || text === '/reset') {
    let stage = 'init';
    try {
      stage = 'generating password';
      const newPwd = generateStrongPassword(14);
      stage = 'saving password';
      await setPasswordOverride(env, newPwd);
      stage = 'sending message';
      const domain = await getPrimaryDomain(env);
      const replyText = `🚨 ПАРОЛЬ АДМІНКИ СКИНУТО\n\n` +
        `Новий пароль:\n${newPwd}\n\n` +
        `Зайди на: https://${domain}/admin/login/\n\n` +
        `Запиши пароль зараз — більше не покажеться. Старі сесії розлогінено.`;
      await sendMsg(bot.botToken, fromChatId, replyText, null);
    } catch (e) {
      try {
        await sendMsg(bot.botToken, fromChatId, `❌ Помилка на етапі "${stage}": ${e.message}`, null);
      } catch {}
    }
    return new Response('ok');
  }

  if (text === '/shop_off' || text === '/shop_off@' || text.startsWith('/shop_off ')) {
    const t0 = Date.now();
    let stage = 'init';
    try {
      stage = 'reading settings';
      const settings = await getSettings(env);
      stage = 'modifying';
      settings.shopEnabled = false;
      stage = 'writing KV';
      await env.SHOP_KV.put('settings', JSON.stringify(settings));
      stage = 'purging cache';
      let purgeOk = false;
      try {
        await invalidateShopCache(env);
        purgeOk = true;
      } catch {}
      stage = 'sending result';
      const ms = Date.now() - t0;
      const statusEmoji = purgeOk ? '✅' : '⚠️';
      const statusText = purgeOk
        ? 'Кеш CDN очищено — клієнти побачать заглушку при F5.'
        : 'Кеш CDN не очищено (перевір cfApiToken/cfZoneId).';
      const replyText = `🛑 Магазин ВИМКНЕНО ${statusEmoji}\n\n${statusText}\n\n⏱ ${ms}мс\n\nУвімкнути: /shop_on`;
      await sendMsg(bot.botToken, fromChatId, replyText, null);
    } catch (e) {
      try {
        await sendMsg(bot.botToken, fromChatId, `❌ Помилка на етапі "${stage}": ${e.message}`, null);
      } catch {}
    }
    return new Response('ok');
  }

  if (text === '/shop_on' || text === '/shop_on@' || text.startsWith('/shop_on ')) {
    const t0 = Date.now();
    try {
      const settings = await getSettings(env);
      settings.shopEnabled = true;
      await env.SHOP_KV.put('settings', JSON.stringify(settings));
      let purgeOk = false;
      try {
        await invalidateShopCache(env);
        purgeOk = true;
      } catch (e1) {
        console.log('purge fail:', e1.message);
      }
      const ms = Date.now() - t0;
      const statusEmoji = purgeOk ? '✅' : '⚠️';
      const statusText = purgeOk
        ? 'Кеш CDN очищено — клієнти побачать магазин при F5.'
        : 'Кеш CDN не очищено.';
      const replyText = `✅ Магазин УВІМКНЕНО ${statusEmoji}\n\n${statusText}\n\n⏱ ${ms}мс`;
      await sendMsg(bot.botToken, fromChatId, replyText, undefined);
    } catch (e) {
      try { await sendMsg(bot.botToken, fromChatId, `❌ Помилка: ${e.message}`, undefined); } catch {}
    }
    return new Response('ok');
  }

  if (text === '/status') {
    try {
      const settings = await getSettings(env);
      const status = settings.shopEnabled !== false
        ? `✅ *Магазин УВІМКНЕНО* — працює нормально`
        : `🛑 *Магазин ВИМКНЕНО* — клієнти не можуть оформити замовлення`;
      await sendMsg(bot.botToken, fromChatId, status);
    } catch (e) {
      await sendMsg(bot.botToken, fromChatId, `❌ Помилка: ${e.message}`);
    }
    return new Response('ok');
  }

  // Невідома команда
  await sendMsg(bot.botToken, fromChatId, `Невідома команда. Спробуй /help`);
  return new Response('ok');
}

export async function onRequestGet() {
  return new Response('Telegram webhook endpoint. POST only.', { status: 405 });
}
