// GET/POST /api/admin/bot — управление токеном/chat_id бота через админку.
// Также POST {action: 'test'} — отправить тестовое сообщение в чат.
import { getBotConfig, saveBotConfig, checkAuthAsync, unauthorized, jsonResp } from '../../_utils/shop.js';

export async function onRequestGet({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  const cfg = await getBotConfig(env);
  // Маскируем токен для отображения — показываем первые 6 + последние 4 символа
  const masked = cfg.botToken ? `${cfg.botToken.slice(0, 6)}…${cfg.botToken.slice(-4)}` : '';
  // Источник: env (если в KV нет своего значения) или kv (если в KV сохранили)
  let kvHas = false;
  try {
    const stored = await env.SHOP_KV.get('bot', 'json');
    kvHas = !!(stored?.botToken || stored?.chatId);
  } catch {}
  return jsonResp({
    ok: true,
    hasToken: !!cfg.botToken,
    hasChatId: !!cfg.chatId,
    tokenMasked: masked,
    chatId: cfg.chatId, // chat_id не секретный, показываем
    source: kvHas ? 'kv' : 'env',
  });
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return unauthorized();
  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидный JSON' }, 400); }

  // Тестовое сообщение
  if (body.action === 'test') {
    const cfg = await getBotConfig(env);
    if (!cfg.botToken || !cfg.chatId) return jsonResp({ ok: false, error: 'Не задан токен или chat_id' }, 400);
    try {
      const r = await fetch(`https://api.telegram.org/bot${cfg.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: cfg.chatId,
          text: '✅ Тестовое сообщение от админки магазина. Если видите — связь работает.',
        }),
      });
      const data = await r.json();
      if (!data.ok) return jsonResp({ ok: false, error: 'Telegram: ' + (data.description || r.status) }, 400);
      return jsonResp({ ok: true, sent: true });
    } catch (e) {
      return jsonResp({ ok: false, error: e.message }, 500);
    }
  }

  // Сохранение
  const botToken = String(body.botToken || '').trim();
  const chatId = String(body.chatId || '').trim();

  if (botToken && !/^\d+:[A-Za-z0-9_-]+$/.test(botToken)) {
    return jsonResp({ ok: false, error: 'Токен должен быть формата 123456:ABC...' }, 400);
  }
  if (chatId && !/^-?\d+$/.test(chatId)) {
    return jsonResp({ ok: false, error: 'chat_id должен быть числом' }, 400);
  }

  await saveBotConfig(env, { botToken, chatId });
  return jsonResp({ ok: true });
}
