// /api/admin/customer-email-test — надсилає тестовий лист щоб перевірити налаштування Resend
import { checkAuthAsync, getSettings, jsonResp, escapeHtml } from '../../_utils/shop.js';

export async function onRequestPost({ request, env }) {
  if (!(await checkAuthAsync(request, env))) return jsonResp({ ok: false, error: 'Не авторизовано' }, 401);

  let body;
  try { body = await request.json(); } catch { return jsonResp({ ok: false, error: 'Невалидний JSON' }, 400); }
  const to = String(body.to || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return jsonResp({ ok: false, error: 'Введіть правильний email' }, 400);
  }

  const settings = await getSettings(env);
  const apiKey = (settings.emailApiKey || '').trim();
  if (!apiKey) {
    return jsonResp({ ok: false, error: 'Resend API ключ не задано. Налаштуй у /admin/bot/ → 2FA → Resend API ключ.' }, 400);
  }

  const fromEmail = (settings.emailFrom || 'onboarding@resend.dev').trim();
  const fromName = (settings.customerEmailFromName || settings.title || 'Магазин').replace(/[<>"]/g, '');

  const subject = '🧪 Тестовий лист — налаштування email сповіщень';

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #f9fafb;">
      <div style="background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 2px 12px rgba(0,0,0,0.05);">
        <h1 style="color: #16a34a; margin: 0 0 8px;">✅ Email-сповіщення працюють!</h1>
        <p>Це тестовий лист від магазина <strong>${escapeHtml(settings.title || 'Магазин')}</strong>.</p>
        <p>Якщо ви бачите цей лист — налаштування Resend працюють правильно. Тепер ваші клієнти будуть отримувати підтвердження замовлень.</p>
        <div style="background: #f3f4f6; padding: 12px; border-radius: 8px; margin: 16px 0; font-size: 13px;">
          <div><strong>Sender:</strong> ${escapeHtml(fromName)} &lt;${escapeHtml(fromEmail)}&gt;</div>
          <div><strong>To:</strong> ${escapeHtml(to)}</div>
          <div><strong>Time:</strong> ${new Date().toISOString()}</div>
        </div>
        <p style="color: #6b7280; font-size: 13px;">Якщо лист потрапив у Spam — додайте ${escapeHtml(fromEmail)} в "Не спам".</p>
      </div>
    </div>
  `;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `${fromName} <${fromEmail}>`,
        to,
        subject,
        html,
      }),
    });
    if (r.ok) {
      const j = await r.json();
      return jsonResp({ ok: true, message: `✅ Лист надіслано на ${to}. Перевір Inbox (можливо в Spam).`, id: j.id });
    } else {
      let errMsg = `HTTP ${r.status}`;
      try {
        const ej = await r.json();
        errMsg = ej.message || ej.name || errMsg;
        // Resend часто повертає "validation_error" для непідтверджених доменів
        if (ej.name === 'validation_error') {
          errMsg = `${ej.message}. Перевір що from-адреса (${fromEmail}) дозволена в Resend (або використай onboarding@resend.dev для тестів).`;
        }
      } catch {}
      return jsonResp({ ok: false, error: errMsg }, 400);
    }
  } catch (e) {
    return jsonResp({ ok: false, error: e.message }, 500);
  }
}
