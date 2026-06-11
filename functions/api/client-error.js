// POST /api/client-error — приймає короткий звіт зі сторінки оформлення, коли ВСІ
// спроби відправити замовлення провалились. Шле факти (без фото) в Telegram адміну,
// щоб було видно, на якому саме етапі обривається завантаження у клієнта.
import { getBotConfig } from '../_utils/shop.js';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function onRequestPost({ request, env }) {
  let data;
  try { data = await request.json(); } catch { return json({ ok: false }, 400); }
  if (!data || typeof data !== 'object') return json({ ok: false }, 400);

  // Анти-флуд: не частіше раза на 30 сек (на всіх)
  if (env.SHOP_KV) {
    try {
      if (await env.SHOP_KV.get('cerr_last')) return json({ ok: true });
      await env.SHOP_KV.put('cerr_last', '1', { expirationTtl: 30 });
    } catch {}
  }

  const log = Array.isArray(data.log) ? data.log.slice(0, 6).map(l => String(l).slice(0, 80)) : [];
  const lines = [
    '⚠️ *Клієнт не зміг відправити замовлення* (всі спроби провалились)',
    '',
    `📱 ${String(data.ua || '?').slice(0, 160)}`,
    `🌐 online=${data.online} conn=${String(data.conn || '?').slice(0, 20)}`,
    data.extra ? `💬 ${String(data.extra).slice(0, 200)}` : '',
    '',
    '*Спроби:*',
    ...log.map(l => '`' + l + '`'),
  ].filter(Boolean);

  try {
    const bot = await getBotConfig(env);
    if (bot.botToken && bot.chatId) {
      await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: bot.chatId, text: lines.join('\n'), parse_mode: 'Markdown' }),
      });
    }
  } catch {}
  return json({ ok: true });
}
