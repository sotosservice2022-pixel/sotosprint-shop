// POST /api/admin/2fa-test { channel?: 'telegram' | 'email' }
// Отправляет тестовый код в выбранный канал (или текущий настроенный)
import { checkAuthAsync, getSettings, getBotConfig, jsonResp } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

  let body;
  try { body = await request.json(); } catch { body = {}; }

  const settings = await getSettings(env);
  const channel = body.channel || settings.twoFactorChannel || 'telegram';

  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');

  try {
    if (channel === 'telegram') {
      const bot = await getBotConfig(env);
      if (!bot.botToken) throw new Error('Бот не налаштований');
      const chatId = (settings.twoFactorChatId || bot.chatId || '').trim();
      if (!chatId) throw new Error('Не задано chat_id');

      const text = `🧪 *Тестовий код 2FA*\n\nКод: \`${code}\`\n\nЦе тестове повідомлення з адмінки. Telegram-канал працює.`;
      const r = await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
      });
      const data = await r.json();
      if (!data.ok) throw new Error('Telegram: ' + (data.description || r.status));

    } else if (channel === 'email') {
      const apiKey = (settings.emailApiKey || '').trim();
      const from = (settings.emailFrom || 'onboarding@resend.dev').trim();
      const to = (settings.emailTo || '').trim();
      if (!apiKey) throw new Error('Email API-ключ не задано');
      if (!to) throw new Error('Не задано email одержувача');

      const html = `<div style="font-family: -apple-system, sans-serif; max-width: 480px; padding: 24px;">
        <h2 style="color: #0b8aff;">🧪 Тестовий код 2FA</h2>
        <div style="background:#f4f6fa;padding:16px;border-radius:8px;text-align:center;font-size:32px;font-weight:700;letter-spacing:8px;font-family:monospace;">${code}</div>
        <p style="color:#6b7280;font-size:13px;margin-top:16px;">Це тестове повідомлення з адмінки. Email-канал працює.</p>
      </div>`;

      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to, subject: `Тестовий код 2FA: ${code}`, html }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error('Resend: ' + (data.message || data.error || r.status));

    } else {
      return jsonResp({ ok: false, error: 'Невідомий канал' }, 400);
    }

    return jsonResp({ ok: true, sent: true, channel });
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }
}
