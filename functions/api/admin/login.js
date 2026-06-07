// POST /api/admin/login — этап 1.
// Если 2FA выключена → cookie. Иначе → отправка кода в выбранный канал (telegram/email),
// возврат sessionId для шага 2.
import {
  makeAuthCookie, buildSessionSetCookie, buildSessionCookieFromSettings, notifyAdminLogin,
  getEffectivePassword, getSettings, getBotConfig, getPasswordRevocationTime,
  jsonResp,
} from '../../_utils/shop.js';

const LOCKOUT_LEVELS = [
  { fails: 5,  durationSec: 15 * 60 },
  { fails: 10, durationSec: 60 * 60 },
  { fails: 20, durationSec: 24 * 60 * 60 },
];
const FAIL_RECORD_TTL = 24 * 60 * 60;

async function getFailRec(env, ip) {
  if (!env.SHOP_KV) return { count: 0, lockUntil: 0 };
  try {
    const data = await env.SHOP_KV.get('login_fails_' + ip, 'json');
    return data || { count: 0, lockUntil: 0 };
  } catch { return { count: 0, lockUntil: 0 }; }
}
async function bumpFails(env, ip) {
  if (!env.SHOP_KV) return { count: 0, lockUntil: 0 };
  const rec = await getFailRec(env, ip);
  rec.count += 1;
  let lockSec = 0;
  for (const lvl of LOCKOUT_LEVELS) if (rec.count >= lvl.fails) lockSec = lvl.durationSec;
  rec.lockUntil = lockSec ? Date.now() + lockSec * 1000 : 0;
  await env.SHOP_KV.put('login_fails_' + ip, JSON.stringify(rec), { expirationTtl: FAIL_RECORD_TTL });
  return rec;
}
async function clearFails(env, ip) {
  if (!env.SHOP_KV) return;
  try { await env.SHOP_KV.delete('login_fails_' + ip); } catch {}
}

function formatRemaining(ms) {
  const sec = Math.ceil(ms / 1000);
  if (sec < 60) return sec + ' сек';
  const min = Math.ceil(sec / 60);
  if (min < 60) return min + ' хв';
  return Math.ceil(min / 60) + ' год';
}

function generateUUID() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}
function generateCode() {
  const buf = crypto.getRandomValues(new Uint32Array(1));
  return String(buf[0] % 1000000).padStart(6, '0');
}

