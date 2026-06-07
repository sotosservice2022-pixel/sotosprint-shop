// POST /api/admin/password { oldPassword, newPassword } — смена пароля админки.
// Также поддерживает action=reset (сброс на env-пароль) и action=panic (автогенерация + Telegram).
// После смены все сессии (включая текущую!) инвалидируются — нужно зайти заново.
import { checkAuthAsync, getEffectivePassword, setPasswordOverride, clearPasswordOverride, buildLogoutSetCookie, getSettings, getBotConfig, jsonResp } from '../../_utils/shop.js';

function generateStrongPassword(length = 14) {
  // Виключаємо схожі символи (0/O, l/1) для зручності читання
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
  const buf = crypto.getRandomValues(new Uint8Array(length));
  let pwd = '';
  for (let i = 0; i < length; i++) pwd += chars[buf[i] % chars.length];
  return pwd;
}

async function notifyPasswordChange(env, newPassword, ip, ua) {
  try {
    const bot = await getBotConfig(env);
    if (!bot.botToken || !bot.chatId) return { sent: false, error: 'Бот не налаштований — пароль не надіслано в Telegram' };
    const date = new Date().toLocaleString('uk-UA', { timeZone: 'Europe/Kyiv' });
    const text = `🚨 *НОВИЙ ПАРОЛЬ АДМІНКИ*\n\n📅 ${date}\n🌐 IP: \`${ip}\`\n💻 ${String(ua).slice(0, 150)}\n\n🔑 Новий пароль:\n\`${newPassword}\`\n\n⚠️ Цей пароль показано лише раз. Зберіть його в надійне місце.\n\nВсі активні сесії розлогінені — потрібно зайти заново.`;
    const r = await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: bot.chatId, text, parse_mode: 'Markdown' }),
    });
    const j = await r.json();
    if (!j.ok) return { sent: false, error: 'Telegram: ' + (j.description || r.status) };
    return { sent: true };
  } catch (e) {
    return { sent: false, error: e.message };
  }
}

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) {
    return jsonResp({ ok: false, error: 'Требуется авторизация' }, 401);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидный JSON' }, 400); }

  // === PANIC: автогенерація + Telegram, без старого пароля ===
  // Користувач вже авторизований (cookie перевірена), тому без старого пароля довіряємо.
  if (body.action === 'panic') {
    const newPwd = generateStrongPassword(14);
    try {
      await setPasswordOverride(env, newPwd);
    } catch (e) {
      return jsonResp({ ok: false, error: 'Не вдалось зберегти новий пароль: ' + e.message }, 500);
    }
    const ip = request.headers.get('cf-connecting-ip') || 'unknown';
    const ua = request.headers.get('user-agent') || '';
    const notif = await notifyPasswordChange(env, newPwd, ip, ua);
    return new Response(JSON.stringify({
      ok: true,
      action: 'panic',
      newPassword: newPwd,
      notified: notif.sent,
      notifyError: notif.error || null,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': buildLogoutSetCookie(),
      },
    });
  }

  // Поддерживаем action=reset для сброса к env-паролю
  if (body.action === 'reset') {
    const expected = await getEffectivePassword(env);
    if (String(body.oldPassword || '') !== expected) {
      return jsonResp({ ok: false, error: 'Старый пароль неверен' }, 400);
    }
    await clearPasswordOverride(env);
    return new Response(JSON.stringify({ ok: true, action: 'reset' }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': buildLogoutSetCookie(),
      },
    });
  }

  const oldPwd = String(body.oldPassword || '');
  const newPwd = String(body.newPassword || '');

  const expected = await getEffectivePassword(env);
  if (oldPwd !== expected) {
    return jsonResp({ ok: false, error: 'Старый пароль неверен' }, 400);
  }
  if (newPwd.length < 8) {
    return jsonResp({ ok: false, error: 'Новый пароль должен быть не короче 8 символов' }, 400);
  }
  if (newPwd === expected) {
    return jsonResp({ ok: false, error: 'Новый пароль совпадает со старым' }, 400);
  }

  try {
    await setPasswordOverride(env, newPwd);
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }

  // После смены — все cookie невалидны (HMAC секрет изменился). Очищаем текущую.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': buildLogoutSetCookie(),
    },
  });
}
