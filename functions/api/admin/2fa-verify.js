// POST /api/admin/2fa-verify { sessionId, code } — проверка 2FA-кода и выдача cookie
import { makeAuthCookie, buildSessionSetCookie, buildSessionCookieFromSettings, notifyAdminLogin, jsonResp } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидний JSON' }, 400); }

  const sessionId = String(body.sessionId || '').trim();
  const code = String(body.code || '').trim();

  if (!sessionId || !/^[a-f0-9-]{8,}$/i.test(sessionId)) {
    return jsonResp({ ok: false, error: 'Невалидна сесія' }, 400);
  }
  if (!/^\d{6}$/.test(code)) {
    return jsonResp({ ok: false, error: 'Код має складатись з 6 цифр' }, 400);
  }

  const key = '2fa_' + sessionId;
  let session;
  try {
    session = await env.SHOP_KV.get(key, 'json');
  } catch {
    return jsonResp({ ok: false, error: 'Помилка KV' }, 500);
  }
  if (!session) {
    return jsonResp({ ok: false, error: 'Сесія недійсна або прострочена. Увійдіть знову.' }, 400);
  }
  if (session.expires < Date.now()) {
    try { await env.SHOP_KV.delete(key); } catch {}
    return jsonResp({ ok: false, error: 'Код прострочений. Увійдіть знову.' }, 400);
  }
  if (session.attempts >= 3) {
    try { await env.SHOP_KV.delete(key); } catch {}
    return jsonResp({ ok: false, error: 'Перевищено кількість спроб. Увійдіть знову.' }, 400);
  }

  // Сравнение кодов в постоянное время
  let valid = code.length === session.code.length;
  if (valid) {
    let r = 0;
    for (let i = 0; i < code.length; i++) r |= code.charCodeAt(i) ^ session.code.charCodeAt(i);
    if (r !== 0) valid = false;
  }

  if (!valid) {
    session.attempts = (session.attempts || 0) + 1;
    try {
      await env.SHOP_KV.put(key, JSON.stringify(session), {
        expirationTtl: Math.max(60, Math.ceil((session.expires - Date.now()) / 1000)),
      });
    } catch {}
    return jsonResp({
      ok: false,
      error: `Невірний код. Залишилось спроб: ${3 - session.attempts}`,
    }, 400);
  }

  // Успех — удаляем сессию и выдаём cookie
  try { await env.SHOP_KV.delete(key); } catch {}
  // Сповіщення в Telegram про успішний вхід (з 2FA)
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const ua = request.headers.get('user-agent') || '';
  await notifyAdminLogin(env, ip, ua);
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