async function sendCodeViaTelegram(env, settings, code, ip) {
  const bot = await getBotConfig(env);
  if (!bot.botToken) throw new Error('Бот не налаштований');
  const chatId = (settings.twoFactorChatId || bot.chatId || '').trim();
  if (!chatId) throw new Error('Не задано chat_id для 2FA');

  const text = `🔐 *Код для входу в адмінку*\n\nКод: \`${code}\`\nIP: \`${ip}\`\nДіє 5 хвилин.\n\nЯкщо це не ви — змініть пароль негайно.`;
  const r = await fetch(`https://api.telegram.org/bot${bot.botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
  const data = await r.json();
  if (!data.ok) throw new Error('Telegram: ' + (data.description || r.status));
}

async function sendCodeViaEmail(env, settings, code, ip) {
  const apiKey = (settings.emailApiKey || '').trim();
  const from = (settings.emailFrom || 'onboarding@resend.dev').trim();
  const to = (settings.emailTo || '').trim();
  if (!apiKey) throw new Error('Email API-ключ не задано');
  if (!to) throw new Error('Не задано email одержувача');

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <h2 style="color: #0b8aff; margin: 0 0 16px;">🔐 Код для входу в адмінку</h2>
      <p style="font-size: 16px; color: #1c2129; margin-bottom: 20px;">Ваш одноразовий код:</p>
      <div style="background: #f4f6fa; padding: 16px; border-radius: 8px; text-align: center; font-size: 32px; font-weight: 700; letter-spacing: 8px; font-family: monospace; color: #1c2129;">
        ${code}
      </div>
      <p style="font-size: 13px; color: #6b7280; margin-top: 20px;">
        IP: <code>${ip}</code><br>
        Код діє 5 хвилин.<br>
        Якщо це не ви — змініть пароль адмінки негайно.
      </p>
    </div>
  `;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to,
      subject: `Код входу в адмінку: ${code}`,
      html,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error('Resend: ' + (data.message || data.error || r.status));
}

export async function onRequestPost({ request, env }) {
  const expected = await getEffectivePassword(env);
  if (!expected) return jsonResp({ ok: false, error: 'Сервер не налаштований' }, 500);

  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rec = await getFailRec(env, ip);

  if (rec.lockUntil && rec.lockUntil > Date.now()) {
    return jsonResp({
      ok: false,
      error: `Забагато невдалих спроб. Зачекайте ${formatRemaining(rec.lockUntil - Date.now())}.`,
      lockedUntil: rec.lockUntil,
    }, 429);
  }

  // Захист від stale cache: якщо пароль щойно змінили (за останні 60 сек),
  // блокуємо логіни — щоб ніхто не зайшов з потенційно "застарілим" паролем,
  // який буде діяти ще 60 сек у деяких регіонах CF.
  const revokedAt = await getPasswordRevocationTime(env);
  if (revokedAt && Date.now() - revokedAt < 60000) {
    const remainSec = Math.ceil((60000 - (Date.now() - revokedAt)) / 1000);
    return jsonResp({
      ok: false,
      error: `Пароль нещодавно змінено. Зачекайте ${remainSec} сек і спробуйте знову.`,
      passwordReset: true,
    }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидний JSON' }, 400); }

  const pwd = String(body.password || '');
  let valid = pwd.length === expected.length;
  if (valid) {
    let r = 0;
    for (let i = 0; i < pwd.length; i++) r |= pwd.charCodeAt(i) ^ expected.charCodeAt(i);
    if (r !== 0) valid = false;
  }
  await new Promise(res => setTimeout(res, 300 + Math.floor(Math.random() * 200)));

  if (!valid) {
    const newRec = await bumpFails(env, ip);
    let msg = 'Невірний пароль';
    if (newRec.lockUntil > Date.now()) {
      msg = `Невірний пароль. Доступ заблоковано на ${formatRemaining(newRec.lockUntil - Date.now())}.`;
    } else {
      const nextLevel = LOCKOUT_LEVELS.find(l => l.fails > newRec.count);
      if (nextLevel) msg = `Невірний пароль. Залишилось спроб: ${nextLevel.fails - newRec.count}.`;
    }
    return jsonResp({ ok: false, error: msg, fails: newRec.count }, 401);
  }

  // Пароль верный — выбираем канал 2FA
  const settings = await getSettings(env);
  const channel = (settings.twoFactorChannel || (settings.twoFactorEnabled ? 'telegram' : 'off'));

  if (channel !== 'off') {
    const sessionId = generateUUID();
    const code = generateCode();
    const sessionData = { code, attempts: 0, expires: Date.now() + 5 * 60 * 1000, ip, channel };
    try {
      await env.SHOP_KV.put('2fa_' + sessionId, JSON.stringify(sessionData), { expirationTtl: 5 * 60 });
    } catch (e) {
      return jsonResp({ ok: false, error: 'KV помилка: ' + e.message }, 500);
    }
    try {
      if (channel === 'telegram') await sendCodeViaTelegram(env, settings, code, ip);
      else if (channel === 'email') await sendCodeViaEmail(env, settings, code, ip);
      else throw new Error('Невідомий канал 2FA: ' + channel);
    } catch (e) {
      try { await env.SHOP_KV.delete('2fa_' + sessionId); } catch {}
      return jsonResp({ ok: false, error: 'Не вдалось надіслати код: ' + e.message }, 500);
    }
    return jsonResp({ ok: true, requires2fa: true, sessionId, channel });
  }

  // 2FA отключена — сразу cookie
  await clearFails(env, ip);
  // Сповіщення в Telegram про успішний вхід (без 2FA).
  // Якщо клієнт надіслав X-Silent-Login: 1 — не сповіщаємо (для скриптів типу backup).
  const ua = request.headers.get('user-agent') || '';
  const silent = request.headers.get('x-silent-login') === '1';
  if (!silent) await notifyAdminLogin(env, ip, ua);
  const cookieValue = await makeAuthCookie(env);
  const setCookie = await buildSessionCookieFromSettings(env, cookieValue);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Set-Cookie': setCookie,
    },
  });
}
